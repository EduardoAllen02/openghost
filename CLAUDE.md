# CLAUDE.md — Contexto para el Claude Constructor de OpenGhost

Este archivo se carga automáticamente cada vez que abres este proyecto con Claude Code.
Da el contexto completo del sistema para que puedas trabajar en cualquier feature sin necesitar
el historial de conversaciones anteriores.

## Qué es OpenGhost

Framework de agente autónomo que usa **Claude Code CLI** como motor de razonamiento.
Reemplaza la dependencia de OpenClaw/gateway/ollama con invocaciones directas de
`claude --dangerously-skip-permissions`. Es un template neutro (sin soul/identity predefinida)
para que cada instancia/cliente lo configure.

## Dos Repositorios

| Repo | Qué es | Ruta |
|------|--------|------|
| `OpenGhost/` | **Motor** — este repo | `C:\Users\Yeyian PC\Documents\VSCodeProjects\OpenGhost` |
| `openghost-workspace/` | **Cliente** — identidad, memoria, skills | `C:\Users\Yeyian PC\Documents\VSCodeProjects\openghost-workspace` |

El motor no sabe nada del cliente. `config.json` apunta al workspace del cliente.
Para un nuevo cliente: clonar OpenGhost + crear workspace desde `workspace_template/` + actualizar `config.json`.

## Estructura del Motor

```
OpenGhost/
├── config.json              # Config principal (apunta al workspace, habilita canales)
├── .env                     # API keys (gitignored)
├── requirements.txt
│
├── core/
│   ├── daemon.py            # Flask HTTP :8787 + integración Telegram + loop
│   ├── wake_claude.py       # subprocess Claude Code CLI, captura stdout
│   ├── session_manager.py   # lock, --new vs --continue, session_registry, cleanup
│   └── context_builder.py   # construye prompt y parsea respuesta (TTS tags)
│
├── channels/
│   └── telegram/
│       └── allowlist.json   # IDs autorizados de Telegram
│
├── tts-proxy/
│   └── proxy.py             # Flask TTS proxy: Fish/OpenAI/ElevenLabs intercambiable
│
├── workspace_template/      # Template para bootstrapear un nuevo cliente
│   ├── AGENTS.md            # Archivo primordial (startup de cada sesión de Claude)
│   ├── SOUL.md / IDENTITY.md / USER.md / MEMORY.md / SKILLS.md
│   ├── skills/browser/      # CDP browser automation
│   └── skills/gog/          # Google Workspace
│
└── docs/                    # Documentación técnica
```

## Decisiones de Diseño Críticas

1. **Claude como subprocess**: `subprocess.run(["claude", "--dangerously-skip-permissions", "-p", prompt])`
   con `capture_output=True, text=True`. La respuesta está en `result.stdout`.

2. **Una sesión por día**: `state/.session_date` controla `--continue` vs nueva sesión.
   `is_new_session()` en `session_manager.py` lo decide.

3. **Lock file TTL 600s**: `state/.claude_lock` previene invocaciones concurrentes.
   Stale locks se eliminan automáticamente.

4. **cwd = workspace_dir**: Claude abre en el directorio del workspace del cliente.
   Desde ahí lee AGENTS.md directamente y navega al dispositivo con rutas absolutas.

5. **Skills en el workspace**: No en el motor. El motor no sabe qué skills hay.
   Claude los descubre leyendo `SKILLS.md` del workspace.

6. **TTS tags en respuesta**: `[[tts:text]]...[/tts:text]]` en la respuesta de Claude.
   `ContextBuilder.parse_response()` las extrae.

7. **AllowList estricta**: Telegram requiere user_id en `allowlist.json`.
   HTTP endpoint requiere `X-Ghost-Token` header si `ORB_TOKEN` está configurado.

## Archivos de Referencia (proyectos anteriores)

Estos proyectos fueron la base de OpenGhost. Léelos si necesitas entender el origen de algún patrón:

- **Sesiones Claude**: `C:\Users\Yeyian PC\Documents\VSCodeProjects\trading-agent\live\scripts\wake_claude.py`
- **Daemon/loop**: `C:\Users\Yeyian PC\Documents\VSCodeProjects\trading-agent\live\scripts\monitor.py`
- **Orbe Electron**: `C:\Users\Yeyian PC\Documents\lucy-orb\main.js`
- **TTS proxy (Fish)**: `C:\Users\Yeyian PC\Documents\lucy-pc-workspace\tts-proxy\fish_tts_proxy.py`
- **AGENTS.md patrón**: `C:\Users\Yeyian PC\Documents\lucy-workspace\AGENTS.md`
- **Configuración OpenClaw**: `C:\Users\Yeyian PC\.openclaw\openclaw.json`

## Stack

| Componente | Tecnología |
|---|---|
| Daemon / core | Python 3.12, Flask, python-telegram-bot |
| TTS Proxy | Python 3.12, Flask |
| Orbe de voz | Node.js, Electron 36, Three.js |
| Claude | `claude` CLI vía subprocess |
| STT | Groq Whisper (en el orbe) |

## Cómo Arrancar (desarrollo)

```bash
# 1. Instalar dependencias
pip install -r requirements.txt

# 2. Copiar y llenar variables de entorno
cp .env.example .env

# 3. Asegurarse de que workspace_dir en config.json existe
# (o crear workspace desde template: cp -r workspace_template ../openghost-workspace)

# 4. Lanzar daemon
python core/daemon.py

# 5. Probar
curl -X POST http://localhost:8787/message -H "Content-Type: application/json" -d '{"text":"hola"}'
```

## Convenciones de Código

- Sin comentarios descriptivos (el código se explica solo)
- Errores explícitos, sin silent failures
- Estado en archivos, no en memoria de proceso
- Config en `config.json`, secrets en `.env`
- No agregar features sin pedirlas — solo lo necesario para la tarea

## Estado Actual del Proyecto

- [x] Fase 1: Core + workspace_template
- [x] Fase 2: Telegram (integrado en daemon.py)
- [x] Fase 4: TTS proxy (Fish/OpenAI/ElevenLabs)
- [ ] Fase 3: Orbe de voz (pendiente — clonar lucy-orb y adaptar)
- [ ] Fase 7: Docker + session cleanup automático
- [ ] Workspace cliente (openghost-workspace/) — pendiente de inicializar

## Próximas Tareas Conocidas

1. **Clonar orbe**: copiar `C:\Users\Yeyian PC\Documents\lucy-orb` → `channels/orb/`,
   adaptar `main.js` para conectar a `http://localhost:8787` en vez del OpenClaw gateway.

2. **Workspace cliente**: crear `C:\Users\Yeyian PC\Documents\VSCodeProjects\openghost-workspace\`
   desde `workspace_template/`, llenar SOUL.md, IDENTITY.md, USER.md.

3. **Session cleanup**: en `session_manager.py` ya existe `sessions_to_cleanup()`.
   Falta la lógica de distilación: invocar Claude con prompt de "destila estas sesiones en MEMORY.md
   y confirma cuando termines".

4. **`start.bat` con setup**: detectar si workspace existe, si no, ofrecerlo inicializar.
