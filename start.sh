#!/usr/bin/env bash
set -euo pipefail

echo ""
echo " OpenGhost"
echo " ========="
echo ""

# Verificar Python
if ! command -v python3 &>/dev/null; then
    echo "ERROR: Python3 no encontrado."
    exit 1
fi

# Verificar Claude Code CLI
if ! command -v claude &>/dev/null; then
    echo "ERROR: Claude Code CLI no encontrado."
    echo "Instala con: npm install -g @anthropic-ai/claude-code"
    exit 1
fi

# Verificar .env
if [ ! -f ".env" ]; then
    echo "AVISO: .env no encontrado. Creando desde .env.example..."
    cp .env.example .env
    echo "Edita .env con tus API keys y vuelve a ejecutar."
    exit 1
fi

# Crear directorio de estado
mkdir -p state

# Instalar dependencias si hace falta
if ! python3 -c "import flask" &>/dev/null; then
    echo "Instalando dependencias..."
    pip3 install -r requirements.txt -q
fi

echo "Daemon: http://127.0.0.1:8787"
echo "Iniciando OpenGhost... (Ctrl+C para detener)"
echo ""

python3 core/daemon.py
