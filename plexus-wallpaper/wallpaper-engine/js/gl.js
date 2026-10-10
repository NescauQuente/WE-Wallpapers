/*
 * Neural Plexus — WebGL2 renderer.
 *
 * 1. Scene (additive, half-float when the GPU allows it): triangles, then the
 *    connections as anti-aliased quads, then the nodes, rings and signals as
 *    point quads (glow, or a bokeh disc when out of focus). All instanced:
 *    three buffer uploads and three draw calls per frame.
 * 2. Bloom: the scene halved twice, blurred at 1/4 and again at 1/8.
 * 3. Composite: background with drifting haze and a vignette, the scene
 *    (bent by shockwaves with a touch of chromatic aberration, or zoom-blurred
 *    in hyperspeed), the bloom, a soft highlight roll-off and dithering.
 */
(function (S) {
  'use strict';

  var scene = S.scene;
  var gl = null, canvas = null, ready = false, hdr = false;
  var P = {}, vao = {}, buf = {}, cap = { line: 0, point: 0, tri: 0 };
  var T = {};   // render targets
  var W = 0, H = 0;

  var HEADER = '#version 300 es\nprecision highp float;\n';

  var PALETTE = [
    'uniform vec3 u_colA, u_colB, u_colP;',
    'uniform float u_rainbow, u_rbOff;',
    'vec3 hue(float h) {',
    '  return clamp(abs(fract(h + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0) - 1.0, 0.0, 1.0);',
    '}',
    'vec3 palette(float m) {',
    '  if (u_rainbow > 0.5) return mix(vec3(0.85), hue(m + u_rbOff), 0.85);',
    '  return mix(u_colA, u_colB, clamp(m, 0.0, 1.0));',
    '}'
  ].join('\n');

  var VS_LINE = HEADER + [
    'layout(location = 0) in vec2 a_corner;',   // x 0..1 along, y -1..1 across
    'layout(location = 1) in vec4 a_p;',        // x0 y0 x1 y1
    'layout(location = 2) in vec2 a_a;',        // alpha at each end
    'layout(location = 3) in vec4 a_wmh;',      // width, mix0, mix1, heat
    'layout(location = 4) in float a_soft;',
    'uniform vec2 u_res;',
    'out float v_a, v_m, v_heat, v_d, v_hw, v_soft;',
    'void main() {',
    '  vec2 d = a_p.zw - a_p.xy;',
    '  float len = length(d);',
    '  vec2 dir = len > 1e-3 ? d / len : vec2(1.0, 0.0);',
    '  vec2 n = vec2(-dir.y, dir.x);',
    '  float hw = max(a_wmh.x, 1.0) * 0.5;',
    '  float ext = hw * (1.0 + a_soft * 1.5) + 1.0;',
    '  vec2 pos = mix(a_p.xy, a_p.zw, a_corner.x) + dir * (a_corner.x * 2.0 - 1.0) + n * a_corner.y * ext;',
    '  v_d = a_corner.y * ext;',
    '  v_hw = hw;',
    '  v_soft = a_soft;',
    // Lines thinner than a pixel stay a pixel wide, fainter
    '  v_a = mix(a_a.x, a_a.y, a_corner.x) * min(a_wmh.x, 1.0);',
    '  v_m = mix(a_wmh.y, a_wmh.z, a_corner.x);',
    '  v_heat = a_wmh.w;',
    '  vec2 c = pos / u_res * 2.0 - 1.0;',
    '  gl_Position = vec4(c.x, -c.y, 0.0, 1.0);',
    '}'
  ].join('\n');

  var FS_LINE = HEADER + PALETTE + '\n' + [
    'in float v_a, v_m, v_heat, v_d, v_hw, v_soft;',
    'out vec4 o;',
    'void main() {',
    '  float ad = abs(v_d), cover;',
    '  if (v_soft > 0.02) {',
    '    float sw = v_hw * (1.0 + v_soft * 1.5) + 0.5;',
    '    cover = exp(-2.0 * ad * ad / (sw * sw)) / (1.0 + v_soft);',
    '  } else {',
    '    cover = clamp(v_hw + 0.5 - ad, 0.0, 1.0);',
    '  }',
    '  vec3 c = mix(palette(v_m), u_colP, v_heat);',
    '  o = vec4(c * (v_a * cover), 1.0);',
    '}'
  ].join('\n');

  var VS_POINT = HEADER + [
    'layout(location = 0) in vec2 a_corner;',   // -1..1
    'layout(location = 1) in vec4 a_pt;',       // x y size alpha
    'layout(location = 2) in vec4 a_mhs;',      // mix heat shape soft
    'uniform vec2 u_res;',
    'uniform float u_glow;',
    'out vec2 v_local;',
    'out float v_r, v_alpha, v_mix, v_heat, v_shape, v_soft;',
    'void main() {',
    '  float r = a_pt.z * 0.5, ext;',
    '  if (a_mhs.z > 0.5) ext = r + a_mhs.w * 3.0 + 2.0;',
    '  else ext = max(r, 0.5) * max(1.0 + a_mhs.w * 4.0, 1.0 + 3.6 * u_glow) + 2.0;',
    '  vec2 pos = a_pt.xy + a_corner * ext;',
    '  v_local = a_corner * ext;',
    '  v_r = r;',
    '  v_alpha = a_pt.w;',
    '  v_mix = a_mhs.x;',
    '  v_heat = a_mhs.y;',
    '  v_shape = a_mhs.z;',
    '  v_soft = a_mhs.w;',
    '  vec2 c = pos / u_res * 2.0 - 1.0;',
    '  gl_Position = vec4(c.x, -c.y, 0.0, 1.0);',
    '}'
  ].join('\n');

  var FS_POINT = HEADER + PALETTE + '\n' + [
    'uniform float u_glow;',
    'in vec2 v_local;',
    'in float v_r, v_alpha, v_mix, v_heat, v_shape, v_soft;',
    'out vec4 o;',
    'void main() {',
    '  float d = length(v_local), I;',
    '  vec3 c = mix(palette(v_mix), u_colP, v_heat);',
    '  if (v_shape > 0.5) {',
    '    float k = (d - v_r) / max(v_soft, 0.75);',
    '    I = exp(-k * k);',
    '  } else {',
    '    float rr = max(v_r, 0.5);',
    // Out of focus: the same light spread over a wider disc with a brighter rim
    '    float br = rr * (1.0 + v_soft * 4.0);',
    '    float disc = clamp(br - d + 0.5, 0.0, 1.0) * (rr * rr) / (br * br);',
    '    disc *= 1.0 + v_soft * 0.9 * smoothstep(br * 0.55, br, d);',
    '    float hs = rr * 2.6 + 1.0;',
    '    float halo = u_glow * 0.45 * exp(-d * d / (hs * hs)) * (1.0 - 0.75 * v_soft);',
    '    I = disc + halo;',
    '    c += vec3(v_heat * 0.4) * disc;',     // white-hot core
    '  }',
    '  o = vec4(c * (I * v_alpha), 1.0);',
    '}'
  ].join('\n');

  var VS_TRI = HEADER + [
    'layout(location = 0) in vec4 a_v;',        // x y alpha mix
    'uniform vec2 u_res;',
    'out float v_a, v_m;',
    'void main() {',
    '  v_a = a_v.z;',
    '  v_m = a_v.w;',
    '  vec2 c = a_v.xy / u_res * 2.0 - 1.0;',
    '  gl_Position = vec4(c.x, -c.y, 0.0, 1.0);',
    '}'
  ].join('\n');

  var FS_TRI = HEADER + PALETTE + '\n' + [
    'in float v_a, v_m;',
    'out vec4 o;',
    'void main() { o = vec4(palette(v_m) * v_a, 1.0); }'
  ].join('\n');

  // Full-screen triangle without buffers
  var VS_FULL = HEADER + [
    'out vec2 v_uv;',
    'void main() {',
    '  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));',
    '  v_uv = p;',
    '  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);',
    '}'
  ].join('\n');

  // 4 bilinear taps = a 4×4 box: halves the size smoothly
  var FS_DOWN = HEADER + [
    'uniform sampler2D u_tex;',
    'uniform vec2 u_texel;',
    'in vec2 v_uv;',
    'out vec4 o;',
    'void main() {',
    '  vec2 t = u_texel;',
    '  o = 0.25 * (texture(u_tex, v_uv + vec2(-t.x, -t.y)) + texture(u_tex, v_uv + vec2(t.x, -t.y))',
    '    + texture(u_tex, v_uv + vec2(-t.x, t.y)) + texture(u_tex, v_uv + vec2(t.x, t.y)));',
    '}'
  ].join('\n');

  // 9-tap Gaussian in 5 bilinear taps
  var FS_BLUR = HEADER + [
    'uniform sampler2D u_tex;',
    'uniform vec2 u_dir;',
    'in vec2 v_uv;',
    'out vec4 o;',
    'void main() {',
    '  vec2 a = u_dir * 1.3846153846, b = u_dir * 3.2307692308;',
    '  o = texture(u_tex, v_uv) * 0.2270270270',
    '    + (texture(u_tex, v_uv + a) + texture(u_tex, v_uv - a)) * 0.3162162162',
    '    + (texture(u_tex, v_uv + b) + texture(u_tex, v_uv - b)) * 0.0702702703;',
    '}'
  ].join('\n');

  var FS_COMP = HEADER + [
    'uniform sampler2D u_scene, u_q, u_e;',
    'uniform vec2 u_res;',
    'uniform vec3 u_bg;',
    'uniform vec4 u_haze[3];',      // x y (px), radius, strength
    'uniform vec3 u_hazeC[3];',
    'uniform vec4 u_shock[4];',     // x y (px), radius, amplitude (px)
    'uniform float u_shockW;',
    'uniform int u_nshock;',
    'uniform vec3 u_warp;',         // zoom-blur amount, center x y (px)
    'uniform float u_bloom, u_flash, u_vig;',
    'in vec2 v_uv;',
    'out vec4 o;',
    'vec3 at(vec2 px) { return texture(u_scene, vec2(px.x / u_res.x, 1.0 - px.y / u_res.y)).rgb; }',
    'float knee(float c) { return c < 0.8 ? c : 0.8 + 0.2 * (1.0 - exp(-(c - 0.8) * 5.0)); }',
    'void main() {',
    '  vec2 px = vec2(v_uv.x * u_res.x, (1.0 - v_uv.y) * u_res.y);',
    '  vec2 off = vec2(0.0);',
    '  float ab = 0.0;',
    '  for (int i = 0; i < 4; i++) {',
    '    if (i >= u_nshock) break;',
    '    vec4 s = u_shock[i];',
    '    vec2 d = px - s.xy;',
    '    float L = length(d) + 1e-3, k = (L - s.z) / u_shockW, g = exp(-k * k);',
    '    off -= d / L * (s.w * g * k);',
    '    ab += abs(s.w) * g;',
    '  }',
    '  vec3 col;',
    '  if (u_warp.x > 0.001) {',
    '    vec3 acc = vec3(0.0);',
    '    vec2 to = (u_warp.yz - px) * u_warp.x;',
    '    for (int k = 0; k < 8; k++) acc += at(px + off + to * (float(k) / 7.0));',
    '    col = acc / 8.0;',
    '  } else if (ab > 0.05) {',
    '    vec2 dir = off / (length(off) + 1e-3) * min(ab * 0.06, 3.0);',
    '    col = vec3(at(px + off + dir).r, at(px + off).g, at(px + off - dir).b);',
    '  } else {',
    '    col = at(px);',
    '  }',
    '  vec3 bg = u_bg;',
    '  for (int i = 0; i < 3; i++) {',
    '    vec2 d = px - u_haze[i].xy;',
    '    bg += u_hazeC[i] * (u_haze[i].w * exp(-dot(d, d) / (u_haze[i].z * u_haze[i].z)));',
    '  }',
    '  vec2 q = (px - 0.5 * u_res) / u_res.y;',
    '  float vig = 1.0 - u_vig * smoothstep(0.3, 1.1, length(q));',
    '  vec3 c = bg * vig + col * mix(1.0, vig, 0.4);',
    '  if (u_bloom > 0.0) {',
    '    vec2 uv = vec2(px.x / u_res.x, 1.0 - px.y / u_res.y);',
    '    c += (texture(u_q, uv).rgb * 1.1 + texture(u_e, uv).rgb * 1.0) * u_bloom;',
    '  }',
    '  c += u_flash;',
    '  c = vec3(knee(c.r), knee(c.g), knee(c.b));',
    // Dithering: no banding in the dark gradients
    '  c += (fract(sin(dot(px, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;',
    '  o = vec4(c, 1.0);',
    '}'
  ].join('\n');

  // ---------------------------------------------------------------------------
  // Setup
  // ---------------------------------------------------------------------------
  function compile(type, src) {
    var sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS) && !gl.isContextLost()) {
      throw new Error(gl.getShaderInfoLog(sh));
    }
    return sh;
  }

  function program(vs, fs, uniforms) {
    var p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) throw new Error(gl.getProgramInfoLog(p));
    var u = {};
    uniforms.forEach(function (n) { u[n] = gl.getUniformLocation(p, n); });
    return { p: p, u: u };
  }

  var PAL_U = ['u_res', 'u_colA', 'u_colB', 'u_colP', 'u_rainbow', 'u_rbOff'];

  // Instanced attribute: location, size, stride and offset in floats
  function attr(loc, size, stride, offset, divisor) {
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride * 4, offset * 4);
    gl.vertexAttribDivisor(loc, divisor);
  }

  function setup() {
    hdr = !!gl.getExtension('EXT_color_buffer_float');
    P.line = program(VS_LINE, FS_LINE, PAL_U);
    P.point = program(VS_POINT, FS_POINT, PAL_U.concat(['u_glow']));
    P.tri = program(VS_TRI, FS_TRI, PAL_U);
    P.down = program(VS_FULL, FS_DOWN, ['u_tex', 'u_texel']);
    P.blur = program(VS_FULL, FS_BLUR, ['u_tex', 'u_dir']);
    P.comp = program(VS_FULL, FS_COMP, ['u_scene', 'u_q', 'u_e', 'u_res', 'u_bg', 'u_haze', 'u_hazeC',
      'u_shock', 'u_shockW', 'u_nshock', 'u_warp', 'u_bloom', 'u_flash', 'u_vig']);

    // Corners of a line quad (along, across) and of a point quad
    buf.lineCorners = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf.lineCorners);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, -1, 1, -1, 0, 1, 1, 1]), gl.STATIC_DRAW);
    buf.pointCorners = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf.pointCorners);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    buf.line = gl.createBuffer();
    buf.point = gl.createBuffer();
    buf.tri = gl.createBuffer();
    cap.line = cap.point = cap.tri = 0;

    var L = scene.LINE, PT = scene.POINT;
    vao.line = gl.createVertexArray();
    gl.bindVertexArray(vao.line);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf.lineCorners);
    attr(0, 2, 2, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf.line);
    attr(1, 4, L, 0, 1);
    attr(2, 2, L, 4, 1);
    attr(3, 4, L, 6, 1);
    attr(4, 1, L, 10, 1);

    vao.point = gl.createVertexArray();
    gl.bindVertexArray(vao.point);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf.pointCorners);
    attr(0, 2, 2, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf.point);
    attr(1, 4, PT, 0, 1);
    attr(2, 4, PT, 4, 1);

    vao.tri = gl.createVertexArray();
    gl.bindVertexArray(vao.tri);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf.tri);
    attr(0, 4, 4, 0, 0);

    vao.full = gl.createVertexArray();
    gl.bindVertexArray(null);
    T = {};
    W = H = 0;
  }

  function target(w, h) {
    var tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, hdr ? gl.RGBA16F : gl.RGBA8, w, h, 0, gl.RGBA, hdr ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    var fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    var complete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { tex: tex, fb: fb, w: w, h: h, ok: complete };
  }

  function freeTargets() {
    Object.keys(T).forEach(function (k) {
      gl.deleteTexture(T[k].tex);
      gl.deleteFramebuffer(T[k].fb);
    });
    T = {};
  }

  function resize(w, h) {
    if (w === W && h === H && T.scene) return;
    freeTargets();
    W = w;
    H = h;
    var q = function (d) { return Math.max(1, Math.round(d)); };
    T.scene = target(w, h);
    if (!T.scene.ok && hdr) {
      // Half floats not renderable after all: plain 8-bit targets
      hdr = false;
      freeTargets();
      T.scene = target(w, h);
    }
    T.half = target(q(w / 2), q(h / 2));
    T.q1 = target(q(w / 4), q(h / 4));
    T.q2 = target(q(w / 4), q(h / 4));
    T.e1 = target(q(w / 8), q(h / 8));
    T.e2 = target(q(w / 8), q(h / 8));
  }

  function init(c) {
    canvas = c;
    try {
      gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: false });
      if (!gl) return false;
      setup();
      ready = true;
    } catch (e) {
      if (window.console) console.warn('Neural Plexus: WebGL2 unavailable', e);
      ready = false;
      return !!gl;   // a context exists: the 2D fallback can't use this canvas
    }
    canvas.addEventListener('webglcontextlost', function (e) {
      e.preventDefault();
      ready = false;
    });
    canvas.addEventListener('webglcontextrestored', function () {
      try {
        setup();
        ready = true;
      } catch (err) {
        ready = false;
      }
    });
    return true;
  }

  // ---------------------------------------------------------------------------
  // Frame
  // ---------------------------------------------------------------------------
  function upload(which, data, floats) {
    gl.bindBuffer(gl.ARRAY_BUFFER, buf[which]);
    if (cap[which] < data.length) {
      cap[which] = data.length;
      gl.bufferData(gl.ARRAY_BUFFER, data.length * 4, gl.DYNAMIC_DRAW);
    }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, floats);
  }

  function palette(prog, f) {
    var u = prog.u;
    gl.useProgram(prog.p);
    gl.uniform2f(u.u_res, W, H);
    gl.uniform3fv(u.u_colA, f.colA);
    gl.uniform3fv(u.u_colB, f.colB);
    gl.uniform3fv(u.u_colP, f.colP);
    gl.uniform1f(u.u_rainbow, f.rainbow ? 1 : 0);
    gl.uniform1f(u.u_rbOff, f.rbOff);
  }

  function pass(prog, src, dst) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fb);
    gl.viewport(0, 0, dst.w, dst.h);
    gl.useProgram(prog.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, src.tex);
    gl.uniform1i(prog.u.u_tex, 0);
  }

  function down(src, dst) {
    pass(P.down, src, dst);
    gl.uniform2f(P.down.u.u_texel, 1 / src.w, 1 / src.h);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function blur(src, dst, dx, dy) {
    pass(P.blur, src, dst);
    gl.uniform2f(P.blur.u.u_dir, dx / src.w, dy / src.h);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /*
   * f: {
   *   W, H, scene (scene.build output), colA, colB, colP ([r, g, b] 0–1),
   *   rainbow, rbOff, glow, bg, haze (Float32Array 12), hazeC (Float32Array 9),
   *   shocks (Float32Array 16), shockN, shockW, warp ([amount, x, y]),
   *   bloom (0 = off), flash, vignette
   * }
   */
  function frame(f) {
    if (!ready || gl.isContextLost()) return;
    if (canvas.width !== f.W || canvas.height !== f.H) {
      canvas.width = f.W;
      canvas.height = f.H;
    }
    resize(f.W, f.H);
    var sc = f.scene;

    gl.bindFramebuffer(gl.FRAMEBUFFER, T.scene.fb);
    gl.viewport(0, 0, W, H);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);

    if (sc.triN) {
      upload('tri', sc.tris, sc.triN * scene.TRI);
      palette(P.tri, f);
      gl.bindVertexArray(vao.tri);
      gl.drawArrays(gl.TRIANGLES, 0, sc.triN * 3);
    }
    if (sc.lineN) {
      upload('line', sc.lines, sc.lineN * scene.LINE);
      palette(P.line, f);
      gl.bindVertexArray(vao.line);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, sc.lineN);
    }
    if (sc.pointN) {
      upload('point', sc.points, sc.pointN * scene.POINT);
      palette(P.point, f);
      gl.uniform1f(P.point.u.u_glow, f.glow);
      gl.bindVertexArray(vao.point);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, sc.pointN);
    }
    gl.disable(gl.BLEND);

    gl.bindVertexArray(vao.full);
    if (f.bloom > 0) {
      down(T.scene, T.half);
      down(T.half, T.q1);
      blur(T.q1, T.q2, 1, 0);
      blur(T.q2, T.q1, 0, 1);
      down(T.q1, T.e1);
      blur(T.e1, T.e2, 1, 0);
      blur(T.e2, T.e1, 0, 1);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    var u = P.comp.u;
    gl.useProgram(P.comp.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, T.scene.tex);
    gl.uniform1i(u.u_scene, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, T.q1.tex);
    gl.uniform1i(u.u_q, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, T.e1.tex);
    gl.uniform1i(u.u_e, 2);
    gl.uniform2f(u.u_res, W, H);
    gl.uniform3fv(u.u_bg, f.bg);
    gl.uniform4fv(u.u_haze, f.haze);
    gl.uniform3fv(u.u_hazeC, f.hazeC);
    gl.uniform4fv(u.u_shock, f.shocks);
    gl.uniform1f(u.u_shockW, f.shockW);
    gl.uniform1i(u.u_nshock, f.shockN);
    gl.uniform3fv(u.u_warp, f.warp);
    gl.uniform1f(u.u_bloom, f.bloom);
    gl.uniform1f(u.u_flash, f.flash);
    gl.uniform1f(u.u_vig, f.vignette);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    gl.activeTexture(gl.TEXTURE0);
  }

  S.gl = {
    init: init,
    frame: frame,
    ok: function () { return ready; },
    hdr: function () { return hdr; }
  };
})(window.Plexus = window.Plexus || {});
