# Arquitectura de OpenGhost

## Visión General

```
Usuario
  │
  ├── Telegram ──────────────────┐
  └── Orbe de Voz (Electron) ────┤
                                  ▼
                          [daemon.py :8787]
                          Flask HTTP server
                          + Telegram bot thread
                                  │
                          AllowList check
                                  │
                          context_builder.py
                          (anti-injection + workspace ref + mensaje)
                                  │
                          session_manager.py
                          (lock? → 503 | new/continue?)
                                  │
                          wake_claude.py
                          subprocess: claude --dangerously-skip-permissions [-p | --continue -p]
                          cwd: workspace_dir
                                  │
                          Claude Code CLI
                          Lee AGENTS.md → SOUL/IDENTITY/USER/MEMORY → actúa
                                  │
                          stdout capturado
                          ContextBuilder.parse_response()
                          (separa texto de [[tts:text]]tags)
                                  │
                    ┌─────────────┴─────────────┐
                    │                           │
              texto al canal              audio_text
              (Telegram reply /         → tts-proxy :5052
               HTTP response /          → Fish/OpenAI/ElevenLabs
               orbe chat)               → MP3 → orbe reproduce
```

## Componentes

### daemon.py — El Orquestador

- Flask HTTP server en `127.0.0.1:8787`
- `POST /message` — recibe mensaje, bloquea hasta respuesta de Claude, retorna JSON
- `GET /status` — estado actual (locked, session_date, workspace)
- `POST /session/new` — fuerza nueva sesión (borra `.session_date`)
- Integra el bot de Telegram en un thread background (si está habilitado)
- Lanza el TTS proxy como proceso hijo (si está habilitado)

**Un mensaje a la vez**: `threading.Lock()` previene invocaciones concurrentes de Claude.
Si Claude está ocupado, `/message` retorna HTTP 503.

### session_manager.py — Control de Sesiones

Adaptado del patrón del `trading-agent`. Maneja tres archivos en `state/`:

| Archivo | Propósito |
|---------|-----------|
| `.session_date` | Fecha de la sesión activa (YYYY-MM-DD) |
| `.claude_lock` | Lock TTL 600s anti-concurrencia |
| `session_registry.json` | Registro de sesiones para cleanup |

**Lógica de sesión:**
- Si `.session_date` tiene la fecha de hoy → `claude --continue -p`
- Si no (nuevo día o archivo ausente) → `claude -p` (sesión nueva) + marcar hoy

### wake_claude.py — Invocador de Claude

```python
cmd = ["claude", "--dangerously-skip-permissions", "--continue", "-p", prompt]
result = subprocess.run(cmd, cwd=workspace_dir, timeout=480,
                        capture_output=True, text=True)
return result.stdout.strip()
```

- `cwd` = workspace del cliente (Claude lee AGENTS.md directamente)
- Respuesta en `stdout` (modo `-p` = non-interactive/print)
- Timeout 480s (8 minutos)

### context_builder.py — Ingeniería de Contexto

El prompt tiene estructura fija:
```
[SISTEMA - OpenGhost | timestamp | canal]
Anti-injection declaration.

[WORKSPACE]
/ruta/al/workspace
Lee AGENTS.md para instrucciones de arranque de sesión.

[MENSAJE]
texto del usuario

[CONTEXTO]   ← opcional
estado relevante
```

AGENTS.md en el workspace hace el resto: le dice a Claude qué leer y en qué orden.

### tts-proxy/proxy.py — Proxy TTS Flexible

Flask server en puerto 5052. Expone endpoints OpenAI-compatibles:
- `POST /v1/audio/speech` — sintetiza texto
- `GET /health` — estado del proxy

El provider se selecciona en `config.json → tts.provider`:
- `fish` → Fish Audio API
- `openai` → OpenAI TTS (o proxy compatible)
- `elevenlabs` → ElevenLabs API

## El Archivo Primordial: workspace/AGENTS.md

El documento más importante del sistema. Se carga en cada sesión de Claude.
Define quién es el agente, qué leer al arrancar, protocolo anti-injection,
y reglas de operación.

Claude no recibe el contenido de SOUL/IDENTITY/USER directamente en el prompt —
los lee él mismo, solo cuando necesita, guiado por AGENTS.md.
Esto evita tokens masivos y mantiene el contexto liviano.

Ver [context-engineering.md](context-engineering.md) para el diseño completo.

## Repos: Motor vs Workspace

```
OpenGhost/ (motor)                   openghost-workspace/ (cliente)
├── core/                            ├── AGENTS.md  ← primordial
├── channels/                        ├── SOUL.md
├── tts-proxy/                       ├── IDENTITY.md
├── workspace_template/  ────────►  ├── USER.md
│   (bootstrap de nuevos clientes)  ├── MEMORY.md
└── config.json  ─────────────────► ├── SKILLS.md
    workspace_dir apunta aquí        ├── skills/
                                     │   ├── browser/
                                     │   └── gog/
                                     └── memory/
                                         └── YYYY-MM-DD.md
```

El motor no importa nada del workspace en tiempo de código.
La relación es puramente de configuración (`config.json → workspace_dir`)
y de archivos (Claude lee el workspace directamente desde el filesystem).
