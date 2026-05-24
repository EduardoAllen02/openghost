@echo off
:: Inicia el Electron Orb de Lucy PC
cd /d "%~dp0"

:: Instalar dependencias si node_modules no existe
if not exist "node_modules" (
    echo Instalando dependencias npm...
    npm install
)

echo Iniciando Lucy Orb...
set ELECTRON_RUN_AS_NODE=
npm start
