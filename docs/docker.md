# Deploy con Docker

## Cuándo Usar Docker

Para clientes que necesiten:
- Aislar el agente del sistema operativo host
- Deploy en servidor (VPS, cloud) sin GUI
- Múltiples instancias aisladas en el mismo servidor
- Entorno reproducible y portable

En uso personal (tu propia PC), Docker es opcional.
La instalación directa es más simple y eficiente.

## Prerequisitos en la imagen

- Python 3.12
- Node.js 22+ (para Claude Code CLI)
- Claude Code CLI: `npm install -g @anthropic-ai/claude-code`
- Permisos pre-configurados en `/root/.claude/settings.json`

## Build y Run

```bash
# Build
docker build -t openghost .

# Run con docker-compose
docker-compose up -d

# Ver logs
docker-compose logs -f daemon
```

## docker-compose.yml

```yaml
services:
  daemon:
    build: .
    restart: unless-stopped
    ports:
      - "127.0.0.1:8787:8787"  # Solo local — no exponer al exterior
      - "127.0.0.1:5052:5052"  # TTS proxy
    volumes:
      - ./workspace:/openghost/workspace       # Identidad y memoria del cliente
      - ./state:/openghost/state               # Estado runtime
      - ./.env:/openghost/.env:ro              # API keys
      - ./config.json:/openghost/config.json:ro
    environment:
      - PYTHONUNBUFFERED=1
```

## Diferencia clave: permisos en Docker

En local usamos `--dangerously-skip-permissions` para evitar prompts.
En Docker, configuramos los permisos vía `settings.json` que se copia en la imagen:

```json
{
  "permissions": {
    "allow": [
      "Bash(*)",
      "Read(*)",
      "Edit(*)",
      "Write(*)",
      "WebSearch",
      "WebFetch(*)"
    ]
  }
}
```

Esto equivale a `--dangerously-skip-permissions` pero de forma declarativa y
sin necesitar el flag en cada invocación.

El `Dockerfile` copia este archivo:
```dockerfile
COPY settings.claude.json /root/.claude/settings.json
```

## Variables de Entorno en Producción

Nunca pasar API keys como variables de entorno en el `docker-compose.yml`.
Usar un archivo `.env` montado como volumen read-only:

```bash
# .env NO debe estar en el repo (está en .gitignore)
cp .env.example .env
# Llenar con las keys reales
```

## Workspace en Docker

El workspace (identidad + memoria del cliente) se monta como volumen
para que persista entre reinicios y actualizaciones del contenedor:

```
./workspace  →  /openghost/workspace
```

Esto significa que `config.json` dentro del contenedor debe apuntar a `/openghost/workspace`.

## Sin GUI en Docker

El orbe de voz (Electron) no puede correr en Docker sin display virtual.
En deploy dockerizado, el agente se comunica solo vía Telegram y HTTP API.
El orbe siempre corre en la máquina local del usuario.
