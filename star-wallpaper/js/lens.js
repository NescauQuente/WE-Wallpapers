/*
 * Starry Orbit — gravitational lens (WebGL2).
 *
 * Post-processing: the 2D scene becomes a texture and a shader displaces each
 * pixel according to its distance to each wave front. The front is not a
 * circle: it is a curve with FRONT_N radii (one per angle), bent by the weight
 * of the stars.
 *
 * Unlike a ripple on water, a gravitational wave does not push things along
 * its path: it is transverse. Space stretches along one axis and squeezes
 * along the perpendicular one ("+" polarization), swapping every half wave,
 * and the axes turn as it passes. The stretch is traceless (the area is
 * kept), so it makes no light or dark bands either. The supermassive black
 * hole radiates like a merging binary: a two-armed spiral that shears space
 * along its arms.
 *
 * It also renders the click-and-drag black hole: a point-mass lens (the inner
 * image is flipped, as in real lensing), frame dragging that swirls space
 * around it, the event-horizon shadow and a soft photon-ring glow.
 *
 * During a hyperspace jump it also blurs the whole scene outward from the
 * center of each galaxy (zoom blur).
 *
 * Only visible while waves, the black hole or a jump exist; without WebGL2
 * the wallpaper runs without it.
 */
(function (S) {
  'use strict';

  var MAX_WAVES = 8;
  var FRONT_N = 128;
  // Spiral waves: a wider train of crests (envelope width, in wave widths)
  // and a longer wavelength, so the arms read as a spiral
  var SPIRAL_SIGMA = 2.4;
  var SPIRAL_K = 1.4;
  var SPIRAL_BUNCH = 0.6;   // radial part of the spiral (arms where space bunches up)

  var VS = [
    '#version 300 es',
    'in vec2 a_pos;',
    'void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }'
  ].join('\n');

  var FS = [
    '#version 300 es',
    'precision highp float;',
    'uniform sampler2D u_scene;',
    'uniform highp sampler2D u_front;',
    'uniform vec2 u_res;',
    'uniform int u_count;',
    'uniform vec4 u_wave[' + MAX_WAVES + '];   // origin x, y, width, amplitude (px)',
    'uniform vec4 u_clip[' + MAX_WAVES + '];   // start x, end x, phase, spiral (0 or 1)',
    'uniform vec4 u_hole;       // x, y, Einstein radius, shadow radius (px); radius 0 = off',
    'uniform vec4 u_holeB;      // swirl angle, swirl radius (px), ring glow, disk rotation',
    'uniform vec3 u_holeColor;',
    'uniform vec4 u_disk;       // accretion disk: intensity, inner radius, outer radius, flattening',
    'uniform vec4 u_warp;       // hyperspace: blur amount (0 = off), galaxy width (px), galaxies, -',
    'uniform vec2 u_warpC[4];   // center of each galaxy (px)',
    'out vec4 outColor;',
    'const int N = ' + FRONT_N + ';',
    'const float TAU = 6.28318530718;',
    '',
    '// Front radius at angle phi (interpolated between samples)',
    'float frontAt(int k, float phi) {',
    '  float f = (phi / TAU + 0.5) * float(N);',
    '  float fl = floor(f);',
    '  int i0 = int(fl) % N;',
    '  int i1 = (i0 + 1) % N;',
    '  float a = texelFetch(u_front, ivec2(i0, k), 0).r;',
    '  float b = texelFetch(u_front, ivec2(i1, k), 0).r;',
    '  return mix(a, b, f - fl);',
    '}',
    '',
    'vec3 scene(vec2 p) {',
    '  // Uploaded without flipping: row 0 is the top of the scene',
    '  return texture(u_scene, p / u_res).rgb;',
    '}',
    '',
    'void main() {',
    '  vec2 p = vec2(gl_FragCoord.x, u_res.y - gl_FragCoord.y);',
    '  vec2 src = p;',
    '  vec2 off = vec2(0.0);',
    '  float shade = 1.0;',
    '  vec3 ring = vec3(0.0);',
    '',
    '  // Black hole: point-mass lens β = θ − θE²/θ (inside θE the image flips),',
    '  // fading out far away so the screen edges stay put',
    '  if (u_hole.z > 0.5) {',
    '    vec2 hd = p - u_hole.xy;',
    '    float r = max(length(hd), 0.001);',
    '    float rE = u_hole.z;',
    '    float win = smoothstep(rE * 12.0, rE * 4.0, r);',
    '    float rs = r - win * rE * rE / max(r, rE * 0.2);',
    '    // Frame dragging: space near the hole is swirled around it',
    '    float ang = u_holeB.x * exp(-r / u_holeB.y);',
    '    float ca = cos(ang), sa = sin(ang);',
    '    vec2 dir = hd / r;',
    '    dir = vec2(ca * dir.x - sa * dir.y, sa * dir.x + ca * dir.y);',
    '    src = u_hole.xy + dir * rs;',
    '    shade = smoothstep(u_hole.w * 0.8, u_hole.w * 1.25, r);',
    '    // Soft photon ring + diffuse halo, brighter on the side spinning toward',
    '    // us (Doppler beaming); the hot spot turns with the disk',
    '    float beam = 0.45 + 0.55 * (0.5 + 0.5 * cos(atan(hd.y, hd.x) - u_holeB.w));',
    '    float rr = (r - rE * 1.12) / (rE * 0.32);',
    '    float halo = (r - rE * 1.6) / (rE * 1.1);',
    '    ring = u_holeColor * (u_holeB.z * beam * (exp(-rr * rr) + 0.25 * exp(-halo * halo)));',
    '',
    '    // Supermassive easter egg: an orange accretion disk seen almost edge-on.',
    '    // The far half hides behind the shadow and reappears lensed as an arc',
    '    // wrapped above and below it; the approaching (left) side is brighter.',
    '    if (u_disk.x > 0.001) {',
    '      vec2 dp = vec2(hd.x, hd.y / u_disk.w);',
    '      float rho = length(dp);',
    '      float band = smoothstep(u_disk.y * 0.9, u_disk.y * 1.15, rho) * (1.0 - smoothstep(u_disk.z * 0.55, u_disk.z, rho));',
    '      float heat = 1.0 - smoothstep(u_disk.y, u_disk.z, rho);',
    '      float a = atan(dp.y, dp.x);',
    '      float spin = u_holeB.w * (1.0 + 2.0 * heat);',
    '      float streak = 0.74 + 0.26 * sin(a * 5.0 - spin * 1.6 + rho * 0.035) * sin(a * 3.0 + spin + rho * 0.013);',
    '      float dop = 0.45 + 0.55 * (0.5 - 0.5 * clamp(dp.x / max(rho, 1.0), -1.0, 1.0));',
    '      vec3 hot = mix(vec3(1.0, 0.42, 0.08), vec3(1.0, 0.92, 0.75), heat * heat);',
    '      float occl = hd.y < 0.0 ? shade : 1.0;',
    '      vec3 disk = hot * band * streak * dop * occl * (0.5 + 1.4 * heat);',
    '      float ra = (r - u_hole.w * 1.45) / (u_hole.w * 0.42);',
    '      float wrap = exp(-ra * ra) * (0.35 + 0.65 * abs(hd.y) / r);',
    '      disk += vec3(1.0, 0.64, 0.3) * wrap * dop * 0.9;',
    '      ring += disk * u_disk.x;',
    '    }',
    '  }',
    '',
    '  for (int k = 0; k < ' + MAX_WAVES + '; k++) {',
    '    if (k >= u_count) break;',
    '    vec4 w = u_wave[k];',
    '    vec4 c = u_clip[k];',
    '    if (p.x < c.x || p.x > c.y) continue;',
    '    vec2 d = p - w.xy;',
    '    float dist = length(d);',
    '    if (dist < 1.0) continue;',
    '    float phi = atan(d.y, d.x);',
    '    float s = (dist - frontAt(k, phi)) / w.z;',
    '    // Spiral waves trail a long train of arms behind the front',
    '    float sig = c.w > 0.5 && s < 0.0 ? ' + SPIRAL_SIGMA.toFixed(2) + ' : 1.0;',
    '    if (abs(s) > 3.2 * sig) continue;',
    '    float env = exp(-0.5 * s * s / (sig * sig)) * w.w;',
    '    if (c.w > 0.5) {',
    '      // Spiral: two arms, shearing space along them and bunching it up;',
    '      // calm right at the source, where the arms would wind too tight',
    '      float ph = ' + SPIRAL_K.toFixed(2) + ' * s + 2.0 * phi + c.z;',
    '      vec2 u = d / dist;',
    '      env *= smoothstep(0.0, 4.0 * w.z, dist);',
    '      off += (vec2(-u.y, u.x) * sin(ph) + u * (' + SPIRAL_BUNCH.toFixed(2) + ' * cos(ph))) * env;',
    '    } else {',
    '      // "+": stretched along the axis at angle c.z / 2, squeezed across it;',
    '      // the axes swap every half wave',
    '      float a = c.z - phi;',
    '      off += vec2(cos(a), sin(a)) * (env * sin(2.4 * s));',
    '    }',
    '  }',
    '  vec2 q = src - off;',
    '  vec3 col;',
    '  if (u_warp.x > 0.0005) {',
    '    // Hyperspace: everything streaks outward from the center of its galaxy',
    '    int ri = int(clamp(floor(p.x / u_warp.y), 0.0, u_warp.z - 1.0));',
    '    vec2 c = u_warpC[ri];',
    '    vec2 dv = q - c;',
    '    col = vec3(0.0);',
    '    for (int i = 0; i < 8; i++) col += scene(c + dv * (1.0 - u_warp.x * float(i) / 7.0));',
    '    col *= 0.125;',
    '  } else {',
    '    col = scene(q);',
    '  }',
    '  outColor = vec4(col * shade + ring, 1.0);',
    '}'
  ].join('\n');

  var canvas = null, gl = null, ok = false, visible = false;
  var prog = null, sceneTex = null, frontTex = null, loc = {};
  var texW = 0, texH = 0;   // size of the scene texture storage
  var frontData = new Float32Array(FRONT_N * MAX_WAVES);
  var waveData = new Float32Array(4 * MAX_WAVES);
  var clipData = new Float32Array(4 * MAX_WAVES);

  function compile(type, src) {
    var sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      var log = gl.getShaderInfoLog(sh);
      gl.deleteShader(sh);
      throw new Error('shader: ' + log);
    }
    return sh;
  }

  function setup() {
    prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS));
    gl.bindAttribLocation(prog, 0, 'a_pos');
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('link: ' + gl.getProgramInfoLog(prog));
    gl.useProgram(prog);

    ['u_scene', 'u_front', 'u_res', 'u_count', 'u_wave', 'u_clip', 'u_hole', 'u_holeB', 'u_holeColor', 'u_disk',
      'u_warp', 'u_warpC'].forEach(function (n) {
      loc[n] = gl.getUniformLocation(prog, n);
    });

    // Triangle covering the whole screen
    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    sceneTex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sceneTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    texW = texH = 0;

    frontTex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, frontTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, FRONT_N, MAX_WAVES, 0, gl.RED, gl.FLOAT, null);

    gl.uniform1i(loc.u_scene, 0);
    gl.uniform1i(loc.u_front, 1);
  }

  function init() {
    canvas = document.createElement('canvas');
    canvas.id = 'so-lens';
    canvas.setAttribute('aria-hidden', 'true');
    var stars = document.getElementById('so-stars');
    stars.parentNode.insertBefore(canvas, stars.nextSibling);

    try {
      gl = canvas.getContext('webgl2', {
        alpha: false, antialias: false, depth: false, stencil: false,
        premultipliedAlpha: false, preserveDrawingBuffer: false
      });
      if (!gl) return false;
      setup();
    } catch (e) {
      if (window.console) console.warn('Starry Orbit: lens disabled (' + e.message + ')');
      gl = null;
      return false;
    }

    canvas.addEventListener('webglcontextlost', function (e) {
      e.preventDefault();
      ok = false;
      hide();
    });
    canvas.addEventListener('webglcontextrestored', function () {
      try { setup(); ok = true; } catch (e) { ok = false; }
    });

    ok = true;
    return true;
  }

  function show() {
    if (!visible) { canvas.style.visibility = 'visible'; visible = true; }
  }

  function hide() {
    if (visible) { canvas.style.visibility = 'hidden'; visible = false; }
  }

  // source = 2D scene canvas; list = [{ front, x, y, width, amp, x0, x1, phase, spiral }]
  // hole = null or { x, y, rE, shadow, swirl, swirlR, glow, spin, color: [r, g, b],
  //                   disk: null or { intensity, inner, outer, flat } }
  // warp = null or { amount, w (galaxy width), n (galaxies, up to 4), centers: [x, y, …] }
  function render(source, list, hole, warp) {
    if (!ok) return false;
    if (canvas.width !== source.width || canvas.height !== source.height) {
      canvas.width = source.width;
      canvas.height = source.height;
    }
    var n = Math.min(list.length, MAX_WAVES);
    for (var k = 0; k < n; k++) {
      var wv = list[k], o = k * 4, f = wv.front, base = k * FRONT_N;
      // Binomial 5-tap smoothing around the circle: the stars still bend the
      // front, but single-sample spikes would tear the image
      for (var i = 0; i < FRONT_N; i++) {
        frontData[base + i] = (f[(i + FRONT_N - 2) % FRONT_N] + f[(i + 2) % FRONT_N] +
          4 * (f[(i + FRONT_N - 1) % FRONT_N] + f[(i + 1) % FRONT_N]) + 6 * f[i]) / 16;
      }
      waveData[o] = wv.x; waveData[o + 1] = wv.y; waveData[o + 2] = wv.width; waveData[o + 3] = wv.amp;
      clipData[o] = wv.x0; clipData[o + 1] = wv.x1; clipData[o + 2] = wv.phase; clipData[o + 3] = wv.spiral ? 1 : 0;
    }

    gl.viewport(0, 0, canvas.width, canvas.height);

    // The scene is copied into storage allocated once per size, instead of a
    // new texture every frame
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sceneTex);
    if (texW !== source.width || texH !== source.height) {
      texW = source.width;
      texH = source.height;
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, texW, texH, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    }
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, source);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, frontTex);
    if (n > 0) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, FRONT_N, n, gl.RED, gl.FLOAT, frontData.subarray(0, FRONT_N * n));

    gl.uniform2f(loc.u_res, canvas.width, canvas.height);
    gl.uniform1i(loc.u_count, n);
    gl.uniform4fv(loc.u_wave, waveData);
    gl.uniform4fv(loc.u_clip, clipData);
    if (hole) {
      gl.uniform4f(loc.u_hole, hole.x, hole.y, hole.rE, hole.shadow);
      gl.uniform4f(loc.u_holeB, hole.swirl, hole.swirlR, hole.glow, hole.spin || 0);
      gl.uniform3f(loc.u_holeColor, hole.color[0], hole.color[1], hole.color[2]);
      var dk = hole.disk;
      if (dk) gl.uniform4f(loc.u_disk, dk.intensity, dk.inner, dk.outer, dk.flat);
      else gl.uniform4f(loc.u_disk, 0, 0, 0, 1);
    } else {
      gl.uniform4f(loc.u_hole, 0, 0, 0, 0);
      gl.uniform4f(loc.u_disk, 0, 0, 0, 1);
    }
    if (warp) {
      gl.uniform4f(loc.u_warp, warp.amount, warp.w, warp.n, 0);
      gl.uniform2fv(loc.u_warpC, warp.centers);
    } else {
      gl.uniform4f(loc.u_warp, 0, 1, 1, 0);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    show();
    return true;
  }

  S.lens = {
    init: init, render: render, hide: hide,
    ok: function () { return ok; },
    FRONT_N: FRONT_N, MAX_WAVES: MAX_WAVES,
    SPIRAL_SIGMA: SPIRAL_SIGMA, SPIRAL_K: SPIRAL_K, SPIRAL_BUNCH: SPIRAL_BUNCH
  };
})(window.Starry = window.Starry || {});
