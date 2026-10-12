/*
 * Lyric Stage — the background.
 *
 * Lyric.gfx (WebGL2): one full-screen fragment shader, one draw call per
 * frame, no render targets.
 *   - Idle looks (original artwork): translucent blue ribbons on a pale or a
 *     navy sky ('win11', 'win11dark'), light shafts fanning from a soft glow
 *     with haze and dust ('win10'), or transparent so the user's own image
 *     (#ls-image, under the canvas) shows ('image').
 *   - The show: a dark base tinted by the album colors under aurora curtains,
 *     concert spotlights in haze, the blurred album cover or a faint glow,
 *     with floating particles (a hash grid in the same pass), audio pulses,
 *     a vignette and dithering.
 *   - The transition: a noise front, glowing in the album color, eats the
 *     idle look from the center out while the idle zooms in and softens.
 * The canvas has premultiplied alpha: it is opaque except for the 'image'
 * look, where alpha is the part of the show already revealed.
 * Rendering is on demand: needsFrames() says when a frame is due (motion, or
 * a picture to settle), so a still wallpaper costs no GPU at all.
 *
 * Lyric.gfx2d: the same API on Canvas 2D (gradients and sprites, a plain
 * cross-fade) for when WebGL2 is unavailable.
 */
(function (S) {
  'use strict';

  var IDLE = { win11: 0, win11dark: 1, win10: 2, image: 3 };
  var STYLE = { aurora: 0, spotlights: 1, cover: 2, minimal: 3 };
  var VIZ = { off: 0, bars: 1, wave: 2, ring: 3 };
  var VIZ_N = 32;     // visualizer bands (p.bands: a Float32Array of this length, 0–1)

  // Ribbons of the 'win11' looks, back to front, in screen units (height = 1,
  // x from about -0.9 to 0.9, y up). Each one: center line
  // y = a0 + a1·x + a2·sin(a3·x + b0) + b1·sin(b2·x + b3), half width w,
  // twisting along x as cos(t0·x + t1), opacity, tone (0 = deep blue …
  // 1 = pale) and drift (how fast it flows with idle motion; keep it a
  // multiple of 0.1, see RIB_PERIOD).
  var RIBBONS = new Float32Array([
    // a0     a1     a2     a3      b0     b1     b2     b3      t0     t1     w      alpha   tone  drift  -  -
    -0.02,  0.30,  0.16,  1.9,    0.9,   0.05,  4.1,   0.3,    1.2,   0.4,   0.17,  0.40,   0.90, 0.6,  0, 0,
    -0.10,  0.36,  0.13,  2.3,   -0.2,   0.04,  5.0,   1.7,    1.8,   2.1,   0.11,  0.55,   0.55, 0.8,  0, 0,
     0.04,  0.22,  0.18,  1.7,    1.8,   0.05,  3.6,  -0.6,    2.4,  -0.8,   0.09,  0.75,   0.15, 1.0,  0, 0,
    -0.18,  0.40,  0.10,  2.6,    0.4,   0.03,  6.0,   2.4,    2.0,   1.1,   0.06,  0.70,   0.00, 1.2,  0, 0,
     0.10,  0.28,  0.14,  2.0,    2.6,   0.03,  4.4,   0.9,    1.5,   0.2,   0.022, 0.80,   1.00, 0.9,  0, 0
  ]);
  var RIB_N = RIBBONS.length / 16;

  // ---------------------------------------------------------------------------
  // Shaders
  // ---------------------------------------------------------------------------
  var VS = [
    '#version 300 es',
    'void main() {',
    '  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));',
    '  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);',
    '}'
  ].join('\n');

  var FS = [
    '#version 300 es',
    'precision highp float;',
    'uniform vec2 u_res;',
    'uniform float u_time;',       // show clock (s)
    'uniform float u_itime;',      // idle clock: only runs with idle motion
    'uniform int u_idle;',         // 0 win11, 1 win11dark, 2 win10, 3 image
    'uniform int u_style;',        // 0 aurora, 1 spotlights, 2 cover, 3 minimal
    'uniform float u_show;',       // 0 idle … 1 show
    'uniform vec3 u_colA, u_colB, u_base;',
    'uniform vec4 u_audio;',       // bass, volume, beat (already × strength), strength
    'uniform float u_parts;',
    'uniform float u_coverOn;',
    'uniform sampler2D u_cover;',
    'uniform vec2 u_coverSize;',
    'uniform vec4 u_rib[' + (RIB_N * 4) + '];',
    'uniform vec4 u_viz;',          // visualizer: style (0 off, 1 bars, 2 wave, 3 ring), size
    'uniform float u_bands[' + VIZ_N + '];',
    'out vec4 o;',
    '',
    'float px;',                   // one pixel in screen units
    '',
    // Hashes without sine (stable on every GPU), value noise and fbm
    'float hash(vec2 p) {',
    '  vec3 p3 = fract(vec3(p.xyx) * 0.1031);',
    '  p3 += dot(p3, p3.yzx + 33.33);',
    '  return fract((p3.x + p3.y) * p3.z);',
    '}',
    'vec3 hash3(vec2 p) {',
    '  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));',
    '  p3 += dot(p3, p3.yxz + 33.33);',
    '  return fract((p3.xxy + p3.yzz) * p3.zyx);',
    '}',
    'float noise(vec2 p) {',
    '  vec2 i = floor(p), f = fract(p);',
    '  f = f * f * (3.0 - 2.0 * f);',
    '  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),',
    '             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);',
    '}',
    'const mat2 OCT = mat2(1.6, 1.2, -1.2, 1.6);',
    'float fbm(vec2 p, int n) {',
    '  float s = 0.0, a = 0.5, t = 0.0;',
    '  for (int i = 0; i < 4; i++) {',
    '    if (i >= n) break;',
    '    s += a * noise(p);',
    '    t += a;',
    '    p = OCT * p + 3.7;',
    '    a *= 0.5;',
    '  }',
    '  return s / t;',
    '}',
    'float gauss(vec2 d, float r) { return exp(-dot(d, d) / (r * r)); }',
    '',
    // ---- Idle: ribbons -------------------------------------------------------
    // Ribbon i at q: x = signed distance across, y = half width there,
    // z = cos of the twist (its sign = which face shows), w = 1/sqrt(1 + slope²)
    'vec4 ribbon(vec2 q, int i, float t) {',
    '  vec4 a = u_rib[i * 4], b = u_rib[i * 4 + 1], c = u_rib[i * 4 + 2];',
    '  float ph = t * u_rib[i * 4 + 3].y;',
    '  float s1 = a.w * q.x + b.x + ph, s2 = b.z * q.x + b.w - ph * 0.7;',
    '  float y = a.x + a.y * q.x + a.z * sin(s1) + b.y * sin(s2);',
    '  float dy = a.y + a.z * a.w * cos(s1) + b.y * b.z * cos(s2);',
    '  float k = inversesqrt(1.0 + dy * dy);',
    '  float ct = cos(c.x * q.x + c.y + ph * 0.5);',
    '  return vec4((q.y - y) * k, c.z * (0.1 + 0.9 * abs(ct)), ct, k);',
    '}',
    '',
    'vec3 idleRibbons(vec2 q, float asp, bool dark, float soft) {',
    '  float t = u_itime * 0.05;',
    '  vec3 col;',
    '  vec3 deep, mid, lite, pale, sheen;',
    '  if (dark) {',
    '    col = mix(vec3(0.030, 0.050, 0.105), vec3(0.040, 0.072, 0.140), q.y + 0.5);',
    '    col += vec3(0.04, 0.11, 0.30) * gauss(q - vec2(0.05, 0.0), 0.6);',
    '    deep = vec3(0.07, 0.30, 0.85); mid = vec3(0.20, 0.50, 0.98);',
    '    lite = vec3(0.45, 0.70, 1.00); pale = vec3(0.70, 0.84, 1.00);',
    '    sheen = vec3(0.85, 0.93, 1.0);',
    '  } else {',
    '    col = mix(vec3(0.812, 0.875, 0.953), vec3(0.910, 0.940, 0.978), q.y + 0.5);',
    '    col += vec3(0.07, 0.06, 0.03) * gauss(q - vec2(-0.1, 0.1), 0.65);',
    '    col -= vec3(0.06, 0.04, 0.0) * gauss(q - vec2(asp * 0.5, -0.5), 0.6);',
    '    deep = vec3(0.075, 0.33, 0.80); mid = vec3(0.22, 0.48, 0.90);',
    '    lite = vec3(0.561, 0.737, 1.000); pale = vec3(0.80, 0.88, 0.99);',
    '    sheen = vec3(0.96, 0.98, 1.0);',
    '  }',
    '  for (int i = 0; i < ' + RIB_N + '; i++) {',
    '    vec4 r = ribbon(q, i, t);',
    '    vec4 c = u_rib[i * 4 + 2], e = u_rib[i * 4 + 3];',
    '    float d = r.x, hw = r.y, ad = abs(d), face = abs(r.z);',
    '    if (dark) {',
    // A halo of light around the ribbon
    '      col += mix(mid, lite, e.x) * 0.10 * exp(-max(ad - hw, 0.0) * 22.0) * c.w;',
    '    } else {',
    // A soft shadow on what is behind (the ribbon moved down)
    '      float sd = abs(d + 0.03 * r.w);',
    '      col *= 1.0 - 0.09 * c.w * (1.0 - smoothstep(hw - 0.04, hw + 0.07, sd));',
    '    }',
    '    float aa = 1.2 * px + soft;',
    '    float cov = 1.0 - smoothstep(hw - aa, hw + aa, ad);',
    '    if (cov <= 0.0) continue;',
    // Light across the width; it flips with the twist, flat while edge-on
    '    float v = clamp(d / hw, -1.0, 1.0) * clamp(r.z * 3.0, -1.0, 1.0);',
    '    float lit = 0.5 + 0.5 * v;',
    '    vec3 dc = mix(deep, mid, e.x), lc = mix(lite, pale, e.x);',
    '    vec3 rc = mix(dc, lc, lit * lit * (3.0 - 2.0 * lit));',
    // Sheen near the lit edge, glassy rim, the back face a little deeper,
    // denser and deeper when seen edge-on
    '    float sh = exp(-(v - 0.55) * (v - 0.55) * 30.0) * face;',
    '    float rim = smoothstep(0.78, 1.0, abs(d / hw));',
    '    if (dark) {',
    '      rc += sheen * 0.45 * sh + lc * 0.55 * rim;',
    '    } else {',
    '      rc = mix(rc, sheen, 0.65 * sh);',
    '      rc = mix(rc, sheen, 0.3 * rim);',
    '      rc += (lc - rc) * 0.18 * (1.0 - abs(v));',
    '    }',
    '    rc = mix(rc, dc, 0.12 * (1.0 - r.z));',
    '    rc = mix(rc, dc * 0.85, (1.0 - face) * 0.45);',
    '    float al = 1.0 - pow(1.0 - c.w, 1.0 / max(face, 0.2));',
    '    col = mix(col, rc, al * cov);',
    '  }',
    '  return col;',
    '}',
    '',
    // ---- Idle: light shafts ----------------------------------------------------
    'vec3 idleShafts(vec2 q, float asp) {',
    '  float t = u_itime;',
    '  vec2 src = vec2(asp * 0.25, 0.03);',
    '  vec2 d = q - src;',
    '  float r = length(d);',
    // Deep navy, lifting to blue around the light
    '  vec3 col = mix(vec3(0.0, 0.03, 0.10), vec3(0.0, 0.063, 0.18), smoothstep(-0.6, 0.4, q.y));',
    '  col = mix(col, vec3(0.043, 0.24, 0.57), exp(-r * 3.0) * 0.8);',
    // Shafts fan out to the left: broad soft beams and finer ones, fading with
    // distance and thickened by the haze
    '  float a = atan(d.y, 1e-4 - d.x);',
    '  float fan = exp(-a * a / 0.7);',
    '  float rays = smoothstep(0.35, 0.95, noise(vec2(a * 7.0 + t * 0.01, 1.7))) * 0.95',
    '    + smoothstep(0.5, 1.0, noise(vec2(a * 19.0 - t * 0.015, 4.2))) * 0.6;',
    '  float haze = fbm(q * 2.4 + vec2(t * 0.012, 0.0), 3);',
    '  float beams = rays * fan * exp(-r * 1.1) * smoothstep(0.0, 0.25, r) * (0.15 + 1.2 * haze);',
    '  col += vec3(0.30, 0.56, 1.0) * beams * 0.6;',
    '  col += vec3(0.05, 0.15, 0.40) * haze * haze * 0.22;',
    // The light itself: a soft glow, no shape
    '  col += vec3(0.62, 0.80, 1.0) * gauss(d * vec2(1.0, 0.7), 0.04) * 0.55;',
    '  col += vec3(0.18, 0.42, 1.0) * gauss(d, 0.16) * 0.28;',
    // Where the light reaches the floor
    '  col += vec3(0.10, 0.28, 0.75) * 0.14 * gauss((q - vec2(-asp * 0.05, -0.62)) * vec2(0.45, 1.6), 0.45);',
    // Dust: sparse specks, seen where the light is
    '  vec2 p = q * 55.0 + vec2(0.0, t * 0.5);',
    '  vec2 cell = floor(p);',
    '  vec3 h = hash3(cell);',
    '  if (h.x < 0.10) {',
    '    vec2 f = fract(p) - 0.5 - (h.yz - 0.5) * 0.6;',
    '    float sp = (1.0 - smoothstep(0.0, 0.2, length(f))) * (0.3 + h.x * 7.0);',
    '    col += vec3(0.7, 0.85, 1.0) * sp * (0.012 + beams * 1.1 + gauss(d, 0.25) * 0.25);',
    '  }',
    '  return col;',
    '}',
    '',
    // ---- Show ----------------------------------------------------------------
    // Smooth upscale of the tiny cover (cubic B-spline from 4 bilinear taps).
    // textureLod: no derivatives inside the style branch (D3D keeps it a branch)
    'vec3 coverAt(vec2 uv) {',
    '  vec2 st = uv * u_coverSize - 0.5, i = floor(st), f = st - i;',
    '  vec2 f2 = f * f, f3 = f2 * f;',
    '  vec2 w0 = (-f3 + 3.0 * f2 - 3.0 * f + 1.0) / 6.0;',
    '  vec2 w1 = (3.0 * f3 - 6.0 * f2 + 4.0) / 6.0;',
    '  vec2 w2 = (-3.0 * f3 + 3.0 * f2 + 3.0 * f + 1.0) / 6.0;',
    '  vec2 w3 = f3 / 6.0;',
    '  vec2 g0 = w0 + w1, g1 = w2 + w3;',
    '  vec2 h0 = (i - 0.5 + w1 / g0) / u_coverSize, h1 = (i + 1.5 + w3 / g1) / u_coverSize;',
    '  return g0.y * (g0.x * textureLod(u_cover, h0, 0.0).rgb + g1.x * textureLod(u_cover, vec2(h1.x, h0.y), 0.0).rgb)',
    '       + g1.y * (g0.x * textureLod(u_cover, vec2(h0.x, h1.y), 0.0).rgb + g1.x * textureLod(u_cover, h1, 0.0).rgb);',
    '}',
    '',
    'vec3 aurora(vec2 q, float asp, float t) {',
    '  vec3 col = u_base;',
    // Big glows drifting behind, their shapes warped by a slow noise
    '  vec2 w = q + (vec2(noise(q * 1.3 + t * 0.03), noise(q * 1.3 + 5.2 - t * 0.025)) - 0.5) * 0.45;',
    '  col += u_colA * 0.22 * gauss(w - vec2(asp * 0.32 * sin(t * 0.043), -0.28 + 0.10 * sin(t * 0.031 + 1.0)), 0.55);',
    '  col += u_colB * 0.20 * gauss(w - vec2(-asp * 0.30 * sin(t * 0.037 + 2.3), 0.24 + 0.08 * sin(t * 0.047 + 4.0)), 0.6);',
    '  col += mix(u_colA, u_colB, 0.5) * 0.08 * gauss(w - vec2(asp * 0.2 * cos(t * 0.029), 0.0), 0.7);',
    // Two curtains: a bright lower edge with fine slanted rays rising from it,
    // folding and fading in and out along their length
    '  for (int k = 0; k < 2; k++) {',
    '    float fk = float(k);',
    '    float x = q.x * (1.0 + 0.35 * fk) + fk * 3.1;',
    '    float n = fbm(vec2(x * 1.1 + t * 0.02, t * 0.03 + fk * 5.0), 2);',
    '    float yc = -0.06 + 0.19 * fk + 0.5 * (n - 0.5) + 0.11 * sin(x * 1.3 + t * 0.05 + fk * 2.0);',
    '    float d = q.y - yc;',
    '    float rx = x + d * 0.3 + n * 0.8;',
    '    float rays = noise(vec2(rx * 15.0 + t * 0.06, d * 2.0 - t * 0.1)) * 0.6',
    '      + noise(vec2(rx * 38.0 - t * 0.04, d * 3.0 + fk * 9.0)) * 0.4;',
    '    rays = smoothstep(0.2, 0.9, rays);',
    '    float on = smoothstep(0.15, 0.7, noise(vec2(x * 1.2 - t * 0.03, fk * 7.0 + t * 0.01)));',
    '    float edge = exp(-d * d / 0.0010);',
    '    float lo = min(d, 0.0);',
    '    float up = exp(-max(d, 0.0) / (0.24 - 0.07 * fk) - lo * lo / 0.003);',
    '    float cur = (edge * (0.35 + 0.4 * rays) + up * rays) * (0.2 + 0.8 * on);',
    '    vec3 c0 = k == 0 ? u_colA : u_colB, c1 = k == 0 ? u_colB : u_colA;',
    '    col += mix(mix(c0, vec3(1.0), 0.2 * edge), c1, smoothstep(0.0, 0.3, d)) * cur * (0.62 - 0.22 * fk);',
    '  }',
    '  return col;',
    '}',
    '',
    'vec3 spotlights(vec2 q, float asp, float t, float haze) {',
    '  vec3 col = u_base * (0.6 + 0.8 * haze);',
    '  vec3 mixc = mix(u_colA, u_colB, 0.5);',
    // A wash at the back of the stage and on the floor
    '  col += mixc * 0.05 * smoothstep(-0.5, 0.5, q.y);',
    '  col += mixc * 0.07 * gauss((q - vec2(0.0, -0.62)) * vec2(0.4, 1.4), 0.4);',
    '  for (int i = 0; i < 6; i++) {',
    '    float fi = float(i);',
    '    vec2 o, dir;',
    '    if (i < 4) {',
    // Four from the truss above, swinging
    '      o = vec2((fi / 3.0 - 0.5) * asp * 0.72, 0.48);',
    '      float ang = 0.42 * sin(t * (0.19 + 0.05 * fi) + fi * 2.1) - (fi / 3.0 - 0.5) * 0.35;',
    '      dir = vec2(sin(ang), -cos(ang));',
    '    } else {',
    // Two from the floor corners, up and inward
    '      float side = i == 4 ? -1.0 : 1.0;',
    '      o = vec2(side * asp * 0.50, -0.50);',
    '      float ang = 0.55 + 0.25 * sin(t * 0.27 + fi * 1.3);',
    '      dir = vec2(-side * sin(ang), cos(ang));',
    '    }',
    '    vec2 d = q - o;',
    '    float along = dot(d, dir);',
    '    float perp = abs(d.x * dir.y - d.y * dir.x);',
    '    float x = perp / (0.010 + 0.12 * max(along, 0.0));',
    '    float cone = (1.0 - smoothstep(0.5, 1.0, x)) * 0.5 + exp(-x * x * 6.0) * 0.6;',
    '    cone *= smoothstep(0.0, 0.03, along) * exp(-along * 0.8);',
    '    vec3 bc = mod(fi, 2.0) < 0.5 ? u_colA : u_colB;',
    '    col += bc * cone * (0.15 + 1.1 * haze) * (i < 4 ? 0.5 : 0.35);',
    // The lamp, with a little horizontal flare
    '    vec3 lc = mix(bc, vec3(1.0), 0.65);',
    '    col += lc * (gauss(d, 0.022) * 1.3 + gauss(d * vec2(0.12, 1.0), 0.01) * 0.35);',
    '  }',
    '  return col;',
    '}',
    '',
    // The square cover fills the screen whatever its shape (portrait too)
    'vec3 coverBg(vec2 q, float asp, float t) {',
    '  vec2 w = vec2(noise(q * 1.4 + t * 0.05), noise(q * 1.4 + 9.3 - t * 0.04)) - 0.5;',
    '  vec2 uv = (q / max(asp, 1.0)) / (1.12 + 0.04 * sin(t * 0.05)) + 0.5 + 0.05 * w',
    '    + 0.02 * vec2(sin(t * 0.031), cos(t * 0.027));',
    '  vec3 c = max(coverAt(uv), 0.0);',
    '  c = max(mix(vec3(dot(c, vec3(0.299, 0.587, 0.114))), c, 1.15), 0.0);',
    '  return c * 0.34 + u_base * 0.5 + u_colA * 0.06 * gauss(q - vec2(0.0, -0.6), 0.6);',
    '}',
    '',
    'vec3 minimal(vec2 q, float asp, float t) {',
    '  vec3 col = u_base * 0.5;',
    '  col += u_colA * 0.24 * (0.85 + 0.15 * sin(t * 0.4)) * gauss((q - vec2(0.0, -0.55)) * vec2(0.6, 1.0), 0.5);',
    '  col += u_colB * 0.08 * gauss(q - vec2(asp * 0.35, 0.45), 0.5);',
    '  return col;',
    '}',
    '',
    // Two layers of soft dots rising slowly, at most one per cell of a hash
    // grid (the near layer: fewer, bigger and dimmer, like bokeh), thinned out
    // in drifting patches
    'vec3 particles(vec2 q, float t) {',
    '  vec3 acc = vec3(0.0);',
    '  for (int l = 0; l < 2; l++) {',
    '    float fl = float(l);',
    '    float sc = 7.0 + 7.0 * fl;',
    '    vec2 p = q * sc - vec2(0.0, t * (0.32 - 0.10 * fl));',
    '    vec2 cell = floor(p);',
    '    vec3 h = hash3(cell + fl * 37.0);',
    '    if (h.x > 0.45) continue;',
    '    vec2 off = (h.yz - 0.5) * 0.5;',
    '    off.x += 0.07 * sin(t * 0.5 + h.x * 70.0);',
    '    vec2 f = fract(p) - 0.5 - off;',
    '    float sz = fract(h.x * 13.7);',
    '    float r = l == 0 ? 0.03 + 0.07 * sz * sz : 0.025 + 0.03 * sz;',
    '    float tw = 0.6 + 0.4 * sin(t * (0.7 + sz * 1.6) + h.y * 40.0);',
    '    float b = (l == 0 ? 0.55 : 0.8) * (0.4 + 0.6 * h.z) / (1.0 + r * 12.0);',
    '    acc += mix(u_colA, mix(u_colB, vec3(1.0), 0.5), fract(h.y * 7.3)) * gauss(f, r) * tw * b;',
    '  }',
    '  return acc * smoothstep(0.2, 0.7, noise(q * 1.5 + vec2(0.0, -t * 0.03)));',
    '}',
    '',
    'vec3 showColor(vec2 q, float asp) {',
    '  float t = u_time;',
    '  float bass = u_audio.x, beat = u_audio.z;',
    '  q /= 1.0 + 0.012 * bass;',
    // Brightness pulse: strong at first, saturating (no wash-out at the top)
    '  float x = 0.22 * bass + 0.16 * beat + 0.05 * u_audio.y * u_audio.w;',
    '  float pulse = 1.0 + x / (1.0 + 0.6 * x);',
    '  vec3 c;',
    '  if (u_style == 1) c = spotlights(q, asp, t, smoothstep(0.25, 0.8, fbm(q * 3.0 + vec2(t * 0.05, -t * 0.03), 3)));',
    '  else if (u_style == 2 && u_coverOn > 0.5) c = coverBg(q, asp, t);',
    '  else if (u_style == 3) c = minimal(q, asp, t);',
    '  else c = aurora(q, asp, t);',
    '  c = u_base * 0.3 + (c - u_base * 0.3) * pulse;',
    '  if (u_parts > 0.5) c += particles(q, t) * (0.8 + 0.5 * bass);',
    '  float vg = 1.0 - smoothstep(0.3, 1.25, length(q * vec2(0.8, 1.0)));',
    '  return c * mix(0.35, 1.0, vg);',
    '}',
    '',
    // Soft roll-off of the highlights
    'float knee(float c) { return c < 0.8 ? c : 0.8 + 0.2 * (1.0 - exp(-(c - 0.8) * 5.0)); }',
    '',
    // The audio visualizer: the spectrum (bass → treble) in the album colors,
    // added as light over the show
    'float band(float u) {',
    '  float f = clamp(u, 0.0, 1.0) * ' + (VIZ_N - 1) + '.0;',
    '  int i = int(f);',
    '  int j = min(i + 1, ' + (VIZ_N - 1) + ');',
    '  return mix(u_bands[i], u_bands[j], smoothstep(0.0, 1.0, f - float(i)));',
    '}',
    '',
    'vec3 visualizer(vec2 q, float asp) {',
    '  float k = u_viz.y;',
    '  if (u_viz.x < 2.5) {',
    // Along the bottom, across the middle of the screen (clear of the corner card)
    '    float w = asp * 0.56, u = (q.x + w * 0.5) / w;',
    '    if (u < -0.02 || u > 1.02) return vec3(0.0);',
    '    float y = q.y + 0.47;',
    '    if (y > 0.2 * k + 0.08) return vec3(0.0);',
    '    vec3 col = mix(u_colA, u_colB, clamp(u, 0.0, 1.0));',
    '    if (u_viz.x < 1.5) {',
    '      float f = u * ' + VIZ_N + '.0, cell = fract(f);',
    '      float h = 0.006 + 0.16 * k * u_bands[int(clamp(floor(f), 0.0, ' + (VIZ_N - 1) + '.0))];',
    '      float side = smoothstep(0.08, 0.16, cell) * (1.0 - smoothstep(0.84, 0.92, cell));',
    '      float body = side * step(0.0, y) * (1.0 - smoothstep(h - 0.002, h + 0.002, y));',
    '      float glow = side * exp(-max(y - h, 0.0) / 0.012) * step(0.0, y) * 0.5;',
    '      float edge = step(0.0, u) * step(u, 1.0);',
    '      return col * (body * mix(0.55, 1.0, y / max(h, 0.001)) + glow) * edge * 0.85;',
    '    }',
    '    float h = 0.012 + 0.14 * k * band(u);',
    '    float d = abs(y - h);',
    '    float fade = smoothstep(-0.02, 0.06, u) * (1.0 - smoothstep(0.94, 1.02, u));',
    '    return col * (exp(-d * d / 0.000012) + 0.35 * exp(-d / 0.02)) * fade * 0.9;',
    '  }',
    // A ring around the center: left and right mirror each other
    '  float r = length(q), a = atan(q.x, q.y);',
    '  float u = abs(a) / 3.14159265;',
        // Wide enough for the song card (cover, title, artist, status) inside it
    '  float r0 = 0.36, h = 0.10 * k * band(u);',
    '  float d = r - r0;',
    '  if (d < -0.02 || d > h + 0.08) return vec3(0.0);',
    '  vec3 col = mix(u_colA, u_colB, u);',
    '  float fill = step(0.0, d) * (1.0 - smoothstep(h - 0.003, h + 0.003, d));',
    '  float rim = exp(-d * d / 0.000006);',
    '  return col * (fill * 0.35 + rim * 0.6 + 0.25 * exp(-abs(d - h) / 0.01));',
    '}',
    '',
    'void main() {',
    '  px = 1.0 / u_res.y;',
    '  vec2 q = (gl_FragCoord.xy - 0.5 * u_res) * px;',
    '  float asp = u_res.x * px;',
    '  float s = u_show;',
    '  vec3 idle = vec3(0.0);',
    '  float ia = u_idle == 3 ? 0.0 : 1.0;',   // idle alpha: the user's image shows through
    '  vec3 show = vec3(0.0);',
    '  if (s < 0.999 && u_idle != 3) {',
    // While it dissolves, the idle look zooms in and softens
    '    vec2 qi = q / (1.0 + 0.07 * s);',
    '    if (u_idle == 2) idle = idleShafts(qi, asp);',
    '    else idle = idleRibbons(qi, asp, u_idle == 1, s * 0.05);',
    '  }',
    '  if (s > 0.001) {',
    '    show = showColor(q * (1.0 + 0.10 * (1.0 - s)), asp);',
    '    if (u_viz.x > 0.5) show += visualizer(q, asp) * smoothstep(0.5, 1.0, s);',
    '    show = vec3(knee(show.r), knee(show.g), knee(show.b));',
    '  }',
    '  vec3 rgb;',
    '  float a;',
    '  if (s <= 0.001) {',
    '    rgb = idle;',
    '    a = ia;',
    '  } else if (s >= 0.999) {',
    '    rgb = show;',
    '    a = 1.0;',
    '  } else {',
    // The front: the distance from the center plus a drifting noise (each
    // transition has its own shape), swept by s. A thin bright line in the
    // album color, a glow inside, the idle tinted ahead of it.
    '    float rr = length(q * vec2(0.75, 1.0)) / length(vec2(asp * 0.375, 0.5));',
    '    float n = fbm(q * 2.3 + vec2(11.0 + u_time * 0.13, u_time * 0.09), 3);',
    '    float field = 0.42 * clamp((n - 0.5) * 1.8 + 0.5, 0.0, 1.0) + 0.58 * rr;',
    '    float e = field - mix(-0.06, 1.06, 1.0 - pow(1.0 - s, 1.3));',
    '    float m = 1.0 - smoothstep(-0.01, 0.01, e);',
    '    float fade = smoothstep(0.0, 0.08, s) * (1.0 - smoothstep(0.92, 1.0, s));',
    '    float line = exp(-e * e / 0.00008) * fade;',
    '    float inner = exp(min(e, 0.0) / 0.05) * m * fade;',
    '    float ahead = exp(-max(e, 0.0) / 0.03) * (1.0 - m) * fade;',
    '    vec3 hot = mix(u_colA, vec3(1.0), 0.35);',
    '    idle = mix(idle, mix(u_colA, idle, 0.5), ahead * 0.45);',
    '    rgb = idle * ia * (1.0 - m) + (show + u_colA * inner * 0.3) * m;',
    '    a = ia * (1.0 - m) + m;',
    '    rgb = mix(rgb, hot, line * 0.85);',
    '    a = mix(a, 1.0, line * 0.85);',
    '    if (u_idle == 3) { rgb += u_colA * ahead * 0.2; a = max(a, ahead * 0.2); }',
    '  }',
    // Dithering: no banding in the soft gradients. Premultiplied alpha: the
    // color never exceeds the alpha (the glows over the user's image)
    '  rgb += (hash(gl_FragCoord.xy) - 0.5) / 255.0 * a;',
    '  o = vec4(clamp(rgb, 0.0, a), a);',
    '}'
  ].join('\n');

  // ---------------------------------------------------------------------------
  // Shared helpers
  // ---------------------------------------------------------------------------
  var COVER = 48;   // the cover is shrunk to this many pixels (a cheap blur)

  // An image or canvas → a small, pre-blurred square canvas (centered crop)
  // or null
  function shrinkCover(src, into) {
    if (!src) return null;
    var w = src.naturalWidth || src.videoWidth || src.width || 0;
    var h = src.naturalHeight || src.videoHeight || src.height || 0;
    if (!w || !h) return null;
    try {
      var side = Math.min(w, h);
      var mid = document.createElement('canvas');
      mid.width = mid.height = COVER * 2;
      var mx = mid.getContext('2d');
      mx.imageSmoothingEnabled = true;
      mx.imageSmoothingQuality = 'high';
      mx.drawImage(src, (w - side) / 2, (h - side) / 2, side, side, 0, 0, COVER * 2, COVER * 2);
      var c = into || document.createElement('canvas');
      c.width = c.height = COVER;
      var x = c.getContext('2d');
      x.imageSmoothingEnabled = true;
      x.imageSmoothingQuality = 'high';
      x.filter = 'blur(1.5px)';
      // Drawn a bit larger than the canvas: the blur has no dark border
      x.drawImage(mid, -4, -4, COVER + 8, COVER + 8);
      x.filter = 'none';
      x.getImageData(0, 0, 1, 1);   // throws now if the image is cross-origin
      return c;
    } catch (e) {
      return null;
    }
  }

  // A color channel kept in 0–1 (NaN or junk → 0: never a NaN uniform)
  function ch(v) {
    return v > 0 ? (v < 1 ? +v : 1) : 0;
  }

  // Album colors → glow colors bright enough to light the show, and a dark
  // base with the hue of the background color
  function glowColor(src, dst, min) {
    var r = ch(src[0]), g = ch(src[1]), b = ch(src[2]), m = Math.max(r, g, b);
    if (m < 0.02) {
      dst[0] = dst[1] = dst[2] = min;
      return;
    }
    var k = m < min ? min / m : 1;
    dst[0] = r * k;
    dst[1] = g * k;
    dst[2] = b * k;
  }

  function baseColor(src, dst) {
    var r = ch(src[0]), g = ch(src[1]), b = ch(src[2]), m = Math.max(r, g, b, 0.1);
    dst[0] = r / m * 0.07 + 0.008;
    dst[1] = g / m * 0.07 + 0.008;
    dst[2] = b / m * 0.07 + 0.008;
  }

  var DEF_A = [0.36, 0.45, 1.0], DEF_B = [0.75, 0.35, 1.0], DEF_BG = [0.2, 0.25, 0.6];

  // The ribbons repeat after this much idle time (their drifts are multiples
  // of 0.1, see RIBBONS): the idle clock wraps there without a jump
  var RIB_PERIOD = 4000 * Math.PI;

  // ---------------------------------------------------------------------------
  // WebGL2
  // ---------------------------------------------------------------------------
  var gl = null, canvas = null, ready = false;
  var prog = null, U = {}, vao = null, coverTex = null, cover = null;
  var W = 0, H = 0, lastT = -1, idleT = 0, showT = 0;
  var shown = 0;       // the show amount of the last frame drawn
  var stale = true;    // the canvas lost its picture (start, resize, context restored)
  var cA = new Float32Array(3), cB = new Float32Array(3), cBase = new Float32Array(3);

  // True while something moves, and until one frame settles the picture: the
  // first one, after a resize or a restored context, and the idle frame once
  // the show has faded out
  function needsFrames(p) {
    return ready && (stale || p.show > 0.001 || shown > 0.001 || (!!p.idleMotion && p.idle !== 'image'));
  }

  var UNIFORMS = ['u_res', 'u_time', 'u_itime', 'u_idle', 'u_style', 'u_show', 'u_colA', 'u_colB',
    'u_base', 'u_audio', 'u_parts', 'u_coverOn', 'u_cover', 'u_coverSize', 'u_rib', 'u_viz', 'u_bands'];

  function compile(type, src) {
    var sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS) && !gl.isContextLost()) {
      throw new Error(gl.getShaderInfoLog(sh));
    }
    return sh;
  }

  function uploadCover() {
    if (!cover) return;
    gl.bindTexture(gl.TEXTURE_2D, coverTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cover);
    } catch (e) {
      cover = null;
    }
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  }

  function setup() {
    prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS) && !gl.isContextLost()) {
      throw new Error(gl.getProgramInfoLog(prog));
    }
    U = {};
    UNIFORMS.forEach(function (n) { U[n] = gl.getUniformLocation(prog, n); });
    gl.useProgram(prog);
    gl.uniform4fv(U.u_rib, RIBBONS);
    gl.uniform1i(U.u_cover, 0);
    gl.uniform2f(U.u_coverSize, COVER, COVER);

    coverTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, coverTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    uploadCover();

    vao = gl.createVertexArray();
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
  }

  function init(c) {
    canvas = c;
    try {
      gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false });
      if (!gl) return false;
      setup();
      ready = true;
    } catch (e) {
      if (window.console) console.warn('Lyric Stage: WebGL2 unavailable', e);
      ready = false;
      return false;
    }
    canvas.addEventListener('webglcontextlost', function (e) {
      e.preventDefault();
      ready = false;
    });
    canvas.addEventListener('webglcontextrestored', function () {
      try {
        setup();
        ready = true;
        stale = true;   // the canvas is blank: needsFrames() asks for a frame
      } catch (err) {
        ready = false;
      }
    });
    stale = true;
    return true;
  }

  function resize(w, h) {
    W = Math.max(1, Math.round(w));
    H = Math.max(1, Math.round(h));
    if (canvas && (canvas.width !== W || canvas.height !== H)) {
      canvas.width = W;
      canvas.height = H;
      stale = true;
    }
  }

  function setCover(src) {
    cover = shrinkCover(src, cover);
    if (ready && cover) uploadCover();
    stale = true;
  }

  /*
   * p: {
   *   time (s, monotonic), idle ('win11' | 'win11dark' | 'win10' | 'image'), idleMotion,
   *   show (0 = idle … 1 = show, already eased),
   *   style ('aurora' | 'spotlights' | 'cover' | 'minimal'),
   *   colA, colB ([r, g, b] 0–1: the two light colors; dark ones are lifted),
   *   colBg ([r, g, b] 0–1: the hue of the dark base, any brightness),
   *   bass, volume, beat (0–1), reactive (0–3, 0 = none), particles,
   *   hasCover (setCover got an image: the 'cover' style falls back to
   *   'aurora' without one)
   * }
   */
  function render(p) {
    if (!ready || gl.isContextLost()) return;
    if (!W) resize(canvas.width, canvas.height);
    var s = Math.min(1, Math.max(0, +p.show || 0));
    // Both clocks add up the steps of p.time (at most 0.25 s, so a pause makes
    // no jump) and stay small: a float uniform counting days of uptime would
    // step the motion and jag the edges. The show clock wraps while the show
    // is hidden (or every ~18 h when it never is), the idle one where the
    // ribbons repeat.
    var t = +p.time || 0, dt = lastT >= 0 && t > lastT ? Math.min(t - lastT, 0.25) : 0;
    lastT = t;
    if (p.idleMotion) idleT += dt;
    if (idleT > RIB_PERIOD && p.idle !== 'win10') idleT %= RIB_PERIOD;
    showT += dt;
    if (s <= 0.001 ? showT > 1000 : showT > 65536) showT %= 1000;
    shown = s;
    stale = false;
    var k = p.reactive > 0 ? p.reactive : 0;
    glowColor(p.colA || DEF_A, cA, 0.6);
    glowColor(p.colB || DEF_B, cB, 0.6);
    baseColor(p.colBg || DEF_BG, cBase);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    gl.useProgram(prog);
    gl.uniform2f(U.u_res, W, H);
    gl.uniform1f(U.u_time, showT);
    gl.uniform1f(U.u_itime, idleT);
    gl.uniform1i(U.u_idle, IDLE[p.idle] !== undefined ? IDLE[p.idle] : 0);
    gl.uniform1i(U.u_style, STYLE[p.style] !== undefined ? STYLE[p.style] : 0);
    gl.uniform1f(U.u_show, s);
    gl.uniform3fv(U.u_colA, cA);
    gl.uniform3fv(U.u_colB, cB);
    gl.uniform3fv(U.u_base, cBase);
    gl.uniform4f(U.u_audio, (p.bass || 0) * k, p.volume || 0, (p.beat || 0) * k, k);
    gl.uniform1f(U.u_parts, p.particles ? 1 : 0);
    gl.uniform1f(U.u_coverOn, p.hasCover && cover ? 1 : 0);
    gl.uniform4f(U.u_viz, VIZ[p.viz] || 0, +p.vizSize || 1, 0, 0);
    if (VIZ[p.viz] && p.bands) gl.uniform1fv(U.u_bands, p.bands);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, coverTex);
    gl.bindVertexArray(vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  S.gfx = {
    init: init,
    resize: resize,
    setCover: setCover,
    render: render,
    needsFrames: needsFrames,
    ok: function () { return ready; },
    canvas: function () { return canvas; }
  };

  // ---------------------------------------------------------------------------
  // Canvas 2D fallback: the same looks with gradients and pre-rendered sprites.
  // The idle look is drawn once into a cache (no idle motion), the show is a
  // few sprite draws per frame and the transition a plain cross-fade.
  // ---------------------------------------------------------------------------
  var c2 = {
    ctx: null, canvas: null, W: 0, H: 0,
    idle: null, idleName: '', idleW: 0, idleH: 0,   // cached idle look
    vig: null,                        // cached vignette
    cover: null, tiny: null,
    spr: null, sprKey: [-1, -1, -1, -1, -1, -1, -1, -1, -1], sprT: 0, pM: new Float32Array(3),
    baseCss: '#000', pA: new Float32Array(3), pB: new Float32Array(3), pBase: new Float32Array(3),
    shown: 0, stale: true,            // as in the WebGL renderer
    lastT: -1, t: 0                   // the show clock (steps of p.time, as there)
  };

  function css(r, g, b, a) {
    return 'rgba(' + Math.round(r * 255) + ', ' + Math.round(g * 255) + ', ' + Math.round(b * 255) + ', ' + a + ')';
  }

  function canvas2(w, h) {
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
  }

  // A soft round glow in one color (redrawn into s when given)
  function blobSprite(c, s) {
    s = s || canvas2(128, 128);
    var x = s.getContext('2d'), g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    x.clearRect(0, 0, 128, 128);
    g.addColorStop(0, css(c[0], c[1], c[2], 1));
    g.addColorStop(0.45, css(c[0], c[1], c[2], 0.4));
    g.addColorStop(1, css(c[0], c[1], c[2], 0));
    x.fillStyle = g;
    x.fillRect(0, 0, 128, 128);
    return s;
  }

  // A spotlight cone, apex at the top center, fading downward (redrawn into s
  // when given)
  function beamSprite(c, s) {
    s = s || canvas2(96, 512);
    var x = s.getContext('2d'), g = x.createLinearGradient(0, 0, 0, 512);
    x.clearRect(0, 0, 96, 512);
    g.addColorStop(0, css(c[0], c[1], c[2], 0.9));
    g.addColorStop(0.5, css(c[0], c[1], c[2], 0.35));
    g.addColorStop(1, css(c[0], c[1], c[2], 0));
    x.filter = 'blur(6px)';
    x.fillStyle = g;
    x.beginPath();
    x.moveTo(46, 0);
    x.lineTo(50, 0);
    x.lineTo(84, 512);
    x.lineTo(12, 512);
    x.closePath();
    x.fill();
    x.filter = 'none';
    return s;
  }

  function dotSprite() {
    var s = canvas2(32, 32), x = s.getContext('2d'), g = x.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, 'rgba(255, 255, 255, 1)');
    g.addColorStop(0.3, 'rgba(255, 255, 255, 0.45)');
    g.addColorStop(1, 'rgba(255, 255, 255, 0)');
    x.fillStyle = g;
    x.fillRect(0, 0, 32, 32);
    return s;
  }

  // Sprites follow the colors, re-rendered only when they change visibly, at
  // most 4 times a second while the colors ease (a blurred beam is costly on
  // the CPU) and into the same canvases
  function sprites2(A, B, base) {
    var k = c2.sprKey, changed = false, i, v;
    if (c2.spr && c2.t - c2.sprT < 0.25 && c2.t >= c2.sprT) return;
    for (i = 0; i < 9; i++) {
      v = Math.round((i < 3 ? A[i] : i < 6 ? B[i - 3] : base[i - 6]) * 48);
      if (k[i] !== v) {
        k[i] = v;
        changed = true;
      }
    }
    if (!changed && c2.spr) return;
    c2.sprT = c2.t;
    var M = c2.pM, sp = c2.spr;
    for (i = 0; i < 3; i++) M[i] = (A[i] + B[i]) / 2;
    if (!sp) sp = c2.spr = { A: null, B: null, M: null, bA: null, bB: null, dot: dotSprite() };
    sp.A = blobSprite(A, sp.A);
    sp.B = blobSprite(B, sp.B);
    sp.M = blobSprite(M, sp.M);
    sp.bA = beamSprite(A, sp.bA);
    sp.bB = beamSprite(B, sp.bB);
    c2.baseCss = css(base[0], base[1], base[2], 1);
  }

  function vignette2(W, H) {
    var v = canvas2(W, H), x = v.getContext('2d');
    var g = x.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, Math.max(W, H) * 0.75);
    g.addColorStop(0, 'rgba(0, 0, 0, 0)');
    g.addColorStop(1, 'rgba(0, 0, 0, 0.65)');
    x.fillStyle = g;
    x.fillRect(0, 0, W, H);
    return v;
  }

  // The 'win11' ribbons as filled bands (same table as the shader), with a
  // drop shadow on the light look and a glow on the dark one
  function ribbons2(x, W, H, dark) {
    var g = x.createLinearGradient(0, 0, 0, H);
    if (dark) {
      g.addColorStop(0, '#0a1224');
      g.addColorStop(1, '#070d1b');
    } else {
      g.addColorStop(0, '#e6eef8');
      g.addColorStop(1, '#d3e2f4');
    }
    x.fillStyle = g;
    x.fillRect(0, 0, W, H);
    var glow = x.createRadialGradient(W / 2, H * 0.45, 0, W / 2, H * 0.45, H * 0.8);
    glow.addColorStop(0, dark ? 'rgba(20, 60, 150, 0.45)' : 'rgba(255, 255, 255, 0.55)');
    glow.addColorStop(1, dark ? 'rgba(20, 60, 150, 0)' : 'rgba(255, 255, 255, 0)');
    x.fillStyle = glow;
    x.fillRect(0, 0, W, H);

    var N = 64, x0 = -W / H / 2 - 0.05, x1 = W / H / 2 + 0.05, top = [], bot = [];
    for (var r = 0; r < RIB_N; r++) {
      var o = r * 16, R = RIBBONS;
      top.length = bot.length = 0;
      for (var i = 0; i <= N; i++) {
        var qx = x0 + (x1 - x0) * i / N;
        var s1 = R[o + 3] * qx + R[o + 4], s2 = R[o + 6] * qx + R[o + 7];
        var y = R[o] + R[o + 1] * qx + R[o + 2] * Math.sin(s1) + R[o + 5] * Math.sin(s2);
        var dy = R[o + 1] + R[o + 2] * R[o + 3] * Math.cos(s1) + R[o + 5] * R[o + 6] * Math.cos(s2);
        var hw = R[o + 10] * (0.1 + 0.9 * Math.abs(Math.cos(R[o + 8] * qx + R[o + 9]))) * Math.sqrt(1 + dy * dy);
        var X = W / 2 + qx * H;
        top.push(X, H / 2 - (y + hw) * H);
        bot.push(X, H / 2 - (y - hw) * H);
      }
      x.beginPath();
      x.moveTo(top[0], top[1]);
      for (i = 2; i < top.length; i += 2) x.lineTo(top[i], top[i + 1]);
      for (i = bot.length - 2; i >= 0; i -= 2) x.lineTo(bot[i], bot[i + 1]);
      x.closePath();
      var tone = R[o + 12], al = R[o + 11];
      var lg = x.createLinearGradient(0, H * 0.2, 0, H * 0.8);
      if (dark) {
        lg.addColorStop(0, css(0.55 + 0.2 * tone, 0.76 + 0.1 * tone, 1, al));
        lg.addColorStop(1, css(0.07 + 0.15 * tone, 0.30 + 0.2 * tone, 0.85 + 0.1 * tone, al));
        x.shadowColor = 'rgba(70, 140, 255, 0.55)';
        x.shadowBlur = H * 0.04;
        x.shadowOffsetY = 0;
      } else {
        lg.addColorStop(0, css(0.56 + 0.25 * tone, 0.74 + 0.14 * tone, 1, al));
        lg.addColorStop(1, css(0.11 + 0.15 * tone, 0.37 + 0.15 * tone, 0.82 + 0.1 * tone, al));
        x.shadowColor = 'rgba(30, 70, 150, 0.18)';
        x.shadowBlur = H * 0.035;
        x.shadowOffsetY = H * 0.02;
      }
      x.fillStyle = lg;
      x.fill();
    }
    x.shadowColor = 'rgba(0, 0, 0, 0)';
    x.shadowBlur = 0;
    x.shadowOffsetY = 0;
  }

  // The 'win10' look: navy, a soft light at the right and shafts to the left
  function shafts2(x, W, H) {
    var g = x.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#001232');
    g.addColorStop(1, '#00081c');
    x.fillStyle = g;
    x.fillRect(0, 0, W, H);
    var sx = W / 2 + W * 0.25, sy = H / 2 - 0.03 * H;
    var glow = x.createRadialGradient(sx, sy, 0, sx, sy, H * 0.7);
    glow.addColorStop(0, 'rgba(60, 130, 255, 0.7)');
    glow.addColorStop(0.3, 'rgba(11, 61, 145, 0.45)');
    glow.addColorStop(1, 'rgba(11, 61, 145, 0)');
    x.fillStyle = glow;
    x.fillRect(0, 0, W, H);
    x.globalCompositeOperation = 'lighter';
    x.filter = 'blur(' + Math.round(H * 0.012) + 'px)';
    var len = W * 1.2, seeds = [-0.55, -0.38, -0.27, -0.12, -0.02, 0.09, 0.2, 0.33, 0.47, 0.6];
    for (var i = 0; i < seeds.length; i++) {
      var a = Math.PI + seeds[i], w = 0.02 + 0.03 * ((i * 7) % 3) / 2;
      var bg = x.createRadialGradient(sx, sy, 0, sx, sy, len);
      bg.addColorStop(0, 'rgba(110, 170, 255, 0.28)');
      bg.addColorStop(1, 'rgba(110, 170, 255, 0)');
      x.fillStyle = bg;
      x.beginPath();
      x.moveTo(sx, sy);
      x.lineTo(sx + Math.cos(a - w) * len, sy - Math.sin(a - w) * len);
      x.lineTo(sx + Math.cos(a + w) * len, sy - Math.sin(a + w) * len);
      x.closePath();
      x.fill();
    }
    x.filter = 'none';
    var core = x.createRadialGradient(sx, sy, 0, sx, sy, H * 0.06);
    core.addColorStop(0, 'rgba(200, 225, 255, 0.9)');
    core.addColorStop(1, 'rgba(200, 225, 255, 0)');
    x.fillStyle = core;
    x.fillRect(sx - H * 0.06, sy - H * 0.06, H * 0.12, H * 0.12);
    x.globalCompositeOperation = 'source-over';
  }

  function idle2(idle) {
    if (c2.idle && c2.idleName === idle && c2.idleW === c2.W && c2.idleH === c2.H) return c2.idle;
    var c = c2.idle && c2.idle.width === c2.W && c2.idle.height === c2.H ? c2.idle : canvas2(c2.W, c2.H);
    var x = c.getContext('2d');
    x.clearRect(0, 0, c2.W, c2.H);
    if (idle === 'win10') shafts2(x, c2.W, c2.H);
    else ribbons2(x, c2.W, c2.H, idle === 'win11dark');
    c2.idle = c;
    c2.idleName = idle;
    c2.idleW = c2.W;
    c2.idleH = c2.H;
    return c;
  }

  function sprite2(x, img, cx, cy, r, a) {
    if (a <= 0.003) return;
    x.globalAlpha = Math.min(1, a);
    x.drawImage(img, cx - r, cy - r, r * 2, r * 2);
  }

  function show2(x, p, W, H) {
    var t = c2.t, k = p.reactive > 0 ? p.reactive : 0;
    var bass = (p.bass || 0) * k, beat = (p.beat || 0) * k;
    var pk = 0.22 * bass + 0.16 * beat, pulse = 1 + pk / (1 + 0.6 * pk), sp = c2.spr, asp = W / H;
    var X = W / 2, Y = H / 2, i;
    x.globalAlpha = 1;
    x.globalCompositeOperation = 'source-over';
    x.fillStyle = c2.baseCss;
    x.fillRect(0, 0, W, H);
    var style = p.style === 'cover' && !(p.hasCover && c2.cover) ? 'aurora' : p.style;
    if (style === 'cover') {
      var side = Math.max(W, H) * (1.12 + 0.04 * Math.sin(t * 0.05));
      x.imageSmoothingEnabled = true;
      x.drawImage(c2.tiny, X - side / 2 + Math.sin(t * 0.031) * H * 0.03, Y - side / 2, side, side);
      x.fillStyle = 'rgba(0, 0, 0, 0.62)';
      x.fillRect(0, 0, W, H);
    }
    x.globalCompositeOperation = 'lighter';
    if (style === 'spotlights') {
      for (i = 0; i < 4; i++) {
        var ox = X + (i / 3 - 0.5) * asp * 0.72 * H, oy = Y - 0.48 * H;
        var ang = 0.42 * Math.sin(t * (0.19 + 0.05 * i) + i * 2.1) - (i / 3 - 0.5) * 0.35;
        var cs = Math.cos(ang), sn = Math.sin(ang), L = H * 1.3;
        x.globalAlpha = Math.min(1, 0.55 * pulse);
        x.setTransform(cs, sn, -sn, cs, ox, oy);
        x.drawImage(i % 2 ? sp.bB : sp.bA, -L * 0.1875, 0, L * 0.375, L);
        x.setTransform(1, 0, 0, 1, 0, 0);
        sprite2(x, sp.dot, ox, oy, H * 0.04, 0.9);
      }
      sprite2(x, sp.M, X, H * 1.05, H * 0.6, 0.3 * pulse);
    } else if (style === 'minimal') {
      sprite2(x, sp.A, X, Y + 0.55 * H, H * 0.7, 0.22 * pulse);
    } else if (style === 'aurora') {
      sprite2(x, sp.A, X + asp * 0.32 * Math.sin(t * 0.043) * H, Y + (0.28 - 0.10 * Math.sin(t * 0.031 + 1)) * H, H * 0.75, 0.42 * pulse);
      sprite2(x, sp.B, X - asp * 0.30 * Math.sin(t * 0.037 + 2.3) * H, Y - (0.24 + 0.08 * Math.sin(t * 0.047 + 4)) * H, H * 0.8, 0.40 * pulse);
      sprite2(x, sp.M, X + asp * 0.2 * Math.cos(t * 0.029) * H, Y, H * 0.9, 0.18 * pulse);
    } else {
      sprite2(x, sp.A, X, Y + 0.6 * H, H * 0.8, 0.12 * pulse);
    }
    if (p.particles) {
      // Spread by the 2D plastic-number sequence (the golden ratio for both
      // axes would put every dot on one diagonal line until they drift apart)
      for (i = 0; i < 60; i++) {
        var hx = (i * 0.7548777 + 0.5) % 1, hy = (i * 0.5698403 + 0.5) % 1, hs = (i * 0.6180339) % 1;
        var py = 1 - ((hy + t * (0.015 + 0.02 * hs)) % 1);
        var pxx = (hx + 0.01 * Math.sin(t * 0.5 + i)) * W;
        sprite2(x, sp.dot, pxx, py * H, H * (0.004 + 0.008 * hs), (0.25 + 0.2 * Math.sin(t * (0.7 + hs) + i)) * (0.8 + 0.5 * bass));
      }
    }
    x.globalCompositeOperation = 'source-over';
    x.globalAlpha = 1;
    if (!c2.vig || c2.vig.width !== W || c2.vig.height !== H) c2.vig = vignette2(W, H);
    x.drawImage(c2.vig, 0, 0);
  }

  // The visualizer on Canvas 2D: bars along the bottom whatever the style
  function viz2(x, p, W, H, alpha) {
    var n = VIZ_N, w = W * 0.56, x0 = (W - w) / 2, bw = w / n, k = +p.vizSize || 1;
    x.globalAlpha = 0.8 * alpha;
    x.fillStyle = 'rgb(' + Math.round(c2.pA[0] * 255) + ',' + Math.round(c2.pA[1] * 255) + ',' + Math.round(c2.pA[2] * 255) + ')';
    for (var i = 0; i < n; i++) {
      var h = H * (0.006 + 0.16 * k * p.bands[i]);
      x.fillRect(x0 + i * bw + bw * 0.12, H * 0.97 - h, bw * 0.76, h);
    }
    x.globalAlpha = 1;
  }

  function render2(p) {
    var x = c2.ctx;
    if (!x) return;
    var W = c2.W || c2.canvas.width, H = c2.H || c2.canvas.height;
    c2.W = W;
    c2.H = H;
    var s = Math.min(1, Math.max(0, +p.show || 0)), image = p.idle === 'image';
    var t = +p.time || 0;
    c2.t += c2.lastT >= 0 && t > c2.lastT ? Math.min(t - c2.lastT, 0.25) : 0;
    c2.lastT = t;
    c2.shown = s;
    c2.stale = false;
    glowColor(p.colA || DEF_A, c2.pA, 0.6);
    glowColor(p.colB || DEF_B, c2.pB, 0.6);
    baseColor(p.colBg || DEF_BG, c2.pBase);
    sprites2(c2.pA, c2.pB, c2.pBase);
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.globalAlpha = 1;
    x.globalCompositeOperation = 'source-over';
    if (s <= 0.001) {
      if (image) x.clearRect(0, 0, W, H);
      else x.drawImage(idle2(p.idle), 0, 0);
      return;
    }
    show2(x, p, W, H);
    if (VIZ[p.viz] && p.bands && s > 0.5) viz2(x, p, W, H, (s - 0.5) * 2);
    if (s >= 0.999) return;
    if (image) {
      // Fade the show itself: the image under the canvas shows through
      x.globalCompositeOperation = 'destination-in';
      x.globalAlpha = s;
      x.fillStyle = '#000';
      x.fillRect(0, 0, W, H);
      x.globalAlpha = 1;
      x.globalCompositeOperation = 'source-over';
    } else {
      x.globalAlpha = 1 - s;
      x.drawImage(idle2(p.idle), 0, 0);
      x.globalAlpha = 1;
    }
  }

  // The cover shrunk once more: drawn stretched over the screen, 16 pixels
  // blur nicely without a filter
  function setCover2(src) {
    c2.cover = shrinkCover(src, c2.cover);
    c2.stale = true;
    if (!c2.cover) return;
    var t = c2.tiny || canvas2(16, 16), x = t.getContext('2d');
    x.imageSmoothingEnabled = true;
    x.imageSmoothingQuality = 'high';
    x.clearRect(0, 0, 16, 16);
    x.drawImage(c2.cover, 0, 0, 16, 16);
    c2.tiny = t;
  }

  function init2(c) {
    var x = c.getContext('2d');
    if (!x && c.parentNode) {
      // The canvas already holds a WebGL context (WebGL2 started but failed):
      // swap in a fresh canvas with the same id and classes
      var n = c.cloneNode(false);
      c.parentNode.replaceChild(n, c);
      c = n;
      x = c.getContext('2d');
    }
    c2.canvas = c;
    c2.ctx = x;
    c2.stale = true;
    return !!x;
  }

  function resize2(w, h) {
    c2.W = Math.max(1, Math.round(w));
    c2.H = Math.max(1, Math.round(h));
    if (c2.canvas && (c2.canvas.width !== c2.W || c2.canvas.height !== c2.H)) {
      c2.canvas.width = c2.W;
      c2.canvas.height = c2.H;
      c2.stale = true;
    }
  }

  S.gfx2d = {
    init: init2,
    resize: resize2,
    setCover: setCover2,
    render: render2,
    // No idle motion here: only the show and the transition move
    needsFrames: function (p) { return !!c2.ctx && (c2.stale || p.show > 0.001 || c2.shown > 0.001); },
    ok: function () { return !!c2.ctx; },
    canvas: function () { return c2.canvas; }
  };
})(window.Lyric = window.Lyric || {});
