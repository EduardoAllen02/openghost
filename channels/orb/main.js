/**
 * main.js — Proceso principal del Orbe de Voz de OpenGhost
 *
 * Responsabilidades:
 *  - BrowserWindow: UI del orbe (frameless)
 *  - HTTP client → daemon OpenGhost :8787 (reemplaza OpenClaw WS)
 *  - IPC → renderer: estados, audio, logs, chat
 *  - TTS: POST al proxy local :5052
 *  - STT: Groq Whisper
 *  - TTS Proxy: spawneado como proceso hijo desde tts-proxy/proxy.py
 */

const { app, BrowserWindow, ipcMain } = require('electron')

app.commandLine.appendSwitch('disable-background-timer-throttling')
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
const path      = require('path')
const http      = require('http')
const https     = require('https')
const dns       = require('dns')
const crypto    = require('crypto')
const os        = require('os')
const { spawn } = require('child_process')
const fs        = require('fs')

// Cargar .env del proyecto OpenGhost (dos niveles arriba: channels/orb → OpenGhost)
;(function loadGhostEnv() {
  try {
    const envPath = path.join(__dirname, '..', '..', '.env')
    if (!fs.existsSync(envPath)) return
    const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/)
    for (const line of lines) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
    }
  } catch {}
})()

// ── Config ───────────────────────────────────────────────────────────────────
const configPath = path.join(__dirname, 'config.json')
const CFG = JSON.parse(fs.readFileSync(configPath, 'utf8'))

// ── Daddy's Home — guardia una-vez-al-día ─────────────────────────────────────
const LAST_GREET_PATH = path.join(__dirname, 'config', 'last-greet.json')

function todayMX() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' })
}

// ── Estado global ─────────────────────────────────────────────────────────────
let mainWindow      = null
let ttsProxyProcess = null
let currentState    = 'idle'
let chatHistory     = []
let isOnline        = true
let ghostBusy       = false
let reasoningMode   = false

// ── Detección de conectividad ─────────────────────────────────────────────────
function checkConnectivity() {
  dns.lookup('8.8.8.8', (err) => {
    const online = !err
    if (online !== isOnline) {
      isOnline = online
      console.log(`[net] ${online ? '● Online' : '○ Offline'}`)
      sendToRenderer('connectivity-changed', { online })
    }
  })
}

// ── BrowserWindow ─────────────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width:    440,
    height:   620,
    minWidth: 340,
    minHeight: 500,
    frame:    false,
    transparent: false,
    backgroundColor: '#000000',
    alwaysOnTop: false,
    resizable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  })

  mainWindow.webContents.session.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'media' || permission === 'microphone')
  })

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'))
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.setAudioMuted(false)
  })

  mainWindow.webContents.setBackgroundThrottling(false)

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  }

  mainWindow.on('closed', () => { mainWindow = null })
}

// ── TTS Proxy auto-arranque ───────────────────────────────────────────────────
const TTS_PROXY_PATH = path.join(__dirname, '..', '..', 'tts-proxy', 'proxy.py')

function pingTtsProxy() {
  return new Promise(resolve => {
    const port = CFG.ttsProxyPort || 5052
    const req = http.request(
      { hostname: '127.0.0.1', port, path: '/health', method: 'GET' },
      () => resolve(true)
    )
    req.on('error', () => resolve(false))
    req.setTimeout(1000, () => { req.destroy(); resolve(false) })
    req.end()
  })
}

async function startTtsProxy() {
  if (await pingTtsProxy()) {
    console.log(`[tts-proxy] Ya corriendo en :${CFG.ttsProxyPort || 5052}`)
    return
  }
  if (!fs.existsSync(TTS_PROXY_PATH)) {
    console.warn('[tts-proxy] No encontrado en', TTS_PROXY_PATH)
    return
  }
  const port = String(CFG.ttsProxyPort || 5052)
  const proc = spawn('python', [TTS_PROXY_PATH, '--port', port], {
    stdio: 'pipe',
    env: { ...process.env },
    cwd: path.join(__dirname, '..', '..'),
  })
  proc.stdout.on('data', d => d.toString().split('\n').filter(Boolean).forEach(line =>
    sendToRenderer('gateway-log', { line: `[tts-proxy] ${line}`, type: 'stdout' })))
  proc.stderr.on('data', d => d.toString().split('\n').filter(Boolean).forEach(line =>
    sendToRenderer('gateway-log', { line: `[tts-proxy] ${line}`, type: 'stderr' })))
  proc.on('close', code => {
    ttsProxyProcess = null
    console.log(`[tts-proxy] Cerrado (code ${code ?? '?'})`)
  })
  proc.on('error', err => console.error('[tts-proxy] Error:', err.message))
  ttsProxyProcess = proc
  console.log(`[tts-proxy] Iniciado en :${port}`)
}

// ── Conectar al daemon OpenGhost ──────────────────────────────────────────────
async function pingDaemon() {
  return new Promise(resolve => {
    const url = new URL(CFG.daemonUrl)
    const req = http.request(
      { hostname: url.hostname, port: Number(url.port) || 8787, path: '/status', method: 'GET' },
      (res) => resolve(res.statusCode < 500)
    )
    req.on('error', () => resolve(false))
    req.setTimeout(1500, () => { req.destroy(); resolve(false) })
    req.end()
  })
}

async function waitForDaemon(retries = 10, delayMs = 1500) {
  for (let i = 0; i < retries; i++) {
    if (await pingDaemon()) {
      sendToRenderer('gateway-connected', true)
      sendToRenderer('gateway-log', { line: '[daemon] OpenGhost conectado', type: 'info' })
      console.log('[daemon] Conectado')
      return true
    }
    sendToRenderer('gateway-log', { line: `[daemon] Esperando... (${i + 1}/${retries})`, type: 'info' })
    await new Promise(r => setTimeout(r, delayMs))
  }
  sendToRenderer('gateway-connected', false)
  sendToRenderer('gateway-log', { line: '[daemon] No se pudo conectar al daemon', type: 'stderr' })
  return false
}

// ── HTTP helper ───────────────────────────────────────────────────────────────
function httpPost(urlStr, payload, timeoutMs = 500_000) {
  return new Promise((resolve, reject) => {
    const body = Buffer.from(JSON.stringify(payload))
    const url  = new URL(urlStr)
    const req  = http.request({
      hostname: url.hostname,
      port:     Number(url.port) || 8787,
      path:     url.pathname,
      method:   'POST',
      headers:  {
        'Content-Type':   'application/json',
        'Content-Length': body.length,
        ...(CFG.daemonToken ? { 'X-Ghost-Token': CFG.daemonToken } : {}),
      },
      timeout: timeoutMs,
    }, (res) => {
      const chunks = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => {
        try {
          const data = JSON.parse(Buffer.concat(chunks).toString('utf8'))
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(data)
          else reject(Object.assign(new Error(data.error || `HTTP ${res.statusCode}`), { status: res.statusCode }))
        } catch {
          reject(new Error(`Respuesta inválida (HTTP ${res.statusCode})`))
        }
      })
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')) })
    req.write(body)
    req.end()
  })
}

// ── SSE log stream ────────────────────────────────────────────────────────────
function startLogStream() {
  const url = new URL(CFG.daemonUrl + '/logs/stream')
  const req = http.request({
    hostname: url.hostname,
    port: Number(url.port) || 8787,
    path: '/logs/stream',
    method: 'GET',
  }, (res) => {
    let buf = ''
    res.on('data', (chunk) => {
      buf += chunk.toString()
      const parts = buf.split('\n')
      buf = parts.pop()
      for (const part of parts) {
        if (!part.startsWith('data: ')) continue
        try {
          const { line } = JSON.parse(part.slice(6))
          if (!line) continue
          const isThinking = line.startsWith('[thinking]')
          const isTool     = line.startsWith('→ ') || line.startsWith('[session]')
          if (isTool) {
            sendToRenderer('gateway-log', { line, type: 'stdout' })
          } else if (isThinking && reasoningMode) {
            sendToRenderer('gateway-log', { line, type: 'info' })
          }
        } catch {}
      }
    })
  })
  req.on('error', () => {})
  req.end()
  return req
}

// ── Enviar mensaje al daemon ──────────────────────────────────────────────────
const STATE_IMG_DIR = path.join(__dirname, '..', '..', 'state', 'images')

async function sendToGhost(text, imagePaths = []) {
  const trimmed = (text || '').trim()
  // Comando /reasoning
  if (/^\/reasoning\s+(true|false|on|off)$/i.test(trimmed)) {
    const val = trimmed.split(/\s+/)[1].toLowerCase()
    reasoningMode = val === 'true' || val === 'on'
    const status = reasoningMode ? 'ON — mostrando thinking completo' : 'OFF — solo herramientas'
    sendToRenderer('chat-message', { role: 'system', text: `/reasoning ${status}` })
    sendToRenderer('gateway-log', { line: `[reasoning] ${status}`, type: 'info' })
    return
  }

  // Comando /stop — mata el proceso de Claude en curso
  if (trimmed.toLowerCase() === '/stop') {
    if (!ghostBusy) {
      sendToRenderer('chat-message', { role: 'system', text: 'No hay nada que detener.' })
      return
    }
    sendToRenderer('gateway-log', { line: '[stop] Deteniendo Claude...', type: 'info' })
    try { await httpPost(CFG.daemonUrl + '/stop', {}) } catch {}
    return
  }

  if (ghostBusy) {
    sendToRenderer('chat-message', { role: 'system', text: 'Claude está procesando otro mensaje.' })
    return
  }
  ghostBusy = true
  const displayText = text || (imagePaths.length ? `[${imagePaths.length} archivo(s)]` : '')
  chatHistory.push({ role: 'user', text: displayText, ts: Date.now() })
  sendToRenderer('chat-message', { role: 'user', text: displayText })
  setOrbState('thinking', 0)
  console.log(`[ghost] → "${displayText.substring(0, 80)}"`)

  const logReq = startLogStream()

  try {
    const payload = { text: text || 'Analiza esta imagen.', channel: 'orb' }
    if (imagePaths.length) payload.image_paths = imagePaths
    const data = await httpPost(CFG.daemonUrl + '/message', payload)
    handleGhostResponse(data.text || '', data.audio_text || '', data.has_audio || false)
  } catch (err) {
    console.error('[ghost] Error:', err.message)
    setOrbState('idle', 0)
    const msg = err.status === 503
      ? 'Claude está ocupado, intenta en un momento.'
      : `Error: ${err.message}`
    sendToRenderer('chat-message', { role: 'system', text: msg })
  } finally {
    setTimeout(() => logReq.destroy(), 600)
    for (const p of imagePaths) { try { fs.unlinkSync(p) } catch {} }
    ghostBusy = false
  }
}

// ── Manejar respuesta del daemon ──────────────────────────────────────────────
async function handleGhostResponse(text, audioText, hasAudio) {
  if (text) {
    chatHistory.push({ role: 'assistant', text, ts: Date.now() })
    sendToRenderer('chat-message', { role: 'assistant', text })
    console.log(`[ghost] ← "${text.substring(0, 100)}"`)
  }
  if (!hasAudio || !audioText) {
    setOrbState('idle', 0)
    return
  }
  setOrbState('speaking', 0.6)
  if (!isOnline) {
    console.warn('[tts] Sin internet — solo texto')
    setOrbState('idle', 0)
    return
  }
  try {
    const mp3 = await fetchTTS(audioText)
    console.log(`[tts] ${mp3.length} bytes`)
    sendToRenderer('play-audio', { data: mp3.toString('base64'), format: 'mp3' })
  } catch (err) {
    console.error('[tts] Error:', err.message)
    setOrbState('idle', 0)
  }
}

// ── TTS fetch ─────────────────────────────────────────────────────────────────
function fetchTTS(text) {
  return new Promise((resolve, reject) => {
    const body = Buffer.from(JSON.stringify({
      model: CFG.ttsModel,
      input: text,
      voice: CFG.ttsVoice || undefined,
    }))
    const url = new URL(CFG.ttsUrl)
    const req = http.request({
      hostname: url.hostname,
      port:     Number(url.port) || 80,
      path:     url.pathname,
      method:   'POST',
      headers:  { 'Content-Type': 'application/json', 'Content-Length': body.length },
    }, (res) => {
      const chunks = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => {
        if (res.statusCode === 200) resolve(Buffer.concat(chunks))
        else reject(new Error(`TTS HTTP ${res.statusCode}`))
      })
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

// ── Groq Whisper STT ──────────────────────────────────────────────────────────
function groqTranscribe(audioBuffer) {
  return new Promise((resolve, reject) => {
    const apiKey = process.env.GROQ_API_KEY
    if (!apiKey) { reject(new Error('GROQ_API_KEY no configurada')); return }

    const boundary = `boundary${crypto.randomUUID().replace(/-/g, '')}`
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-large-v3-turbo\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="language"\r\n\r\nes\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="response_format"\r\n\r\ntext\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.webm"\r\nContent-Type: audio/webm\r\n\r\n`),
      Buffer.from(audioBuffer),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ])

    const req = https.request({
      hostname: 'api.groq.com',
      path:     '/openai/v1/audio/transcriptions',
      method:   'POST',
      headers:  {
        'Authorization':  `Bearer ${apiKey}`,
        'Content-Type':   `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
      },
    }, (res) => {
      const chunks = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8').trim()
        if (res.statusCode === 200) resolve(text)
        else reject(new Error(`Groq STT ${res.statusCode}: ${text.substring(0, 120)}`))
      })
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

const STT_HALLUCINATIONS = new Set([
  'suscríbete al canal', 'suscribete al canal', 'subscribe to the channel',
  'suscríbete', 'suscribete', 'subscribe', 'like y suscríbete',
  'gracias por ver', 'thanks for watching', 'bye', 'adiós',
])

ipcMain.handle('transcribe-audio', async (_event, audioBuffer) => {
  try {
    const text = await groqTranscribe(Buffer.from(audioBuffer))
    if (!text) return null
    const normalized = text.toLowerCase().trim().replace(/[¡!¿?.,]+/g, '').trim()
    if (normalized.length < 2 || STT_HALLUCINATIONS.has(normalized)) {
      console.log(`[stt] Descartado: "${text}"`)
      return null
    }
    console.log(`[stt] "${text.substring(0, 100)}"`)
    sendToGhost(text)
    return text
  } catch (err) {
    console.error('[stt]', err.message)
    return null
  }
})

// ── Helpers IPC ───────────────────────────────────────────────────────────────
function setOrbState(state, level) {
  currentState = state
  sendToRenderer('state-change', { state, level })
}

function sendToRenderer(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data)
  }
}

// ── IPC desde renderer ────────────────────────────────────────────────────────
ipcMain.handle('send-message', (_event, text) => {
  sendToGhost(text)
})

ipcMain.handle('send-message-with-images', async (_event, text, imageBufs) => {
  fs.mkdirSync(STATE_IMG_DIR, { recursive: true })
  const ts = Date.now()
  const imagePaths = imageBufs.map((buf, i) => {
    const p = path.join(STATE_IMG_DIR, `orb_${ts}_${i}.png`)
    fs.writeFileSync(p, Buffer.from(buf))
    return p
  })
  await sendToGhost(text, imagePaths)
})

ipcMain.handle('send-message-with-files', async (_event, text, filesData) => {
  fs.mkdirSync(STATE_IMG_DIR, { recursive: true })
  const ts = Date.now()
  const filePaths = filesData.map(({ name, buf }, i) => {
    const ext = path.extname(name) || '.bin'
    const safe = path.basename(name, ext).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40)
    const p = path.join(STATE_IMG_DIR, `orb_${ts}_${i}_${safe}${ext}`)
    fs.writeFileSync(p, Buffer.from(buf))
    return p
  })
  await sendToGhost(text, filePaths)
})

ipcMain.handle('switch-model', () => {})  // no-op (Claude es el único motor)

ipcMain.on('new-session', async () => {
  chatHistory = []
  sendToRenderer('clear-chat', null)
  try {
    await httpPost(CFG.daemonUrl + '/session/new', {})
    console.log('[session] Nueva sesión solicitada')
  } catch (err) {
    console.error('[session] Error:', err.message)
  }
})

ipcMain.on('start-gateway', async () => {
  sendToRenderer('gateway-log', { line: '[daemon] Reconectando...', type: 'info' })
  await waitForDaemon()
})

ipcMain.on('audio-ended', () => {
  setOrbState('idle', 0)
})

ipcMain.on('daddys-home', () => {
  if (ghostBusy) return
  const today = todayMX()
  try {
    const saved = JSON.parse(fs.readFileSync(LAST_GREET_PATH, 'utf8'))
    if (saved.date === today) {
      sendToRenderer('gateway-log', { line: '[daddy] Ya ejecutado hoy — omitiendo', type: 'info' })
      return
    }
  } catch {}
  fs.writeFileSync(LAST_GREET_PATH, JSON.stringify({ date: today }))
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
  sendToRenderer('gateway-log', { line: '[daddy] Protocolo Daddy\'s Home activado', type: 'info' })
  sendToGhost('__DADDY_HOME__')
})

ipcMain.on('window-close', () => {
  app.quit()
})

ipcMain.on('window-minimize', () => {
  if (mainWindow) mainWindow.minimize()
})

// ── Session usage (5-hour rolling window) ────────────────────────────────────
function getSessionUsage() {
  const projectsDir = path.join(os.homedir(), '.claude', 'projects')
  const windowStart = Date.now() - 5 * 60 * 60 * 1000
  let totalOutput = 0, totalInput = 0, totalCacheWrite = 0, totalCacheRead = 0

  try {
    const projects = fs.readdirSync(projectsDir)
    for (const proj of projects) {
      const projPath = path.join(projectsDir, proj)
      let files
      try { files = fs.readdirSync(projPath) } catch { continue }
      for (const file of files) {
        if (!file.endsWith('.jsonl')) continue
        const filePath = path.join(projPath, file)
        try {
          if (fs.statSync(filePath).mtimeMs < windowStart) continue
          const lines = fs.readFileSync(filePath, 'utf8').split('\n')
          for (const line of lines) {
            if (!line.trim()) continue
            try {
              const usage = JSON.parse(line)?.message?.usage
              if (!usage) continue
              totalOutput     += usage.output_tokens                   || 0
              totalInput      += usage.input_tokens                    || 0
              totalCacheWrite += usage.cache_creation_input_tokens     || 0
              totalCacheRead  += usage.cache_read_input_tokens         || 0
            } catch {}
          }
        } catch {}
      }
    }
  } catch {}

  const costUSD = (totalInput * 3 + totalCacheWrite * 3.75 + totalCacheRead * 0.30 + totalOutput * 15) / 1_000_000
  return { totalOutput, totalInput, costUSD, percent: Math.min(1, costUSD / 20) }
}

ipcMain.handle('get-session-usage', () => getSessionUsage())

// ── App lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  createWindow()

  checkConnectivity()
  setInterval(checkConnectivity, 15000)

  mainWindow.webContents.once('did-finish-load', () => {
    setTimeout(() => startTtsProxy(), 800)
    setTimeout(() => waitForDaemon(), 1500)
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  if (ttsProxyProcess) { try { ttsProxyProcess.kill() } catch {} }
})
