# Sistema de Skills

## Qué es un Skill

Un skill es una capacidad modular que Claude puede usar.
Vive en el workspace del cliente (no en el motor), por lo que viaja con el cliente.

Cada skill = una carpeta con:
- `SKILL.md` — instrucciones de uso para Claude (el archivo más importante)
- Scripts o herramientas de soporte (opcionales)

Claude descubre los skills leyendo `SKILLS.md` (el índice) y luego
`skills/[nombre]/SKILL.md` cuando necesita usar uno.

## Estructura de un Skill

```
skills/
└── mi-skill/
    ├── SKILL.md          # Instrucciones para Claude (obligatorio)
    ├── server.py         # Script de soporte (opcional)
    └── config.json       # Config del skill (opcional)
```

## Crear un Nuevo Skill

### 1. Crear la carpeta

```bash
mkdir workspace/skills/mi-skill
```

### 2. Escribir `SKILL.md`

El archivo debe responder:
- ¿Cuándo usar este skill?
- ¿Cómo se activa? (¿hay un servidor que arrancar? ¿comandos CLI?)
- ¿Qué comandos o llamadas están disponibles?
- ¿Qué considerar en cuanto a seguridad o límites?

### 3. Agregar herramientas de soporte (si aplica)

Scripts Python, servidores locales, wrappers de CLI — lo que el skill necesite.

### 4. Actualizar `SKILLS.md`

Agregar una entrada al índice para que Claude sepa que existe.

## Skills Incluidos

### browser

Control de Google Chrome vía CDP (Chrome DevTools Protocol).

**Capabilities:**
- Navegar URLs
- Leer HTML y texto de páginas
- Ejecutar JavaScript en consola
- Interactuar con formularios (login, click, tipo)
- Tomar screenshots

**Cómo funciona:**
1. `browser_server.py` lanza Chrome con `--remote-debugging-port=9222`
2. Claude usa comandos CDP para controlar el navegador
3. Toda la automatización es headless-optional (el usuario puede ver el Chrome)

### gog

Google Workspace CLI. Accede a Gmail, Calendar, Drive, Contacts, Sheets, Docs.

**Prerequisito:** GOG instalado (viene con OpenClaw).

**Capabilities:**
- Buscar, leer y enviar correos (Gmail)
- Listar y crear eventos (Calendar)
- Buscar archivos (Drive)
- Leer y escribir celdas (Sheets)
- Exportar documentos (Docs)

## Agregar Skills de OpenClaw

OpenClaw tiene 52+ skills disponibles. Para agregar uno:

1. Encontrar el skill en `C:\Users\Yeyian PC\.openclaw\sandboxes\agent-main-*/skills/`
2. Copiar la carpeta del skill a `workspace/skills/`
3. Adaptar `SKILL.md` si usa herramientas específicas de OpenClaw que no aplican
4. Actualizar `workspace/SKILLS.md`

## Skills Futuros Planificados

| Skill | Descripción |
|-------|-------------|
| `notion` | Leer y escribir en Notion |
| `github` | PRs, issues, commits |
| `spotify` | Control del reproductor |
| `trading` | Integración con el trading-agent existente |
