@echo off
setlocal enabledelayedexpansion
title OpenGhost

echo.
echo  OpenGhost
echo  =========
echo.

:: Verificar Python
where python >nul 2>&1
if errorlevel 1 (
    echo ERROR: Python no encontrado. Instala Python 3.12+
    pause & exit /b 1
)

:: Verificar Claude Code CLI
where claude >nul 2>&1
if errorlevel 1 (
    echo ERROR: Claude Code CLI no encontrado.
    echo Instala con: npm install -g @anthropic-ai/claude-code
    pause & exit /b 1
)

:: Verificar .env
if not exist ".env" (
    echo AVISO: .env no encontrado.
    echo Copia .env.example a .env y llena las API keys.
    echo.
    copy .env.example .env >nul
    echo Se creo .env desde .env.example. Editalo antes de continuar.
    pause & exit /b 1
)

:: Leer workspace_dir desde config.json con Python (evita problemas con rutas Windows)
for /f "usebackq delims=" %%a in (`python -c "import json; print(json.load(open('config.json'))['workspace_dir'])"`) do set WS_PATH=%%a

if not exist "%WS_PATH%" (
    echo AVISO: Workspace no encontrado en: %WS_PATH%
    echo.
    set /p INIT="Inicializar workspace desde template? [s/N]: "
    if /i "!INIT!"=="s" (
        xcopy workspace_template "%WS_PATH%" /E /I /Y >nul
        echo Workspace creado en: %WS_PATH%
        echo Llena SOUL.md, IDENTITY.md y USER.md antes de continuar.
        pause & exit /b 0
    ) else (
        echo Configura workspace_dir en config.json y vuelve a intentar.
        pause & exit /b 1
    )
)

:: Crear directorio de estado
if not exist "state" mkdir state

:: Instalar dependencias si hace falta
pip show flask >nul 2>&1
if errorlevel 1 (
    echo Instalando dependencias Python...
    pip install -r requirements.txt -q
)

:: Verificar Node / npm para el orbe
set LAUNCH_ORB=0
if exist "channels\orb\node_modules" (
    where npm >nul 2>&1
    if not errorlevel 1 set LAUNCH_ORB=1
)

echo Workspace: %WS_PATH%
echo Daemon:    http://127.0.0.1:8787
if %LAUNCH_ORB%==1 echo Orbe:      channels\orb\
echo.
echo Iniciando OpenGhost...
echo (Cierra esta ventana para detener el daemon)
echo.

:: Daemon en ventana separada
start "OpenGhost Daemon" cmd /k "python core/daemon.py"

:: Orbe (incluye TTS proxy automaticamente)
if %LAUNCH_ORB%==1 (
    timeout /t 2 /nobreak >nul
    cd channels\orb
    npm start
    cd ..\..
)

pause
