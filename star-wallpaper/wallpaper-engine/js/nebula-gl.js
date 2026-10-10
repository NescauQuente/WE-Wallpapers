/*
 * Starry Orbit — fluid nebula (WebGL2).
 *
 * Generates the gas every frame with 3D simplex noise whose third dimension
 * is time: clouds dissolve and re-form instead of just rotating. Same recipe
 * as the CPU version (domain warping, filaments, dust, two hues), now
 * animated. Fine details evolve faster than large masses, like real
 * turbulence.
 *
 * Rendered at reduced resolution (the gas is diffuse) and upscaled onto the
 * 2D canvas. Without WebGL2, main.js falls back to the CPU texture (nebula.js).
 */
(function (S) {
  'use strict';

  // Maximum buffer width and screen fraction, per quality level
  var QUALITY = {
    low: { cap: 640, div: 4 },
    medium: { cap: 960, div: 3 },
    high: { cap: 1600, div: 2 }
  };

  // Time layers of the gas, one per fbm call in the shader, in the order of
  // their u_z slots: [rate, offset, octaves]
  var LAYERS = [
    [0.012, 0, 3],    // warp x
    [0.012, 3.7, 3],  // warp y
    [0.009, 10, 5],   // density
    [0.012, 20, 4],   // filaments
    [0.01, 30, 4],    // dust
    [0.006, 50, 2],   // haze
    [0.007, 40, 3]    // hue mix
  ];
  var Z_COUNT = LAYERS.reduce(function (n, l) { return n + l[2]; }, 0);
  // The 3D simplex below repeats every 3 × 289 along z: the time coordinates
  // are reduced by that period in double precision here, so after days of
  // running they don't lose float32 precision on the GPU (the gas would start
  // to move in steps)
  var Z_PERIOD = 867;
  var zData = new Float32Array(Z_COUNT);

  function timeCoords(t) {
    for (var l = 0, i = 0; l < LAYERS.length; l++) {
      var z = t * LAYERS[l][0] + LAYERS[l][1];
      for (var o = 0; o < LAYERS[l][2]; o++, z *= 1.3) zData[i++] = z % Z_PERIOD;
    }
    return zData;
  }

  var VS = [
    '#version 300 es',
    'in vec2 a_pos;',
    'void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }'
  ].join('\n');

  var FS = [
    '#version 300 es',
    'precision highp float;',
    'uniform vec2 u_res;        // buffer size',
    'uniform vec2 u_region;     // screen/region size (px)',
    'uniform vec2 u_center;     // orbit center within the region (px)',
    'uniform float u_angle;     // slow galaxy rotation',
    'uniform float u_flip;',
    'uniform float u_unit;      // reference radius (px)',
    'uniform float u_z[' + Z_COUNT + '];   // time coordinate of every noise octave (see timeCoords)',
    'uniform vec2 u_seed;',
    'uniform vec3 u_colA;',
    'uniform vec3 u_colB;',
    'uniform float u_intensity;',
    'uniform float u_warp;      // turbulence (rises with the bass)',
    'uniform vec4 u_hole;       // black hole: x, y (region px), radius, twist angle (0 = off)',
    'out vec4 outColor;',
    '',
    '// 3D simplex — Ian McEwan, Ashima Arts / Stefan Gustavson (MIT license)',
    'vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }',
    'vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }',
    'vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }',
    'vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }',
    'float snoise(vec3 v) {',
    '  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);',
    '  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);',
    '  vec3 i = floor(v + dot(v, C.yyy));',
    '  vec3 x0 = v - i + dot(i, C.xxx);',
    '  vec3 g = step(x0.yzx, x0.xyz);',
    '  vec3 l = 1.0 - g;',
    '  vec3 i1 = min(g.xyz, l.zxy);',
    '  vec3 i2 = max(g.xyz, l.zxy);',
    '  vec3 x1 = x0 - i1 + C.xxx;',
    '  vec3 x2 = x0 - i2 + C.yyy;',
    '  vec3 x3 = x0 - D.yyy;',
    '  i = mod289(i);',
    '  vec4 p = permute(permute(permute(',
    '      i.z + vec4(0.0, i1.z, i2.z, 1.0))',
    '    + i.y + vec4(0.0, i1.y, i2.y, 1.0))',
    '    + i.x + vec4(0.0, i1.x, i2.x, 1.0));',
    '  float n_ = 0.142857142857;',
    '  vec3 ns = n_ * D.wyz - D.xzx;',
    '  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);',
    '  vec4 x_ = floor(j * ns.z);',
    '  vec4 y_ = floor(j - 7.0 * x_);',
    '  vec4 x = x_ * ns.x + ns.yyyy;',
    '  vec4 y = y_ * ns.x + ns.yyyy;',
    '  vec4 h = 1.0 - abs(x) - abs(y);',
    '  vec4 b0 = vec4(x.xy, y.xy);',
    '  vec4 b1 = vec4(x.zw, y.zw);',
    '  vec4 s0 = floor(b0) * 2.0 + 1.0;',
    '  vec4 s1 = floor(b1) * 2.0 + 1.0;',
    '  vec4 sh = -step(h, vec4(0.0));',
    '  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;',
    '  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;',
    '  vec3 p0 = vec3(a0.xy, h.x);',
    '  vec3 p1 = vec3(a0.zw, h.y);',
    '  vec3 p2 = vec3(a1.xy, h.z);',
    '  vec3 p3 = vec3(a1.zw, h.w);',
    '  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));',
    '  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;',
    '  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);',
    '  m = m * m;',
    '  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));',
    '}',
    '',
    '// Fractal noise: fine details evolve faster over time (their time',
    '// coordinates, from slot z0 on, grow 1.3× per octave)',
    'float fbm(vec2 p, int z0, int octaves) {',
    '  float sum = 0.0, amp = 1.0, norm = 0.0;',
    '  for (int o = 0; o < 5; o++) {',
    '    if (o >= octaves) break;',
    '    sum += amp * snoise(vec3(p, u_z[z0 + o]));',
    '    norm += amp;',
    '    amp *= 0.5;',
    '    p *= 2.03;',
    '  }',
    '  return sum / norm;',
    '}',
    '',
    'void main() {',
    '  vec2 px = vec2(gl_FragCoord.x, u_res.y - gl_FragCoord.y) / u_res * u_region;',
    '  // Black hole: the gas is twisted into a whirlpool around it',
    '  if (u_hole.w != 0.0) {',
    '    vec2 hd = px - u_hole.xy;',
    '    float ha = u_hole.w * exp(-length(hd) / u_hole.z);',
    '    float hc = cos(ha), hs = sin(ha);',
    '    px = u_hole.xy + vec2(hc * hd.x - hs * hd.y, hs * hd.x + hc * hd.y);',
    '  }',
    '  vec2 v = px - u_center;',
    '  float c = cos(u_angle), s = sin(u_angle);',
    '  v = vec2(c * v.x + s * v.y, -s * v.x + c * v.y);',
    '  v.x *= u_flip;',
    '  vec2 n = v / u_unit;',
    '  float r = length(n);',
    '  if (r >= 1.0) { outColor = vec4(0.0, 0.0, 0.0, 1.0); return; }',
    '',
    '  vec2 p = n * 1.2 + u_seed;',
    '',
    '  // Warp field that also evolves: the gas flows',
    '  vec2 q = vec2(fbm(p, 0, 3), fbm(p + vec2(5.2, 1.3), 3, 3));',
    '  vec2 w = q * 1.1 * u_warp;',
    '',
    '  // 3D simplex has a smaller amplitude than 2D: compensate to keep the density',
    '  float d = smoothstep(-0.3, 0.62, 1.3 * fbm(p + w, 6, 5));',
    '  d = pow(d, 1.6);',
    '',
    '  // Subtle filaments, only inside the clouds',
    '  float ridge = 1.0 - abs(fbm(p * 1.3 + q, 11, 4));',
    '  float fil = ridge * ridge * ridge;',
    '  fil *= fil;',
    '',
    '  // Dark dust lanes',
    '  float dust = smoothstep(0.05, 0.5, fbm(p * 1.7 + vec2(17.1, 9.4), 15, 4));',
    '  d = d * (1.0 - 0.55 * dust) + fil * d * 0.6;',
    '',
    '  // Broad, slow haze behind the clouds (volume and depth)',
    '  float haze = smoothstep(-0.2, 0.7, 1.3 * fbm(p * 0.55 + w * 0.4 + vec2(3.1, 7.7), 19, 2));',
    '  // Large clouds reusing the warp field (zero cost)',
    '  float big = smoothstep(0.0, 0.55, 1.3 * q.y);',
    '  d += (haze * 0.34 + big * 0.3) * (1.0 - d);',
    '',
    '  // Concentrate toward the center and fade at the edges',
    '  d *= (1.0 - smoothstep(0.62, 1.0, r)) * (0.6 + 0.4 * (1.0 - r));',
    '  d = clamp(d, 0.0, 1.0);',
    '',
    '  float m = smoothstep(-0.35, 0.35, fbm(p * 0.7 + vec2(11.3, 4.7), 21, 3));',
    '  vec3 col = mix(u_colA, u_colB, m) * (0.5 + 0.5 * d) + vec3(d * d * d * 0.235);',
    '  float a = clamp(d * 1.255, 0.0, 1.0);',
    '  outColor = vec4(col * a * u_intensity, 1.0);',
    '}'
  ].join('\n');

  var canvas = null, gl = null, ok = false, loc = {};
  var UNIFORMS = ['u_res', 'u_region', 'u_center', 'u_angle', 'u_flip', 'u_unit', 'u_z',
    'u_seed', 'u_colA', 'u_colB', 'u_intensity', 'u_warp', 'u_hole'];

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
    var prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS));
    gl.bindAttribLocation(prog, 0, 'a_pos');
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('link: ' + gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    UNIFORMS.forEach(function (n) { loc[n] = gl.getUniformLocation(prog, n); });

    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  }

  function init() {
    canvas = document.createElement('canvas');
    try {
      gl = canvas.getContext('webgl2', {
        alpha: false, antialias: false, depth: false, stencil: false,
        premultipliedAlpha: false, preserveDrawingBuffer: false
      });
      if (!gl) return false;
      setup();
    } catch (e) {
      if (window.console) console.warn('Starry Orbit: fluid nebula disabled (' + e.message + ')');
      gl = null;
      return false;
    }
    canvas.addEventListener('webglcontextlost', function (e) { e.preventDefault(); ok = false; });
    canvas.addEventListener('webglcontextrestored', function () {
      try { setup(); ok = true; } catch (e) { ok = false; }
    });
    ok = true;
    return true;
  }

  // Draws the nebula for one region and returns the canvas (or null without WebGL)
  function render(o) {
    if (!ok) return null;
    var q = QUALITY[o.quality] || QUALITY.medium;
    var bw = Math.max(64, Math.min(q.cap, Math.round(o.regionW / q.div)));
    var bh = Math.max(36, Math.round(bw * o.regionH / o.regionW));
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
    }
    gl.viewport(0, 0, bw, bh);
    gl.uniform2f(loc.u_res, bw, bh);
    gl.uniform2f(loc.u_region, o.regionW, o.regionH);
    gl.uniform2f(loc.u_center, o.cx, o.cy);
    gl.uniform1f(loc.u_angle, o.angle);
    gl.uniform1f(loc.u_flip, o.flip);
    gl.uniform1f(loc.u_unit, o.unit);
    gl.uniform1fv(loc.u_z, timeCoords(o.time));
    gl.uniform2f(loc.u_seed, o.seed[0], o.seed[1]);
    gl.uniform3f(loc.u_colA, o.colA[0], o.colA[1], o.colA[2]);
    gl.uniform3f(loc.u_colB, o.colB[0], o.colB[1], o.colB[2]);
    gl.uniform1f(loc.u_intensity, o.intensity);
    gl.uniform1f(loc.u_warp, o.warp);
    var hole = o.hole || [0, 0, 1, 0];
    gl.uniform4f(loc.u_hole, hole[0], hole[1], hole[2], hole[3]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return canvas;
  }

  S.nebulaGL = { init: init, render: render, ok: function () { return ok; } };
})(window.Starry = window.Starry || {});
