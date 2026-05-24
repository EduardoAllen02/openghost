FROM python:3.12-slim

# Node.js + npm (para Claude Code CLI)
RUN apt-get update && apt-get install -y --no-install-recommends \
    nodejs npm curl \
    && rm -rf /var/lib/apt/lists/*

# Claude Code CLI
RUN npm install -g @anthropic-ai/claude-code

# Permisos pre-configurados (equivale a --dangerously-skip-permissions pero declarativo)
RUN mkdir -p /root/.claude
COPY settings.claude.json /root/.claude/settings.json

WORKDIR /openghost

# Dependencias Python
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Código fuente
COPY core/ core/
COPY channels/ channels/
COPY tts-proxy/ tts-proxy/
COPY workspace_template/ workspace_template/

# Config (se puede sobreescribir con volumen)
COPY config.json .

# Volúmenes esperados en runtime:
# /openghost/workspace   → workspace del cliente (identidad + memoria + skills)
# /openghost/state       → estado runtime (sesión, lock, registry)
# /openghost/.env        → API keys
# /openghost/config.json → configuración (opcional, si se quiere sobreescribir)

EXPOSE 8787
EXPOSE 5052

CMD ["python", "core/daemon.py"]
