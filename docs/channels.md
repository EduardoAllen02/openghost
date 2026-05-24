# Canales de Comunicación

## HTTP Directo (siempre activo)

El daemon expone una API HTTP local en `127.0.0.1:8787`.
Útil para testing y para la integración con el orbe.

```bash
# Enviar mensaje
curl -X POST http://localhost:8787/message \
  -H "Content-Type: application/json" \
  -H "X-Ghost-Token: tu-token" \
  -d '{"text": "qué hora es?"}'

# Estado del daemon
curl http://localhost:8787/status

# Forzar nueva sesión
curl -X POST http://localhost:8787/session/new \
  -H "X-Ghost-Token: tu-token"
```

**Auth**: si `ORB_TOKEN` está en `.env`, todas las peticiones deben incluir
el header `X-Ghost-Token: <token>`. Si no está configurado, no hay restricción
(solo acceso local 127.0.0.1).

**Respuesta** de `/message`:
```json
{
  "text": "respuesta completa de Claude",
  "has_audio": true,
  "audio_text": "texto que va a TTS"
}
```

## Telegram Bot

### Setup

1. Crear bot con @BotFather en Telegram → obtener token
2. Agregar token en `.env`:
   ```
   TELEGRAM_BOT_TOKEN=123456:ABCdef...
   ```
3. Obtener tu user_id de Telegram (usar @userinfobot)
4. Agregar a `channels/telegram/allowlist.json`:
   ```json
   { "allowed_ids": [123456789] }
   ```
5. Habilitar en `config.json`:
   ```json
   { "channels": { "telegram": { "enabled": true } } }
   ```
6. Reiniciar el daemon

### Comandos Disponibles

| Comando | Acción |
|---------|--------|
| `/start` | Confirma que el bot está activo |
| `/new` | Fuerza nueva sesión de Claude |
| `/status` | Estado actual (locked/libre, fecha de sesión) |
| Cualquier texto | Enviado a Claude, responde en el mismo chat |

### AllowList

Solo los user_id numéricos en `allowlist.json` pueden interactuar con el bot.
Mensajes de IDs no autorizados se descartan silenciosamente.

Para obtener tu ID: escríbele a @userinfobot en Telegram.

### Mensajes de Voz (STT)

El bot puede procesar mensajes de voz si el daemon tiene integración STT.
Actualmente no implementado en el bot — se envían solo los mensajes de texto.

## Orbe de Voz (Electron)

El orbe es una app Electron con un orbe 3D animado + interfaz de voz.
Clonado y adaptado de [lucy-orb](C:\Users\Yeyian PC\Documents\lucy-orb).

### Diferencias vs lucy-orb

| Componente | lucy-orb | OpenGhost orb |
|---|---|---|
| Backend | OpenClaw gateway WS :18790 | HTTP daemon :8787 |
| Auth | Ed25519 device signing | `ORB_TOKEN` en config |
| LLM | ollama/gemma4 → deepseek → sonnet | Claude Code |
| TTS launch | OpenClaw lo inicia | daemon.py lo inicia |
| Identidad | Lucy (hardcoded) | Leer IDENTITY.md del workspace |

### Setup del Orbe (pendiente)

```bash
# Clonar lucy-orb como base
cp -r "C:\Users\Yeyian PC\Documents\lucy-orb" channels/orb

# Adaptar archivos clave:
# - channels/orb/main.js       → cambiar WS openClaw → HTTP fetch :8787
# - channels/orb/config.json   → nuevo schema
# - channels/orb/renderer/orb.js → quitar referencias Lucy hardcoded

cd channels/orb
npm install
npm start
```

Ver [CLAUDE.md](../CLAUDE.md) sección "Próximas Tareas" para el plan detallado.

## Seguridad entre Canales

- Cada canal tiene su propio mecanismo de auth (AllowList para Telegram, token para orbe)
- El daemon valida auth ANTES de construir el contexto o invocar Claude
- Mensajes no autorizados no llegan nunca a Claude
- Si un canal está desactivado en `config.json`, su código simplemente no se inicializa
