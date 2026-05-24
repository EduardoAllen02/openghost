/**
 * preload.js — Bridge seguro entre main y renderer
 */

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('lucy', {
  // Enviar mensaje de texto a Lucy
  sendMessage: (text) => ipcRenderer.invoke('send-message', text),

  // Enviar mensaje con imágenes adjuntas (ArrayBuffers) — legacy
  sendMessageWithImages: (text, bufs) => ipcRenderer.invoke('send-message-with-images', text, bufs),

  // Enviar mensaje con archivos adjuntos de cualquier tipo [{ name, buf }]
  sendMessageWithFiles: (text, filesData) => ipcRenderer.invoke('send-message-with-files', text, filesData),

  // Cambiar modelo activo: 'gemma4' | 'deepseek' | 'sonnet'
  switchModel: (key) => ipcRenderer.invoke('switch-model', key),

  // Iniciar nueva sesión (equivalente a /new)
  newSession: () => ipcRenderer.send('new-session'),

  // Iniciar/reiniciar el gateway
  startGateway: () => ipcRenderer.send('start-gateway'),

  // Notificar al main que el audio terminó
  audioEnded: () => ipcRenderer.send('audio-ended'),

  // Control de ventana frameless
  minimize: () => ipcRenderer.send('window-minimize'),
  close:    () => ipcRenderer.send('window-close'),

  // ── Listeners ─────────────────────────────────────────────────────────────

  // Cambios de estado del orbe
  onState: (cb) => ipcRenderer.on('state-change', (_e, data) => cb(data)),

  // Audio para reproducir
  onAudio: (cb) => ipcRenderer.on('play-audio', (_e, data) => cb(data)),

  // Estado de conexión al gateway (boolean)
  onGatewayStatus: (cb) => ipcRenderer.on('gateway-connected', (_e, connected) => cb(connected)),

  // Mensajes de estado del proceso gateway (string)
  onGatewayMsg: (cb) => ipcRenderer.on('gateway-status-msg', (_e, msg) => cb(msg)),

  // Líneas de log del proceso gateway { line, type: 'stdout'|'stderr'|'info' }
  onGatewayLog: (cb) => ipcRenderer.on('gateway-log', (_e, data) => cb(data)),

  // Mensaje de chat { role: 'user'|'assistant', text }
  onChatMessage: (cb) => ipcRenderer.on('chat-message', (_e, data) => cb(data)),

  // Limpiar historial de chat (nueva sesión)
  onClearChat: (cb) => ipcRenderer.on('clear-chat', (_e) => cb()),

  // Modelo activo cambiado: 'gemma4' | 'deepseek' | 'sonnet'
  onModelChanged: (cb) => ipcRenderer.on('model-changed', (_e, key) => cb(key)),

  // Conectividad a internet { online: boolean }
  onConnectivity: (cb) => ipcRenderer.on('connectivity-changed', (_e, data) => cb(data)),

  // Transcribir audio con Groq Whisper (ArrayBuffer → string)
  transcribeAudio: (buf) => ipcRenderer.invoke('transcribe-audio', buf),

  // Protocolo Daddy's Home (2 palmadas detectadas)
  daddysHome: () => ipcRenderer.send('daddys-home'),

  // Uso de sesión de 5 horas (tokens + costo estimado)
  getSessionUsage: () => ipcRenderer.invoke('get-session-usage'),

  // Nombre del agente (cargado desde config.json)
  getAgentName: () => ipcRenderer.invoke('get-agent-name'),
})
