/**
 * orb.js — Three.js orbe animado + UI con tabs, logs, chat history y model toggle
 */

;(function () {
  'use strict'

  // ── Three.js setup ──────────────────────────────────────────────────────────
  const canvas    = document.getElementById('orb-canvas')
  const container = document.getElementById('canvas-container')
  const renderer  = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false })
  renderer.setPixelRatio(window.devicePixelRatio)

  const scene  = new THREE.Scene()
  scene.background = new THREE.Color(0x000000)

  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100)
  camera.position.z = 3

  function resize() {
    const w = container.clientWidth
    const h = container.clientHeight
    renderer.setSize(w, h)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
  }
  resize()
  window.addEventListener('resize', resize)

  // ── GLSL compartido ──────────────────────────────────────────────────────────
  const SNOISE = `
    vec3 mod289(vec3 x) { return x - floor(x * (1.0/289.0)) * 289.0; }
    vec4 mod289(vec4 x) { return x - floor(x * (1.0/289.0)) * 289.0; }
    vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
    vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
    float snoise(vec3 v) {
      const vec2 C = vec2(1.0/6.0, 1.0/3.0);
      const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
      vec3 i  = floor(v + dot(v, C.yyy));
      vec3 x0 = v - i + dot(i, C.xxx);
      vec3 g  = step(x0.yzx, x0.xyz);
      vec3 l  = 1.0 - g;
      vec3 i1 = min(g.xyz, l.zxy);
      vec3 i2 = max(g.xyz, l.zxy);
      vec3 x1 = x0 - i1 + C.xxx;
      vec3 x2 = x0 - i2 + C.yyy;
      vec3 x3 = x0 - D.yyy;
      i = mod289(i);
      vec4 p = permute(permute(permute(
        i.z + vec4(0.0,i1.z,i2.z,1.0))
        + i.y + vec4(0.0,i1.y,i2.y,1.0))
        + i.x + vec4(0.0,i1.x,i2.x,1.0));
      float n_ = 0.142857142857;
      vec3 ns = n_ * D.wyz - D.xzx;
      vec4 j  = p - 49.0 * floor(p * ns.z * ns.z);
      vec4 x_ = floor(j * ns.z);
      vec4 y_ = floor(j - 7.0 * x_);
      vec4 x  = x_ * ns.x + ns.yyyy;
      vec4 y  = y_ * ns.x + ns.yyyy;
      vec4 h  = 1.0 - abs(x) - abs(y);
      vec4 b0 = vec4(x.xy, y.xy);
      vec4 b1 = vec4(x.zw, y.zw);
      vec4 s0 = floor(b0)*2.0 + 1.0;
      vec4 s1 = floor(b1)*2.0 + 1.0;
      vec4 sh = -step(h, vec4(0.0));
      vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
      vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
      vec3 p0 = vec3(a0.xy, h.x);
      vec3 p1 = vec3(a0.zw, h.y);
      vec3 p2 = vec3(a1.xy, h.z);
      vec3 p3 = vec3(a1.zw, h.w);
      vec4 norm = taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
      p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
      vec4 m = max(0.6 - vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)), 0.0);
      m = m * m;
      return 42.0 * dot(m*m, vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
    }
  `

  const UNIFORMS_GLSL = `
    uniform float uTime;
    uniform float uRadius;
    uniform float uRotSpeed;
    uniform float uNoiseFreq;
    uniform float uNoiseAmp;
    uniform float uFlowSpeed;
    uniform float uBreath;
    uniform float uAudioLevel;
    uniform float uAlphaRing;
    uniform float uAlphaShell;
    uniform float uAlphaWisp;
    uniform float uPointSize;
    uniform vec3  uMouseHover;
    uniform float uHoverStrength;
    uniform vec3  uClickOrigin;
    uniform float uClickTime;
    uniform float uClickRadius;
    uniform float uClickStrength;
    varying float vAlpha;
  `

  // ── Ring vertex shader (Layer 0: disco orbital) ───────────────────────────────
  const ringVertexShader = SNOISE + UNIFORMS_GLSL + `
    attribute vec3  aSeed;
    attribute float aBaseAngle;
    attribute float aOrbitRadius;
    attribute float aOrbitSpeed;
    attribute float aNoisePhase;

    void main() {
      float t     = uTime;
      float angle = aBaseAngle + t * uRotSpeed * aOrbitSpeed;
      float r     = uRadius * aOrbitRadius;

      vec3 pos;
      pos.x = cos(angle) * r;
      pos.y = sin(angle) * r;
      pos.z = snoise(aSeed * uNoiseFreq + vec3(0.0, t * uFlowSpeed + aNoisePhase, 0.0)) * 0.08 * uRadius;

      float radN = snoise(aSeed * uNoiseFreq * 0.7 + vec3(t * uFlowSpeed * 0.5 + aNoisePhase, 0.0, 0.0));
      pos.x += cos(angle) * radN * uNoiseAmp * 0.5;
      pos.y += sin(angle) * radN * uNoiseAmp * 0.5;

      pos *= 1.0 + sin(t * 0.8 + aNoisePhase * 0.3) * 0.03 * uBreath;

      pos.x += cos(angle) * uAudioLevel * 0.38;
      pos.y += sin(angle) * uAudioLevel * 0.38;

      vec3 lean = normalize(vec3(uMouseHover.x, uMouseHover.y, 0.0) + 0.001);
      pos += lean * uHoverStrength * 0.06;

      float cAge = t - uClickTime;
      if (cAge >= 0.0 && cAge < 1.5) {
        float d = distance(pos, uClickOrigin);
        if (d < uClickRadius) {
          vec3 sDir = normalize(pos - uClickOrigin + vec3(aSeed.x - 0.5, 0.0, aSeed.z - 0.5) * 0.1);
          float disp = sin(cAge * 5.0) * exp(-cAge * 3.5) * (1.0 - d / uClickRadius) * uClickStrength;
          pos += sDir * disp;
        }
      }

      vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
      gl_Position  = projectionMatrix * mvPos;
      gl_PointSize = uPointSize * (3.0 / -mvPos.z);

      vAlpha = uAlphaRing;
    }
  `

  // ── Shell vertex shader (Layer 1: superficie Fibonacci) ──────────────────────
  const shellVertexShader = SNOISE + UNIFORMS_GLSL + `
    attribute vec3  aSeed;
    attribute float aLatitude;
    attribute float aLongitude;
    attribute float aOrbitRadius;
    attribute float aOrbitSpeed;
    attribute float aNoisePhase;

    void main() {
      float t   = uTime;
      float phi = aLongitude + t * uRotSpeed * aOrbitSpeed * 0.25;

      vec3 nrm = vec3(sin(aLatitude) * cos(phi), cos(aLatitude), sin(aLatitude) * sin(phi));
      vec3 pos = nrm * uRadius * aOrbitRadius;

      float n1 = snoise(nrm * uNoiseFreq + aSeed + vec3(t * uFlowSpeed + aNoisePhase));
      pos += nrm * n1 * uNoiseAmp * 1.5;

      vec3 tangent = normalize(cross(nrm, vec3(0.0, 1.0, 0.01)));
      float n2 = snoise(nrm * uNoiseFreq * 1.3 + aSeed.zxy + vec3(t * uFlowSpeed * 0.7 + aNoisePhase));
      pos += tangent * n2 * uNoiseAmp * 0.4;

      pos *= 1.0 + sin(t * 0.8 + aNoisePhase * 0.4) * 0.025 * uBreath;
      pos *= 1.0 + uAudioLevel * 0.50;

      float twist = (1.0 - uBreath) * sin(t * 1.5 + aNoisePhase) * 0.15;
      float cosT  = cos(twist);
      float sinT  = sin(twist);
      float px    = pos.x;
      float pz    = pos.z;
      pos.x = cosT * px - sinT * pz;
      pos.z = sinT * px + cosT * pz;

      vec3 lean = normalize(vec3(uMouseHover.x, uMouseHover.y, 0.0) + 0.001);
      pos += lean * uHoverStrength * 0.07;

      float cAge = t - uClickTime;
      if (cAge >= 0.0 && cAge < 1.5) {
        float d = distance(pos, uClickOrigin);
        if (d < uClickRadius) {
          vec3 sDir = normalize(pos - uClickOrigin + (aSeed - 0.5) * 0.15);
          float disp = sin(cAge * 5.0) * exp(-cAge * 3.5) * (1.0 - d / uClickRadius) * uClickStrength;
          pos += sDir * disp;
        }
      }

      vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
      gl_Position  = projectionMatrix * mvPos;
      gl_PointSize = uPointSize * 0.85 * (3.0 / -mvPos.z);
      vAlpha = uAlphaShell;
    }
  `

  // ── Wisp vertex shader (Layer 2: halo exterior) ──────────────────────────────
  const wispVertexShader = SNOISE + UNIFORMS_GLSL + `
    attribute vec3  aSeed;
    attribute float aLatitude;
    attribute float aLongitude;
    attribute float aOrbitRadius;
    attribute float aNoisePhase;

    void main() {
      float t = uTime;
      vec3 baseNrm = vec3(
        sin(aLatitude) * cos(aLongitude),
        cos(aLatitude),
        sin(aLatitude) * sin(aLongitude)
      );
      vec3 pos = baseNrm * uRadius * aOrbitRadius;

      float nx = snoise(aSeed         + vec3(t * uFlowSpeed * 0.20 + aNoisePhase));
      float ny = snoise(aSeed.yzx     + vec3(t * uFlowSpeed * 0.15 + aNoisePhase + 3.7));
      float nz = snoise(aSeed.zxy     + vec3(t * uFlowSpeed * 0.18 + aNoisePhase + 7.3));
      pos += vec3(nx, ny, nz) * uNoiseAmp * 2.5;

      pos *= 1.0 + uAudioLevel * 0.65;

      vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
      gl_Position  = projectionMatrix * mvPos;
      gl_PointSize = uPointSize * 1.6 * (3.0 / -mvPos.z);
      vAlpha = uAlphaWisp;
    }
  `

  // ── Fragment shader compartido ────────────────────────────────────────────────
  const fragmentShader = `
    varying float vAlpha;

    void main() {
      vec2  uv   = gl_PointCoord - 0.5;
      float r    = length(uv);
      if (r > 0.5) discard;

      float core = exp(-r * r * 18.0);
      float halo = exp(-r * r * 5.0) * 0.35;

      vec3 coreColor = vec3(0.95, 0.97, 1.0);
      vec3 haloColor = vec3(0.55, 0.70, 1.0);
      vec3 col = mix(haloColor, coreColor, core);

      gl_FragColor = vec4(col, (core + halo) * vAlpha);
    }
  `

  // ── Glow fragment shader (bloom falso: falloff muy suave, color frío) ─────────
  const glowFragmentShader = `
    varying float vAlpha;
    void main() {
      vec2  uv = gl_PointCoord - 0.5;
      float r  = length(uv);
      if (r > 0.5) discard;
      float g = exp(-r * r * 1.6);
      gl_FragColor = vec4(0.38, 0.58, 1.0, g * vAlpha);
    }
  `

  // Glow vertex shaders: misma posición que ring/shell pero punto 7-8× más grande y alpha ×0.09
  // ringGlowVS: halo mínimo, solo partículas elegidas (aGlowLevel > 0)
  const ringGlowVS = ringVertexShader
    .replace(
      'attribute float aNoisePhase;',
      'attribute float aNoisePhase;\n    attribute float aGlowLevel;'
    )
    .replace(
      'gl_PointSize = uPointSize * (3.0 / -mvPos.z);',
      'gl_PointSize = uPointSize * 1.6 * (3.0 / -mvPos.z);'
    )
    .replace(
      'vAlpha = uAlphaRing;',
      'vAlpha = uAlphaRing * aGlowLevel * 0.0018;'
    )

  const shellGlowVS = shellVertexShader
    .replace(
      'gl_PointSize = uPointSize * 0.85 * (3.0 / -mvPos.z);',
      'gl_PointSize = uPointSize * 0.85 * 1.5 * (3.0 / -mvPos.z);'
    )
    .replace(
      'vAlpha = uAlphaShell;',
      'vAlpha = uAlphaShell * 0.0015;'
    )

  // ── Hilo vertex shader (LineSegments: raíz→punta con drift tangencial) ────────
  const hiloVertexShader = SNOISE + UNIFORMS_GLSL + `
    attribute vec3  aSeed;
    attribute float aLatitude;
    attribute float aLongitude;
    attribute float aOrbitRadius;
    attribute float aOrbitSpeed;
    attribute float aNoisePhase;
    attribute float aSegEnd;

    void main() {
      float t   = uTime;
      float phi = aLongitude + t * uRotSpeed * aOrbitSpeed * 0.18;

      vec3 nrm = vec3(sin(aLatitude)*cos(phi), cos(aLatitude), sin(aLatitude)*sin(phi));
      vec3 pos = nrm * uRadius * aOrbitRadius;

      float n1 = snoise(nrm * uNoiseFreq + aSeed + vec3(t * uFlowSpeed + aNoisePhase));
      pos += nrm * n1 * uNoiseAmp * 1.5;

      pos *= 1.0 + sin(t * 0.8 + aNoisePhase * 0.4) * 0.025 * uBreath;
      pos *= 1.0 + uAudioLevel * 0.50;

      if (aSegEnd > 0.5) {
        vec3 tangent   = normalize(cross(nrm, vec3(0.0, 1.0, 0.01)));
        vec3 bitangent = normalize(cross(nrm, tangent));
        float nt  = snoise(aSeed * 2.1 + vec3(t * uFlowSpeed * 0.6 + aNoisePhase + 5.3));
        float nb  = snoise(aSeed.zyx * 2.1 + vec3(t * uFlowSpeed * 0.5 + aNoisePhase + 11.7));
        float len = 0.045 + snoise(aSeed.yxz + vec3(aNoisePhase)) * 0.018;
        pos += (tangent * nt + bitangent * nb) * len;
      }

      vAlpha = aSegEnd > 0.5 ? 0.0 : uAlphaShell * 0.85;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
    }
  `

  const hiloFragmentShader = `
    varying float vAlpha;
    void main() {
      gl_FragColor = vec4(0.72, 0.82, 1.0, vAlpha);
    }
  `

  // ── Uniforms ──────────────────────────────────────────────────────────────────
  const uniforms = {
    uTime:          { value: 0 },
    uRadius:        { value: 0.85 },
    uRotSpeed:      { value: 0.35 },
    uNoiseFreq:     { value: 1.1 },
    uNoiseAmp:      { value: 0.055 },
    uFlowSpeed:     { value: 0.28 },
    uBreath:        { value: 1.0 },
    uAudioLevel:    { value: 0.0 },
    uAlphaRing:     { value: 0.85 },
    uAlphaShell:    { value: 0.70 },
    uAlphaWisp:     { value: 0.35 },
    uPointSize:     { value: 2.5 },
    uMouseHover:    { value: new THREE.Vector3() },
    uHoverStrength: { value: 0.0 },
    uClickOrigin:   { value: new THREE.Vector3() },
    uClickTime:     { value: -999.0 },
    uClickRadius:   { value: 0.45 },
    uClickStrength: { value: 1.05 },
  }

  // ── Builders de geometría ─────────────────────────────────────────────────────
  function buildRingGeo(count) {
    const geo        = new THREE.BufferGeometry()
    const seed       = new Float32Array(count * 3)
    const baseAngle  = new Float32Array(count)
    const orbitR     = new Float32Array(count)
    const orbitSpeed = new Float32Array(count)
    const nPhase     = new Float32Array(count)
    const glowLevel  = new Float32Array(count)

    for (let i = 0; i < count; i++) {
      seed[i*3]     = Math.random()
      seed[i*3 + 1] = Math.random()
      seed[i*3 + 2] = Math.random()
      baseAngle[i]  = Math.random() * Math.PI * 2
      orbitR[i]     = 0.75 + Math.pow(Math.random(), 0.6) * 0.45
      orbitSpeed[i] = 0.6  + Math.random() * 0.8
      nPhase[i]     = Math.random() * 20.0
      // 90% sin glow, del 10% restante: 50%→0.3, 30%→0.6, 20%→1.0
      const rg = Math.random()
      if (rg < 0.90) {
        glowLevel[i] = 0.0
      } else {
        const r2 = Math.random()
        glowLevel[i] = r2 < 0.50 ? 0.3 : r2 < 0.80 ? 0.6 : 1.0
      }
    }

    geo.setAttribute('position',     new THREE.BufferAttribute(new Float32Array(count * 3), 3))
    geo.setAttribute('aSeed',        new THREE.BufferAttribute(seed, 3))
    geo.setAttribute('aBaseAngle',   new THREE.BufferAttribute(baseAngle, 1))
    geo.setAttribute('aOrbitRadius', new THREE.BufferAttribute(orbitR, 1))
    geo.setAttribute('aOrbitSpeed',  new THREE.BufferAttribute(orbitSpeed, 1))
    geo.setAttribute('aNoisePhase',  new THREE.BufferAttribute(nPhase, 1))
    geo.setAttribute('aGlowLevel',   new THREE.BufferAttribute(glowLevel, 1))
    return geo
  }

  function buildShellGeo(count) {
    const geo        = new THREE.BufferGeometry()
    const seed       = new Float32Array(count * 3)
    const lat        = new Float32Array(count)
    const lon        = new Float32Array(count)
    const orbitR     = new Float32Array(count)
    const orbitSpeed = new Float32Array(count)
    const nPhase     = new Float32Array(count)
    const PHI        = (1 + Math.sqrt(5)) / 2

    for (let i = 0; i < count; i++) {
      seed[i*3]     = Math.random()
      seed[i*3 + 1] = Math.random()
      seed[i*3 + 2] = Math.random()
      lat[i]        = Math.acos(1 - (2 * i + 1) / count)
      lon[i]        = (2 * Math.PI * i / PHI) % (Math.PI * 2)
      orbitR[i]     = 0.92 + Math.random() * 0.16
      orbitSpeed[i] = 0.5  + Math.random() * 0.9
      nPhase[i]     = Math.random() * 20.0
    }

    geo.setAttribute('position',     new THREE.BufferAttribute(new Float32Array(count * 3), 3))
    geo.setAttribute('aSeed',        new THREE.BufferAttribute(seed, 3))
    geo.setAttribute('aLatitude',    new THREE.BufferAttribute(lat, 1))
    geo.setAttribute('aLongitude',   new THREE.BufferAttribute(lon, 1))
    geo.setAttribute('aOrbitRadius', new THREE.BufferAttribute(orbitR, 1))
    geo.setAttribute('aOrbitSpeed',  new THREE.BufferAttribute(orbitSpeed, 1))
    geo.setAttribute('aNoisePhase',  new THREE.BufferAttribute(nPhase, 1))
    return geo
  }

  function buildWispGeo(count) {
    const geo    = new THREE.BufferGeometry()
    const seed   = new Float32Array(count * 3)
    const lat    = new Float32Array(count)
    const lon    = new Float32Array(count)
    const orbitR = new Float32Array(count)
    const nPhase = new Float32Array(count)

    for (let i = 0; i < count; i++) {
      seed[i*3]     = Math.random()
      seed[i*3 + 1] = Math.random()
      seed[i*3 + 2] = Math.random()
      lat[i]    = Math.acos(2 * Math.random() - 1)
      lon[i]    = Math.random() * Math.PI * 2
      orbitR[i] = 1.25 + Math.random() * 0.9
      nPhase[i] = Math.random() * 20.0
    }

    geo.setAttribute('position',     new THREE.BufferAttribute(new Float32Array(count * 3), 3))
    geo.setAttribute('aSeed',        new THREE.BufferAttribute(seed, 3))
    geo.setAttribute('aLatitude',    new THREE.BufferAttribute(lat, 1))
    geo.setAttribute('aLongitude',   new THREE.BufferAttribute(lon, 1))
    geo.setAttribute('aOrbitRadius', new THREE.BufferAttribute(orbitR, 1))
    geo.setAttribute('aNoisePhase',  new THREE.BufferAttribute(nPhase, 1))
    return geo
  }

  function makeMat(vs) {
    return new THREE.ShaderMaterial({
      uniforms,
      vertexShader:   vs,
      fragmentShader,
      transparent:    true,
      depthWrite:     false,
      blending:       THREE.AdditiveBlending,
    })
  }

  const ringPoints  = new THREE.Points(buildRingGeo(1200),  makeMat(ringVertexShader))
  const shellPoints = new THREE.Points(buildShellGeo(1800), makeMat(shellVertexShader))
  const wispPoints  = new THREE.Points(buildWispGeo(400),   makeMat(wispVertexShader))
  ringPoints.renderOrder   = 0
  shellPoints.renderOrder  = 1
  wispPoints.renderOrder   = 2
  ringPoints.frustumCulled  = false
  shellPoints.frustumCulled = false
  wispPoints.frustumCulled  = false
  scene.add(ringPoints)
  scene.add(shellPoints)
  scene.add(wispPoints)

  // ── Glow layers (bloom falso: ring + shell) ───────────────────────────────────
  function makeGlowMat(vs) {
    return new THREE.ShaderMaterial({
      uniforms,
      vertexShader:   vs,
      fragmentShader: glowFragmentShader,
      transparent:    true,
      depthWrite:     false,
      blending:       THREE.AdditiveBlending,
    })
  }

  const ringGlowPoints  = new THREE.Points(ringPoints.geometry,  makeGlowMat(ringGlowVS))
  const shellGlowPoints = new THREE.Points(shellPoints.geometry, makeGlowMat(shellGlowVS))
  ringGlowPoints.frustumCulled  = false
  shellGlowPoints.frustumCulled = false
  ringGlowPoints.renderOrder  = 3
  shellGlowPoints.renderOrder = 4
  scene.add(ringGlowPoints)
  // shellGlowPoints removido: domina visualmente sobre el ring glow

  // ── Hilos (LineSegments distribuidos sobre la shell) ──────────────────────────
  function buildHiloGeo(count) {
    const PHI    = (1 + Math.sqrt(5)) / 2
    const vCount = count * 2
    const geo      = new THREE.BufferGeometry()
    const seed     = new Float32Array(vCount * 3)
    const lat      = new Float32Array(vCount)
    const lon      = new Float32Array(vCount)
    const orbitR   = new Float32Array(vCount)
    const orbSpeed = new Float32Array(vCount)
    const nPhase   = new Float32Array(vCount)
    const segEnd   = new Float32Array(vCount)

    for (let i = 0; i < count; i++) {
      const s0 = Math.random(), s1 = Math.random(), s2 = Math.random()
      const la = Math.acos(1 - (2 * i + 1) / count)
      const lo = (2 * Math.PI * i / PHI * 2.3) % (Math.PI * 2)
      const r  = 0.88 + Math.random() * 0.22
      const sp = 0.4  + Math.random() * 0.8
      const ph = Math.random() * 20.0

      for (let v = 0; v < 2; v++) {
        const vi     = i * 2 + v
        seed[vi*3]   = s0; seed[vi*3+1] = s1; seed[vi*3+2] = s2
        lat[vi]      = la; lon[vi]      = lo
        orbitR[vi]   = r;  orbSpeed[vi] = sp; nPhase[vi] = ph
        segEnd[vi]   = v === 0 ? 0.0 : 1.0
      }
    }

    geo.setAttribute('position',     new THREE.BufferAttribute(new Float32Array(vCount * 3), 3))
    geo.setAttribute('aSeed',        new THREE.BufferAttribute(seed, 3))
    geo.setAttribute('aLatitude',    new THREE.BufferAttribute(lat, 1))
    geo.setAttribute('aLongitude',   new THREE.BufferAttribute(lon, 1))
    geo.setAttribute('aOrbitRadius', new THREE.BufferAttribute(orbitR, 1))
    geo.setAttribute('aOrbitSpeed',  new THREE.BufferAttribute(orbSpeed, 1))
    geo.setAttribute('aNoisePhase',  new THREE.BufferAttribute(nPhase, 1))
    geo.setAttribute('aSegEnd',      new THREE.BufferAttribute(segEnd, 1))
    return geo
  }

  const hiloLines = new THREE.LineSegments(
    buildHiloGeo(380),
    new THREE.ShaderMaterial({
      uniforms,
      vertexShader:   hiloVertexShader,
      fragmentShader: hiloFragmentShader,
      transparent:    true,
      depthWrite:     false,
      blending:       THREE.AdditiveBlending,
    })
  )
  hiloLines.frustumCulled = false
  hiloLines.renderOrder   = 5
  scene.add(hiloLines)

  // ── Estados del orbe ──────────────────────────────────────────────────────────
  const STATES = {
    idle:     { radius:0.85, rotSpeed:0.35, noiseFreq:1.1,  noiseAmp:0.055, flowSpeed:0.28, breath:1.0,
                alphaRing:0.85, alphaShell:0.70, alphaWisp:0.35, pointSize:2.5 },
    thinking: { radius:0.64, rotSpeed:1.1,  noiseFreq:2.2,  noiseAmp:0.10,  flowSpeed:0.65, breath:0.0,
                alphaRing:0.60, alphaShell:0.85, alphaWisp:0.15, pointSize:2.0 },
    speaking: { radius:0.85, rotSpeed:0.55, noiseFreq:1.5,  noiseAmp:0.08,  flowSpeed:0.40, breath:0.5,
                alphaRing:0.90, alphaShell:0.80, alphaWisp:0.45, pointSize:2.8 },
    listening:{ radius:0.81, rotSpeed:0.45, noiseFreq:1.3,  noiseAmp:0.065, flowSpeed:0.35, breath:0.7,
                alphaRing:0.80, alphaShell:0.75, alphaWisp:0.30, pointSize:2.5 },
  }

  let currentStateName = 'idle'
  const target = { ...STATES.idle }

  function setState(stateName, level = 0) {
    if (!STATES[stateName]) return
    currentStateName = stateName
    Object.assign(target, STATES[stateName])
    uniforms.uAudioLevel.value = 0.0
  }

  function lerp(a, b, t) { return a + (b - a) * t }

  // ── Audio playback (Web Audio API) ───────────────────────────────────────────
  const audioCtx   = new AudioContext()
  const pbAnalyser = audioCtx.createAnalyser()
  pbAnalyser.fftSize = 256
  pbAnalyser.smoothingTimeConstant = 0.92
  pbAnalyser.connect(audioCtx.destination)
  const pbDataArray = new Uint8Array(pbAnalyser.frequencyBinCount)
  let pbActive = false

  window._orbGetPlaybackAmplitude = () => {
    if (!pbActive) return 0
    pbAnalyser.getByteTimeDomainData(pbDataArray)
    let sum = 0
    for (let i = 0; i < pbDataArray.length; i++) {
      const n = (pbDataArray[i] - 128) / 128
      sum += n * n
    }
    const rms = Math.sqrt(sum / pbDataArray.length)
    return Math.min(1, rms * 5) * 0.5
  }

  function playAudio({ data }) {
    const binary = atob(data)
    const bytes  = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)

    const resume = audioCtx.state === 'suspended' ? audioCtx.resume() : Promise.resolve()
    resume.then(() => audioCtx.decodeAudioData(bytes.buffer)).then((buffer) => {
      const src = audioCtx.createBufferSource()
      src.buffer = buffer
      src.connect(pbAnalyser)
      pbActive = true
      src.onended = () => {
        pbActive = false
        if (window.lucy) window.lucy.audioEnded()
        setState('idle', 0)
      }
      src.start()
    }).catch((e) => {
      console.error('[audio]', e)
      pbActive = false
      setState('idle', 0)
    })
  }

  // ── Loop de animación ─────────────────────────────────────────────────────────
  const clock    = new THREE.Clock()
  const SMOOTH   = 0.055
  let mouseNDC    = new THREE.Vector2()
  let isHovering  = false
  let leanPos     = new THREE.Vector2()
  let leanVel     = new THREE.Vector2()
  let lastElapsed = 0

  function animate() {
    requestAnimationFrame(animate)
    const elapsed = clock.getElapsedTime()

    uniforms.uRadius.value     = lerp(uniforms.uRadius.value,     target.radius,    SMOOTH)
    uniforms.uRotSpeed.value   = lerp(uniforms.uRotSpeed.value,   target.rotSpeed,  SMOOTH)
    uniforms.uNoiseFreq.value  = lerp(uniforms.uNoiseFreq.value,  target.noiseFreq, SMOOTH)
    uniforms.uNoiseAmp.value   = lerp(uniforms.uNoiseAmp.value,   target.noiseAmp,  SMOOTH)
    uniforms.uFlowSpeed.value  = lerp(uniforms.uFlowSpeed.value,  target.flowSpeed, SMOOTH)
    uniforms.uBreath.value     = lerp(uniforms.uBreath.value,     target.breath,    SMOOTH)
    uniforms.uAlphaRing.value  = lerp(uniforms.uAlphaRing.value,  target.alphaRing,  SMOOTH)
    uniforms.uAlphaShell.value = lerp(uniforms.uAlphaShell.value, target.alphaShell, SMOOTH)
    uniforms.uAlphaWisp.value  = lerp(uniforms.uAlphaWisp.value,  target.alphaWisp,  SMOOTH)
    uniforms.uPointSize.value  = lerp(uniforms.uPointSize.value,  target.pointSize,  SMOOTH)

    const dt = Math.min(elapsed - lastElapsed, 0.05)
    lastElapsed = elapsed

    const hoverActive = isHovering && currentStateName === 'idle'
    const targetX = hoverActive ? mouseNDC.x : 0
    const targetY = hoverActive ? mouseNDC.y : 0
    const stiffness = 8.0
    const damping   = 7.0
    leanVel.x += (stiffness * (targetX - leanPos.x) - damping * leanVel.x) * dt
    leanVel.y += (stiffness * (targetY - leanPos.y) - damping * leanVel.y) * dt
    leanVel.clampLength(0, 2.5)
    leanPos.x += leanVel.x * dt
    leanPos.y += leanVel.y * dt
    uniforms.uMouseHover.value.set(leanPos.x, leanPos.y, 0)
    uniforms.uHoverStrength.value = lerp(uniforms.uHoverStrength.value, hoverActive ? 1.0 : 0.0, 0.04)

    if (currentStateName === 'speaking') {
      const amp        = (window._orbGetPlaybackAmplitude ? window._orbGetPlaybackAmplitude() : 0) * 0.5
      const lerpFactor = amp > uniforms.uAudioLevel.value ? 0.09 : 0.04
      uniforms.uAudioLevel.value = lerp(uniforms.uAudioLevel.value, amp, lerpFactor)
    } else {
      uniforms.uAudioLevel.value = lerp(uniforms.uAudioLevel.value, 0.0, 0.04)
    }

    uniforms.uTime.value = elapsed
    renderer.render(scene, camera)
  }
  animate()

  // ── Interacción mouse ─────────────────────────────────────────────────────────
  canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect()
    mouseNDC.x =  ((e.clientX - rect.left) / rect.width)  * 2 - 1
    mouseNDC.y = -((e.clientY - rect.top)  / rect.height) * 2 + 1
    isHovering = true
  })
  canvas.addEventListener('mouseleave', () => { isHovering = false })

  canvas.addEventListener('click', (e) => {
    const rect = canvas.getBoundingClientRect()
    const ndcX =  ((e.clientX - rect.left) / rect.width)  * 2 - 1
    const ndcY = -((e.clientY - rect.top)  / rect.height) * 2 + 1
    const ray  = new THREE.Raycaster()
    ray.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera)
    const R  = uniforms.uRadius.value
    const ro = ray.ray.origin
    const rd = ray.ray.direction
    const b  = rd.dot(ro)
    const c  = ro.dot(ro) - R * R
    const disc = b * b - c
    if (disc >= 0) {
      const hit = ro.clone().addScaledVector(rd, -b - Math.sqrt(disc))
      uniforms.uClickOrigin.value.copy(hit)
      uniforms.uClickTime.value = clock.getElapsedTime()
    }
  })

  // ── Referencias UI ────────────────────────────────────────────────────────────
  const inputEl     = document.getElementById('chat-input')
  const sendBtn     = document.getElementById('send-btn')
  const chatForm    = document.getElementById('chat-form')
  const inputTabEl  = document.getElementById('chat-input-tab')
  const sendBtnTab  = document.getElementById('send-btn-tab')
  const chatFormTab = document.getElementById('chat-form-tab')
  const lastMsgEl   = document.getElementById('last-msg')
  const statusDot   = document.getElementById('status-dot')
  const btnClose    = document.getElementById('btn-close')
  const btnMinimize = document.getElementById('btn-minimize')
  const btnGateway  = document.getElementById('btn-gateway')
  const btnNew      = document.getElementById('btn-new')
  const btnMic      = document.getElementById('btn-mic')
  const logViewer   = document.getElementById('log-viewer')
  const chatHistory = document.getElementById('chat-history')
  const chatEmpty   = document.getElementById('chat-empty')
  const offlineBadge = document.getElementById('offline-badge')

  // ── Micrófono: OFF | VAD | PTT ───────────────────────────────────────────────
  let micMode   = 'off'   // 'off' | 'vad' | 'ptt'
  let micInited = false
  let micStream  = null
  let micAudioCtx = null

  function updateMicUI(state) {
    if (!btnMic) return
    btnMic.className = 'ctrl-btn'
    switch (state) {
      case 'vad':
        btnMic.classList.add('mic-vad')
        btnMic.textContent = 'VAD'
        btnMic.title = 'VAD active — click for PTT'
        break
      case 'recording':
        btnMic.classList.add('mic-recording')
        btnMic.textContent = 'REC'
        btnMic.title = 'Recording...'
        break
      case 'ptt':
        btnMic.classList.add('mic-ptt')
        btnMic.textContent = 'PTT'
        btnMic.title = 'PTT — hold Alt to speak — click for OFF'
        break
      case 'off':
      default:
        btnMic.textContent = 'MIC'
        btnMic.title = 'Mic inactive (claps active) — click for VAD'
    }
  }

  async function initMic() {
    try {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
    } catch (e) {
      console.error('[mic] getUserMedia:', e.message)
      updateMicUI('off')
      return
    }

    micAudioCtx = new AudioContext()
    const source   = micAudioCtx.createMediaStreamSource(micStream)
    const analyser = micAudioCtx.createAnalyser()
    analyser.fftSize = 512
    source.connect(analyser)

    const dataArray      = new Uint8Array(analyser.frequencyBinCount)
    const THRESHOLD      = 25   // amplitud 0-128 sobre el centro
    const SILENCE_MS     = 1200
    const MIN_SPEECH_MS  = 400
    const PRE_FRAMES     = 8    // frames consecutivos sobre umbral antes de arrancar grabación

    let recording    = false
    let silenceTimer = null
    let speechStart  = null
    let speechFrames = 0       // contador de frames confirmando habla
    let recorder     = null
    let chunks       = []

    function getAmplitude() {
      analyser.getByteTimeDomainData(dataArray)
      let max = 0
      for (let i = 0; i < dataArray.length; i++) {
        const v = Math.abs(dataArray[i] - 128)
        if (v > max) max = v
      }
      return max
    }
    window._orbGetAmplitude = getAmplitude

    function startRec() {
      if (recording) return
      recording   = true
      speechStart = Date.now()
      chunks      = []
      recorder = new MediaRecorder(micStream, { mimeType: 'audio/webm;codecs=opus' })
      recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data) }
      recorder.onstop = () => {
        if (Date.now() - speechStart < MIN_SPEECH_MS) return
        const blob = new Blob(chunks, { type: 'audio/webm' })
        blob.arrayBuffer().then(buf => window.lucy?.transcribeAudio(buf))
      }
      recorder.start()
      setState('listening', 0)
      updateStatusDot('listening', isConnected)
      updateMicUI('recording')
    }

    function stopRec() {
      if (!recording) return
      recording = false
      speechFrames = 0
      if (recorder && recorder.state !== 'inactive') recorder.stop()
      setState('idle', 0)
      updateStatusDot('idle', isConnected)
      updateMicUI(micMode)
    }

    // Exponer para PTT
    window._micStartRec = startRec
    window._micStopRec  = stopRec

    function vadLoop() {
      requestAnimationFrame(vadLoop)
      if (micMode !== 'vad') return
      const amp = getAmplitude()
      if (amp > THRESHOLD) {
        clearTimeout(silenceTimer)
        silenceTimer = null
        speechFrames++
        // Arrancar grabación solo si el habla es sostenida (no un click instantáneo)
        if (!recording && speechFrames >= PRE_FRAMES) startRec()
      } else {
        if (!recording) speechFrames = 0
        if (recording && !silenceTimer) silenceTimer = setTimeout(stopRec, SILENCE_MS)
      }
    }

    // ── Detección de palmadas (Daddy's Home) ──────────────────────────────────
    const CLAP_THRESHOLD  = 110   // raw 0-128, palmada fuerte
    const CLAP_MIN_GAP_MS = 100   // mínimo entre la 1ª y 2ª palmada
    const CLAP_MAX_GAP_MS = 800   // máximo entre la 1ª y 2ª palmada
    let lastClapTime = 0
    let clapCooldown = false
    let clapReady = false
    setTimeout(() => { clapReady = true }, 4000)  // cooldown de arranque

    // setInterval en vez de RAF — sigue corriendo cuando la ventana está minimizada
    setInterval(() => {
      if (!clapReady || clapCooldown) return
      const amp = getAmplitude()
      if (amp < CLAP_THRESHOLD) return

      clapCooldown = true
      setTimeout(() => { clapCooldown = false }, 80)

      const now = Date.now()
      const gap = now - lastClapTime
      if (lastClapTime > 0 && gap >= CLAP_MIN_GAP_MS && gap <= CLAP_MAX_GAP_MS) {
        lastClapTime = 0
        console.log('[clap] Daddy\'s Home detectado')
        window.lucy?.daddysHome()
      } else {
        lastClapTime = now
      }
    }, 16)

    // Watchdog: reactiva AudioContext si Chromium lo suspende al minimizar
    setInterval(() => {
      if (micAudioCtx && micAudioCtx.state === 'suspended') {
        micAudioCtx.resume()
      }
    }, 1000)

    micMode   = 'off'
    micInited = true
    vadLoop()
    updateMicUI('off')
    console.log('[mic] Mic iniciado — claps activos, umbral clap', CLAP_THRESHOLD)
  }

  if (btnMic) {
    btnMic.addEventListener('click', async () => {
      if (!micInited) {
        await initMic()
        return
      }
      const cycle = { 'off': 'vad', 'vad': 'ptt', 'ptt': 'off' }
      micMode = cycle[micMode] || 'off'
      if (micMode !== 'vad') window._micStopRec?.()
      updateMicUI(micMode)
    })
  }

  // Auto-init mic al arrancar para que los claps funcionen sin tocar el botón
  setTimeout(() => { if (!micInited) initMic().catch(() => {}) }, 800)

  // PTT — Alt en modo PTT
  document.addEventListener('keydown', e => {
    if (e.code === 'AltLeft' && micMode === 'ptt' && micInited && !e.repeat) {
      e.preventDefault()
      window._micStartRec?.()
    }
  })
  document.addEventListener('keyup', e => {
    if (e.code === 'AltLeft' && micMode === 'ptt' && micInited) {
      window._micStopRec?.()
    }
  })

  // ── Tabs ──────────────────────────────────────────────────────────────────────
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'))
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'))
      tab.classList.add('active')
      document.getElementById(`tab-panel-${tab.dataset.tab}`).classList.add('active')
      if (tab.dataset.tab === 'orb') resize()
    })
  })

  // ── Controles de ventana ──────────────────────────────────────────────────────
  btnClose.addEventListener('click',    () => window.lucy?.close())
  btnMinimize.addEventListener('click', () => window.lucy?.minimize())

  btnGateway.addEventListener('click', () => {
    window.lucy?.startGateway()
    sendToLogs('Gateway: starting...', 'info')
  })

  btnNew.addEventListener('click', () => {
    window.lucy?.newSession()
    lastMsgEl.textContent = 'New session started'
  })

  // ── File attachments ──────────────────────────────────────────────────────────
  let attachedFiles = []  // [{ name, isImage, dataUrl?, buf: ArrayBuffer }]

  function attachFile(file) {
    const isImage = file.type.startsWith('image/')
    file.arrayBuffer().then(buf => {
      if (isImage) {
        const reader = new FileReader()
        reader.onload = e => {
          attachedFiles.push({ name: file.name, isImage: true, dataUrl: e.target.result, buf })
          renderPreviews()
        }
        reader.readAsDataURL(file)
      } else {
        attachedFiles.push({ name: file.name, isImage: false, buf })
        renderPreviews()
      }
    })
  }

  function renderPreviews() {
    for (const areaId of ['img-preview-area', 'img-preview-area-tab']) {
      const area = document.getElementById(areaId)
      if (!area) continue
      area.innerHTML = ''
      attachedFiles.forEach((f, i) => {
        const wrap = document.createElement('div')
        wrap.className = 'img-thumb-wrap'
        if (f.isImage) {
          wrap.innerHTML = `<img class="img-thumb" src="${f.dataUrl}">
            <button class="img-thumb-rm" data-i="${i}">×</button>`
        } else {
          wrap.innerHTML = `<div class="file-badge" title="${f.name}">📄 ${f.name}</div>
            <button class="img-thumb-rm" data-i="${i}">×</button>`
        }
        area.appendChild(wrap)
      })
    }
    document.querySelectorAll('.img-thumb-rm').forEach(btn =>
      btn.addEventListener('click', () => {
        attachedFiles.splice(+btn.dataset.i, 1)
        renderPreviews()
      })
    )
  }

  document.getElementById('file-input').addEventListener('change', e => {
    for (const f of e.target.files) attachFile(f)
    e.target.value = ''
  })
  document.getElementById('file-input-tab').addEventListener('change', e => {
    for (const f of e.target.files) attachFile(f)
    e.target.value = ''
  })
  document.getElementById('attach-btn').addEventListener('click', () =>
    document.getElementById('file-input').click()
  )
  document.getElementById('attach-btn-tab').addEventListener('click', () =>
    document.getElementById('file-input-tab').click()
  )

  document.addEventListener('paste', e => {
    for (const item of e.clipboardData?.items || []) {
      const file = item.getAsFile()
      if (file) attachFile(file)
    }
  })

  // ── Chat forms (Orb tab + Chat tab) ──────────────────────────────────────────
  function submitMessage(text) {
    if (!text && attachedFiles.length === 0) return
    if (attachedFiles.length > 0) {
      const filesData = attachedFiles.map(f => ({ name: f.name, buf: f.buf }))
      window.lucy?.sendMessageWithFiles(text, filesData)
      attachedFiles = []
      renderPreviews()
    } else {
      window.lucy?.sendMessage(text)
    }
  }

  chatForm.addEventListener('submit', (e) => {
    e.preventDefault()
    const text = inputEl.value.trim()
    inputEl.value = ''
    submitMessage(text)
  })

  chatFormTab.addEventListener('submit', (e) => {
    e.preventDefault()
    const text = inputTabEl.value.trim()
    inputTabEl.value = ''
    submitMessage(text)
  })

  function setInputEnabled(enabled) {
    inputEl.disabled    = !enabled
    sendBtn.disabled    = !enabled
    inputTabEl.disabled = !enabled
    sendBtnTab.disabled = !enabled
    if (enabled) {
      const active = document.querySelector('.tab.active')?.dataset.tab
      if (active === 'chat') inputTabEl.focus()
      else inputEl.focus()
    }
  }

  // ── Status dot ────────────────────────────────────────────────────────────────
  function updateStatusDot(stateName, connected) {
    statusDot.className = ''
    if (!connected) return
    statusDot.classList.add('connected')
    if (stateName !== 'idle') statusDot.classList.add(stateName)
  }

  // ── Log rendering: ANSI parser + heuristic colorizer ─────────────────────────

  // Paleta tipo Dracula para terminal oscura
  const ANSI_FG = {
    30:'#555766', 31:'#ff5555', 32:'#50fa7b', 33:'#f1fa8c',
    34:'#6272a4', 35:'#ff79c6', 36:'#8be9fd', 37:'#f8f8f2',
    90:'#6272a4', 91:'#ff6e6e', 92:'#69ff94', 93:'#ffffa5',
    94:'#d6acff', 95:'#ff92df', 96:'#a4ffff', 97:'#ffffff',
  }

  function escHtml(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
  }

  // Convierte secuencias ANSI SGR a spans HTML coloreados
  function ansiToHtml(raw) {
    const parts = raw.split(/(\x1b\[[0-9;]*m)/)
    let html = ''
    let open = false

    for (const part of parts) {
      const m = part.match(/^\x1b\[([0-9;]*)m$/)
      if (m) {
        if (open) { html += '</span>'; open = false }
        const codes = m[1] ? m[1].split(';').map(Number) : [0]
        let color = null, bold = false, dim = false
        for (const c of codes) {
          if (c === 0) { color = null; bold = false; dim = false }
          else if (c === 1) bold = true
          else if (c === 2) dim = true
          else if (ANSI_FG[c]) color = ANSI_FG[c]
        }
        if (color || bold || dim) {
          let style = ''
          if (color) style += `color:${color};`
          if (bold)  style += 'font-weight:700;'
          if (dim)   style += 'opacity:0.4;'
          html += `<span style="${style}">`
          open = true
        }
      } else if (part) {
        html += escHtml(part)
      }
    }

    if (open) html += '</span>'
    return html
  }

  // Colorización heurística para líneas sin ANSI (basada en patrones comunes de logs)
  function heuristicColorize(raw) {
    let s = escHtml(raw)
    // ISO timestamp
    s = s.replace(/(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}[.\d]*Z?)/g,
      '<span style="color:#6272a4">$1</span>')
    // Niveles de log
    s = s.replace(/\b(CRITICAL|FATAL)\b/g,
      '<span style="color:#ff0000;font-weight:700">$1</span>')
    s = s.replace(/\b(ERROR|ERR)\b/g,
      '<span style="color:#ff5555;font-weight:700">$1</span>')
    s = s.replace(/\b(WARN(?:ING)?)\b/g,
      '<span style="color:#f1fa8c">$1</span>')
    s = s.replace(/\b(INFO)\b/g,
      '<span style="color:#8be9fd">$1</span>')
    s = s.replace(/\b(DEBUG|TRACE|VERBOSE)\b/g,
      '<span style="color:#6272a4">$1</span>')
    // [módulo] entre corchetes
    s = s.replace(/(\[[a-zA-Z0-9:._\- ]+\])/g,
      '<span style="color:#bd93f9">$1</span>')
    // Puertos como :18790
    s = s.replace(/(:\d{4,5})\b/g,
      '<span style="color:#50fa7b">$1</span>')
    // Símbolos especiales
    s = s.replace(/(✓|✔)/g, '<span style="color:#50fa7b">$1</span>')
    s = s.replace(/(✗|✘|×)/g, '<span style="color:#ff5555">$1</span>')
    s = s.replace(/(→|←|⇒)/g, '<span style="color:#f1fa8c">$1</span>')
    return s
  }

  // ── Log viewer ────────────────────────────────────────────────────────────────
  const MAX_LOG_LINES = 500

  function sendToLogs(line, type = 'stdout') {
    const el = document.createElement('div')
    el.className = `log-line ${type}`

    if (type === 'stderr') {
      // stderr siempre en rojo, solo strip ANSI
      el.innerHTML = escHtml(line.replace(/\x1b\[[0-9;]*m/g, ''))
    } else if (type === 'info') {
      el.textContent = line
    } else {
      // stdout: parsear ANSI si hay, o colorizar heurísticamente
      const hasAnsi = /\x1b\[/.test(line)
      el.innerHTML = hasAnsi ? ansiToHtml(line) : heuristicColorize(line)
    }

    logViewer.appendChild(el)
    while (logViewer.children.length > MAX_LOG_LINES) {
      logViewer.removeChild(logViewer.firstChild)
    }
    const atBottom = logViewer.scrollHeight - logViewer.scrollTop - logViewer.clientHeight < 60
    if (atBottom) logViewer.scrollTop = logViewer.scrollHeight
  }

  // ── Chat history ──────────────────────────────────────────────────────────────

  function stripTtsTags(text) {
    return text.replace(/\[\[tts:text\]\]([\s\S]*?)\[\/tts:text\]\]/g, '$1').trim()
  }

  function markdownToHtml(text) {
    if (!text) return ''
    function esc(s) {
      return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    }
    function inline(s) {
      s = esc(s)
      s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      s = s.replace(/__(.+?)__/g, '<strong>$1</strong>')
      s = s.replace(/\*([^*\n]+?)\*/g, '<em>$1</em>')
      s = s.replace(/`([^`\n]+?)`/g, '<code>$1</code>')
      return s
    }
    const lines = text.split('\n')
    const out = []
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (line.trim() === '') { out.push('<br>'); continue }
      const h3 = line.match(/^### (.+)/)
      const h2 = line.match(/^## (.+)/)
      const h1 = line.match(/^# (.+)/)
      if (h3) { out.push(`<strong style="font-size:1.05em;display:block;margin-top:4px">${inline(h3[1])}</strong>`); continue }
      if (h2) { out.push(`<strong style="font-size:1.1em;display:block;margin-top:6px">${inline(h2[1])}</strong>`); continue }
      if (h1) { out.push(`<strong style="font-size:1.15em;display:block;margin-top:6px">${inline(h1[1])}</strong>`); continue }
      const bullet = line.match(/^[-*•] (.+)/)
      if (bullet) { out.push(`<span style="display:block;padding-left:1em">• ${inline(bullet[1])}</span>`); continue }
      const numbered = line.match(/^(\d+)\. (.+)/)
      if (numbered) { out.push(`<span style="display:block;padding-left:1em">${esc(numbered[1])}. ${inline(numbered[2])}</span>`); continue }
      out.push(inline(line) + '<br>')
    }
    return out.join('').replace(/(<br>)+$/, '')
  }

  function addChatBubble(role, text) {
    if (chatEmpty) chatEmpty.style.display = 'none'
    const wrap = document.createElement('div')
    wrap.className = `chat-bubble ${role}`
    const label = document.createElement('div')
    label.className = 'role-label'
    label.textContent = role === 'user' ? 'You' : AGENT_NAME
    const body = document.createElement('div')
    if (role === 'assistant') {
      body.innerHTML = markdownToHtml(stripTtsTags(text))
    } else {
      body.textContent = text
    }
    wrap.appendChild(label)
    wrap.appendChild(body)
    chatHistory.appendChild(wrap)
    chatHistory.scrollTop = chatHistory.scrollHeight
  }

  function clearChatHistory() {
    chatHistory.innerHTML = ''
    const empty = document.createElement('div')
    empty.id = 'chat-empty'
    empty.textContent = 'No messages yet'
    chatHistory.appendChild(empty)
  }

  // ── Eventos IPC desde main ────────────────────────────────────────────────────
  let isConnected = false

  window.lucy?.onGatewayStatus((connected) => {
    isConnected = connected
    setInputEnabled(connected)
    updateStatusDot(currentStateName, connected)
    if (!connected) {
      setState('idle', 0)
      lastMsgEl.textContent = 'Gateway offline — press "Gateway" to start'
      btnGateway.classList.remove('running')
      btnGateway.textContent = 'Gateway'
    } else {
      lastMsgEl.textContent = `${AGENT_NAME} ready`
      btnGateway.classList.add('running')
      btnGateway.textContent = 'Online'
    }
  })

  window.lucy?.onState(({ state, level }) => {
    setState(state, level)
    updateStatusDot(state, isConnected)
  })

  window.lucy?.onAudio((audioData) => {
    playAudio(audioData)
  })

  window.lucy?.onGatewayMsg((msg) => {
    lastMsgEl.textContent = msg
  })

  window.lucy?.onGatewayLog(({ line, type }) => {
    sendToLogs(line, type)
  })

  window.lucy?.onChatMessage(({ role, text }) => {
    addChatBubble(role, text)
    if (role === 'assistant') {
      const clean = stripTtsTags(text)
      lastMsgEl.textContent = `${AGENT_NAME}: ${clean.length > 80 ? clean.slice(0, 80) + '…' : clean}`
    } else {
      lastMsgEl.textContent = `You: ${text}`
    }
  })

  window.lucy?.onClearChat(() => {
    clearChatHistory()
    lastMsgEl.textContent = 'New session started'
  })

  window.lucy?.onConnectivity(({ online }) => {
    if (offlineBadge) offlineBadge.classList.toggle('visible', !online)
    if (!online) console.log('[net] Offline — TTS disabled')
  })


  // ── Nombre del agente (cargado desde config.json vía IPC) ────────────────────
  let AGENT_NAME = 'Agent'

  function applyAgentName(name) {
    AGENT_NAME = name
    const titleEl = document.getElementById('title-name')
    if (titleEl) titleEl.textContent = name
    document.title = name
    const inputEl2 = document.getElementById('chat-input')
    if (inputEl2) inputEl2.placeholder = `Talk to ${name}...`
    const inputTab2 = document.getElementById('chat-input-tab')
    if (inputTab2) inputTab2.placeholder = `Talk to ${name}...`
  }

  window.lucy?.getAgentName().then(name => {
    if (name) applyAgentName(name)
  }).catch(() => {})

  // ── Estado inicial ────────────────────────────────────────────────────────────
  setState('idle', 0)
  lastMsgEl.textContent = 'Starting...'

})()
