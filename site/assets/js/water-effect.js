// water-effect.js — Circular water ripple simulation on hero text + ring on mousemove
// Uses a 2D wave equation with double-buffer to create physically-accurate concentric rings.

;(function () {
  'use strict'

  // ── Ripple simulation ─────────────────────────────────────────────────────────
  const RW   = 128, RH = 80   // Displacement map resolution
  const DAMP = 0.952           // Wave energy decay per frame (lower = faster fade)
  const GRAD = 28              // Gradient amplification → displacement intensity

  let bufCur = new Float32Array(RW * RH)  // Heights at time t
  let bufPre = new Float32Array(RW * RH)  // Heights at time t-1

  // 2D wave equation: u(t+1) = (neighbors_avg * 2) - u(t-1), then damp
  function stepWave () {
    for (let y = 1; y < RH - 1; y++) {
      for (let x = 1; x < RW - 1; x++) {
        const i    = y * RW + x
        bufPre[i]  = (bufCur[i - 1] + bufCur[i + 1] + bufCur[i - RW] + bufCur[i + RW]) * 0.5 - bufPre[i]
        bufPre[i] *= DAMP
      }
    }
    const tmp = bufCur; bufCur = bufPre; bufPre = tmp
  }

  // Drop a disturbance at normalized coords (nx, ny) ∈ [0,1]
  function drop (nx, ny, strength) {
    const cx = Math.round(nx * (RW - 1))
    const cy = Math.round(ny * (RH - 1))
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        const x = cx + dx, y = cy + dy
        if (x < 1 || x >= RW - 1 || y < 1 || y >= RH - 1) continue
        const d = Math.sqrt(dx * dx + dy * dy) / 3
        if (d < 1) bufCur[y * RW + x] += strength * (1 - d)
      }
    }
  }

  // Check if any meaningful energy remains (stop animation when silent)
  function hasEnergy () {
    for (let i = 0; i < bufCur.length; i += 10) {
      if (Math.abs(bufCur[i]) > 0.008) return true
    }
    return false
  }

  // ── Displacement map canvas ───────────────────────────────────────────────────
  // The gradient of the height field gives displacement direction (points away from wave crests)
  const dCanvas = document.createElement('canvas')
  dCanvas.width = RW; dCanvas.height = RH
  const dCtx = dCanvas.getContext('2d')
  const pix  = dCtx.createImageData(RW, RH)

  // Initialize to 128 = neutral (no displacement)
  for (let i = 0; i < pix.data.length; i++) pix.data[i] = i % 4 === 3 ? 255 : 128

  function buildDispURL () {
    const d = pix.data
    for (let y = 1; y < RH - 1; y++) {
      for (let x = 1; x < RW - 1; x++) {
        const i = y * RW + x, p = i * 4
        const gx = (bufCur[i + 1]  - bufCur[i - 1])  * 0.5
        const gy = (bufCur[i + RW] - bufCur[i - RW]) * 0.5
        d[p]     = Math.min(255, Math.max(0, gx * GRAD + 128)) | 0
        d[p + 1] = Math.min(255, Math.max(0, gy * GRAD + 128)) | 0
        d[p + 2] = 128
        d[p + 3] = 255
      }
    }
    dCtx.putImageData(pix, 0, 0)
    return dCanvas.toDataURL()
  }

  // ── SVG filters ───────────────────────────────────────────────────────────────
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;overflow:hidden;pointer-events:none'
  svg.innerHTML = `
    <defs>
      <filter id="wfx-text" x="-50%" y="-50%" width="200%" height="200%"
              color-interpolation-filters="sRGB">
        <feImage id="wfx-img1" href="" preserveAspectRatio="none" result="dm"/>
        <feDisplacementMap in="SourceGraphic" in2="dm"
          scale="15" xChannelSelector="R" yChannelSelector="G"/>
      </filter>
      <filter id="wfx-ring" x="-12%" y="-12%" width="124%" height="124%"
              color-interpolation-filters="sRGB">
        <feImage id="wfx-img2" href="" preserveAspectRatio="none" result="dm2"/>
        <feDisplacementMap in="SourceGraphic" in2="dm2"
          scale="5" xChannelSelector="R" yChannelSelector="G"/>
      </filter>
    </defs>`
  document.body.appendChild(svg)

  const feImg1 = document.getElementById('wfx-img1')
  const feImg2 = document.getElementById('wfx-img2')

  // ── DOM targets ───────────────────────────────────────────────────────────────
  const hero = document.getElementById('hero')
  const h1   = document.querySelector('#hero h1')
  const ring = document.querySelector('.hero-ring-deco')
  if (!hero || !h1) return

  h1.style.filter     = 'url(#wfx-text)'
  h1.style.willChange = 'filter'
  if (ring) { ring.style.filter = 'url(#wfx-ring)'; ring.style.willChange = 'filter' }

  // Pre-warm the filter pipeline so the browser initializes feImage before first hover
  const warmURL = buildDispURL()
  feImg1.setAttribute('href', warmURL)
  feImg2.setAttribute('href', warmURL)

  // ── Animation state ───────────────────────────────────────────────────────────
  let raf = null, hovering = false
  let mx = 0, my = 0, px = 0, py = 0, lastDrop = 0

  // ── Tick ──────────────────────────────────────────────────────────────────────
  function tick (now) {
    // Create disturbance at cursor position (mapped to h1 filter region)
    if (hovering && now - lastDrop > 14) {
      const r  = h1.getBoundingClientRect()
      // Filter region: extends 50% of h1 size on each side
      const fx = r.left   - r.width  * 0.5
      const fy = r.top    - r.height * 0.5
      const fw = r.width  * 2.0
      const fh = r.height * 2.0
      const nx = (mx - fx) / fw
      const ny = (my - fy) / fh
      // Mouse velocity → wave strength (faster = bigger wave)
      const vx  = mx - px, vy = my - py
      const vel = Math.min(Math.sqrt(vx * vx + vy * vy), 60) / 60
      px = mx; py = my
      if (vel > 0.01 && nx > 0.02 && nx < 0.98 && ny > 0.02 && ny < 0.98) {
        drop(nx, ny, vel * 75)
      }
      lastDrop = now
    }

    stepWave()

    const url = buildDispURL()
    feImg1.setAttribute('href', url)
    feImg2.setAttribute('href', url)

    if (hovering || hasEnergy()) {
      raf = requestAnimationFrame(tick)
    } else {
      raf = null
    }
  }

  // ── Events ────────────────────────────────────────────────────────────────────
  hero.addEventListener('mousemove', e => {
    mx = e.clientX; my = e.clientY
    hovering = true
    if (!raf) {
      // Seed px/py slightly behind so the first event produces non-zero velocity
      px = mx - 2; py = my - 2
      raf = requestAnimationFrame(tick)
    }
  })

  hero.addEventListener('mouseleave', () => { hovering = false })

}())
