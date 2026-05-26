// ghost3d.js — Ghost 3D: cuerpo de partículas + GLB (ring/eyes/orbs) + scroll waypoints
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

;(function () {
  'use strict'

  // ╔══════════════════════════════════════════════════════════════════════════╗
  // ║  CONFIG                                                                   ║
  // ╚══════════════════════════════════════════════════════════════════════════╝
  const GHOST_SCALE = 0.4
  const LERP        = 0.04
  const FLOAT_AMP   = 0.20
  const FLOAT_SPEED = 0.75
  const DRIFT_AMP   = 0.06
  const DRIFT_SPEED = 0.40
  const ROT_SPEED   = 0.45

  const waypoints = [
    { sx: 0.70, sy: 0.38, scale: 1.50 },
    { sx: 0.74, sy: 0.25, scale: 0.80 },
    { sx: 0.86, sy: 0.40, scale: 0.80 },
    { sx: 0.82, sy: 0.87, scale: 0.55 },
    { sx: 0.78, sy: 0.25, scale: 0.50 },
    { sx: 0.90, sy: 0.98, scale: 0.50 },
    { sx: 0.50, sy: 0.80, scale: 0.50 },
  ]

  // ── Renderer ─────────────────────────────────────────────────────────────────
  const canvas   = document.getElementById('ghost-canvas')
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setSize(window.innerWidth, window.innerHeight)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping      = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.1

  const scene  = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.1, 100)
  camera.position.z = 6

  window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight)
    camera.aspect = window.innerWidth / window.innerHeight
    camera.updateProjectionMatrix()
  })

  scene.add(new THREE.AmbientLight(0xffffff, 0.5))
  const keyLight = new THREE.DirectionalLight(0x00e5c3, 2.0)
  keyLight.position.set(3, 5, 3)
  scene.add(keyLight)
  const fillLight = new THREE.PointLight(0xff2882, 2.0, 12)
  fillLight.position.set(-3, 1, 2)
  scene.add(fillLight)
  // Luz extra para iluminar el cristal de partículas
  const innerLight = new THREE.PointLight(0x00e5c3, 1.8, 8)
  scene.add(innerLight)

  // ── GLB materials ────────────────────────────────────────────────────────────

  // Ojos: cristal con transmisión + emisión cyan fuerte
  const eyeMat = new THREE.MeshPhysicalMaterial({
    color:              new THREE.Color(0.0,  0.90, 0.82),
    emissive:           new THREE.Color(0.0,  0.898, 0.765),
    emissiveIntensity:  3.0,
    transmission:       0.55,
    thickness:          0.3,
    roughness:          0.02,
    ior:                1.52,
    metalness:          0.0,
    clearcoat:          1.0,
    clearcoatRoughness: 0.02,
    transparent:        true,
    opacity:            1.0,
  })

  const ringMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0.04, 0.09, 0.14), metalness: 0.95, roughness: 0.04,
    emissive: new THREE.Color(0, 0.898, 0.765), emissiveIntensity: 1.0,
  })

  function applyMaterials(root) {
    root.traverse(obj => {
      if (!obj.isMesh) return
      const n = obj.name.toLowerCase()
      if      (n.includes('eye'))                                                obj.material = eyeMat
      else if (n.includes('ring') || n.includes('tech') || n.includes('halo'))  obj.material = ringMat
      else if (n.includes('orb'))                                                obj.visible  = false
    })
  }

  // ╔══════════════════════════════════════════════════════════════════════════╗
  // ║  CUERPO DE PARTÍCULAS — ghost shape + crystal shader                     ║
  // ╚══════════════════════════════════════════════════════════════════════════╝

  const SNOISE = `
    vec3 mod289v3(vec3 x){return x-floor(x*(1./289.))*289.;}
    vec4 mod289v4(vec4 x){return x-floor(x*(1./289.))*289.;}
    vec4 permute(vec4 x){return mod289v4(((x*34.)+1.)*x);}
    vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
    float snoise(vec3 v){
      const vec2 C=vec2(1./6.,1./3.);const vec4 D=vec4(0.,.5,1.,2.);
      vec3 i=floor(v+dot(v,C.yyy));vec3 x0=v-i+dot(i,C.xxx);
      vec3 g=step(x0.yzx,x0.xyz);vec3 l=1.-g;
      vec3 i1=min(g.xyz,l.zxy);vec3 i2=max(g.xyz,l.zxy);
      vec3 x1=x0-i1+C.xxx;vec3 x2=x0-i2+C.yyy;vec3 x3=x0-D.yyy;
      i=mod289v3(i);
      vec4 p=permute(permute(permute(i.z+vec4(0.,i1.z,i2.z,1.))+i.y+vec4(0.,i1.y,i2.y,1.))+i.x+vec4(0.,i1.x,i2.x,1.));
      float n_=.142857142857;vec3 ns=n_*D.wyz-D.xzx;
      vec4 j=p-49.*floor(p*ns.z*ns.z);
      vec4 x_=floor(j*ns.z);vec4 y_=floor(j-7.*x_);
      vec4 x=x_*ns.x+ns.yyyy;vec4 y=y_*ns.x+ns.yyyy;
      vec4 h=1.-abs(x)-abs(y);vec4 b0=vec4(x.xy,y.xy);vec4 b1=vec4(x.zw,y.zw);
      vec4 s0=floor(b0)*2.+1.;vec4 s1=floor(b1)*2.+1.;vec4 sh=-step(h,vec4(0.));
      vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
      vec3 p0=vec3(a0.xy,h.x);vec3 p1=vec3(a0.zw,h.y);vec3 p2=vec3(a1.xy,h.z);vec3 p3=vec3(a1.zw,h.w);
      vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
      p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
      vec4 m=max(.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.);
      m=m*m;return 42.*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
    }
  `

  const bodyVertexShader = SNOISE + `
    uniform float uTime;
    attribute vec3  aSeed;
    attribute float aLat;
    attribute float aLon;
    attribute float aPhase;
    attribute float aSparkle;
    varying float vAlpha;
    varying float vSparkle;

    // Radio de la silueta del fantasma según latitud y longitud
    float ghostR(float lat, float lon) {
      float y = cos(lat);
      if (y > -0.20) {
        // Cuerpo oval — parte superior
        return 0.82 + 0.04 * y;
      } else {
        // Cola: taper suave — llega hasta donde están los orbes
        float t     = (-0.20 - y) / 0.80;
        float taper = 1.0 - t * 0.55;
        float wave  = 1.0 + 0.18 * sin(3.0 * lon + 0.5);
        return 0.86 * taper * wave;
      }
    }

    void main() {
      float t   = uTime;
      float lon = aLon + t * 0.18;

      float r   = ghostR(aLat, lon);
      // Micro-ruido orgánico
      r += snoise(aSeed * 2.8 + vec3(t * 0.28 + aPhase, aPhase, 0.0)) * 0.028;

      vec3 pos;
      pos.x = sin(aLat) * cos(lon) * r;
      pos.y = cos(aLat) * r * 1.22;   // estirado vertical
      pos.z = sin(aLat) * sin(lon) * r * 0.70;  // ligeramente plano en profundidad

      // Respiración
      pos *= 1.0 + sin(t * 0.75 + aPhase * 0.5) * 0.018;

      vec4 mvPos    = modelViewMatrix * vec4(pos, 1.0);
      float mvDist  = 3.0 / -mvPos.z;
      gl_PointSize  = (1.6 + aSparkle * 1.8) * mvDist;
      gl_Position   = projectionMatrix * mvPos;

      vAlpha   = 0.80;
      vSparkle = aSparkle;
    }
  `

  const bodyFragmentShader = `
    varying float vAlpha;
    varying float vSparkle;

    void main() {
      vec2  uv = gl_PointCoord - 0.5;
      float r  = length(uv);
      if (r > 0.5) discard;

      // Núcleo nítido + glow suave + borde tipo Fresnel (vidrio)
      float core  = exp(-r * r * 30.0);
      float glow  = exp(-r * r * 5.5) * 0.22;
      float rim   = smoothstep(0.34, 0.50, r) * (0.32 + vSparkle * 0.68);

      vec3 base   = vec3(0.0,  0.86, 0.80);
      vec3 cyan   = vec3(0.38, 0.96, 1.0);
      vec3 white  = vec3(1.0,  1.0,  1.0);
      vec3 iceRim = vec3(0.65, 1.0,  1.0);

      vec3 col = mix(base, cyan, glow * 2.5);
      col = mix(col, white,  vSparkle * core);
      col += rim * iceRim * 0.75;

      float alpha = (core * 0.75 + glow + rim) * vAlpha * (0.52 + vSparkle * 0.48);
      gl_FragColor = vec4(col, alpha);
    }
  `

  // ── Glow layer (puntos grandes y suaves encima del cuerpo) ───────────────────
  const glowFragmentShader = `
    varying float vAlpha;
    varying float vSparkle;
    void main() {
      vec2  uv = gl_PointCoord - 0.5;
      float r  = length(uv);
      if (r > 0.5) discard;
      float g = exp(-r * r * 1.4);
      gl_FragColor = vec4(0.0, 0.88, 0.80, g * vAlpha * 0.06);
    }
  `

  function buildBodyGeo(count) {
    const PHI     = (1 + Math.sqrt(5)) / 2
    const seed    = new Float32Array(count * 3)
    const lat     = new Float32Array(count)
    const lon     = new Float32Array(count)
    const phase   = new Float32Array(count)
    const sparkle = new Float32Array(count)

    for (let i = 0; i < count; i++) {
      seed[i*3]   = Math.random()
      seed[i*3+1] = Math.random()
      seed[i*3+2] = Math.random()
      lat[i]   = Math.acos(1 - (2 * i + 1) / count)
      lon[i]   = (2 * Math.PI * i / PHI) % (2 * Math.PI)
      phase[i] = Math.random() * Math.PI * 2
      const rs = Math.random()
      sparkle[i] = rs < 0.68 ? 0.0 : rs < 0.90 ? Math.random() * 0.52 : 0.72 + Math.random() * 0.28
    }

    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3))
    geo.setAttribute('aSeed',    new THREE.BufferAttribute(seed, 3))
    geo.setAttribute('aLat',     new THREE.BufferAttribute(lat, 1))
    geo.setAttribute('aLon',     new THREE.BufferAttribute(lon, 1))
    geo.setAttribute('aPhase',   new THREE.BufferAttribute(phase, 1))
    geo.setAttribute('aSparkle', new THREE.BufferAttribute(sparkle, 1))
    return geo
  }

  const bodyUniforms = { uTime: { value: 0 } }

  const bodyGeo = buildBodyGeo(2800)

  const bodyPoints = new THREE.Points(bodyGeo, new THREE.ShaderMaterial({
    uniforms:       bodyUniforms,
    vertexShader:   bodyVertexShader,
    fragmentShader: bodyFragmentShader,
    transparent:    true,
    depthWrite:     false,
    blending:       THREE.AdditiveBlending,
  }))
  bodyPoints.frustumCulled = false

  const glowPoints = new THREE.Points(bodyGeo, new THREE.ShaderMaterial({
    uniforms:       bodyUniforms,
    vertexShader:   bodyVertexShader.replace(
      'gl_PointSize  = (1.6 + aSparkle * 1.8) * mvDist;',
      'gl_PointSize  = (6.0 + aSparkle * 4.0) * mvDist;'
    ),
    fragmentShader: glowFragmentShader,
    transparent:    true,
    depthWrite:     false,
    blending:       THREE.AdditiveBlending,
  }))
  glowPoints.frustumCulled = false

  // ── Ghost group — contiene partículas + GLB ───────────────────────────────────
  const ghostGroup = new THREE.Group()
  ghostGroup.add(bodyPoints)
  ghostGroup.add(glowPoints)
  scene.add(ghostGroup)

  new GLTFLoader().load(
    'assets/img/openghost-mascot.glb',
    (gltf) => {
      applyMaterials(gltf.scene)
      ghostGroup.add(gltf.scene)
      console.log('[ghost3d] GLB ✓')
    },
    undefined,
    (err) => console.error('[ghost3d] GLB error:', err)
  )

  // ── Scroll waypoints ─────────────────────────────────────────────────────────
  function screenToWorld(sx, sy) {
    const h = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * camera.position.z
    return { x: (sx - 0.5) * h * camera.aspect, y: (0.5 - sy) * h }
  }

  const cur    = { sx: waypoints[0].sx, sy: waypoints[0].sy, scale: waypoints[0].scale }
  const target = { sx: cur.sx, sy: cur.sy, scale: cur.scale }

  window.addEventListener('scroll', () => {
    const maxScroll = document.documentElement.scrollHeight - window.innerHeight
    const progress  = maxScroll > 0 ? Math.min(window.scrollY / maxScroll, 1) : 0
    const segCount  = waypoints.length - 1
    const seg       = progress * segCount
    const i         = Math.min(Math.floor(seg), segCount - 1)
    const t         = seg - i
    const ease      = t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t+2,3)/2
    const a = waypoints[i], b = waypoints[i + 1]
    target.sx    = a.sx    + (b.sx    - a.sx)    * ease
    target.sy    = a.sy    + (b.sy    - a.sy)    * ease
    target.scale = a.scale + (b.scale - a.scale) * ease
  }, { passive: true })

  // ── Animate ──────────────────────────────────────────────────────────────────
  const clock = new THREE.Clock()

  ;(function animate() {
    requestAnimationFrame(animate)
    const t = clock.getElapsedTime()

    bodyUniforms.uTime.value = t

    cur.sx    += (target.sx    - cur.sx)    * LERP
    cur.sy    += (target.sy    - cur.sy)    * LERP
    cur.scale += (target.scale - cur.scale) * LERP

    const { x, y } = screenToWorld(cur.sx, cur.sy)
    ghostGroup.position.x = x + Math.sin(t * DRIFT_SPEED + 1.2) * DRIFT_AMP
    ghostGroup.position.y = y + Math.sin(t * FLOAT_SPEED) * FLOAT_AMP
    ghostGroup.rotation.y = t * ROT_SPEED
    ghostGroup.rotation.z = Math.sin(t * 0.60) * 0.07
    ghostGroup.rotation.x = Math.sin(t * 0.35 + 0.5) * 0.04
    ghostGroup.scale.setScalar(cur.scale * GHOST_SCALE)

    // Luz interior sigue al fantasma
    innerLight.position.copy(ghostGroup.position)
    innerLight.position.y += 0.1

    renderer.render(scene, camera)
  })()

})()
