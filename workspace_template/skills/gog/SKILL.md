# SKILL: gog (Google Workspace)

Acceso a Gmail, Google Calendar, Drive, Contacts, Sheets y Docs.

## Prerequisitos

GOG está instalado en el equipo como parte de OpenClaw. Para verificar:
```
gog --version
```

Si no está disponible, consulta la documentación de instalación de OpenClaw.

## Autenticación

GOG usa OAuth. Las credenciales están guardadas en el perfil de OpenClaw.
Si necesita re-autenticación, sigue el flujo OAuth que GOG indique.

## Comandos Disponibles

### Gmail
```bash
gog gmail search "query"          # Buscar correos
gog gmail read <id>                # Leer correo por ID
gog gmail send --to email --subject "asunto" --body "cuerpo"
gog gmail reply <id> --body "respuesta"
gog gmail draft --to email --subject "asunto" --body "cuerpo"
```

### Calendar
```bash
gog calendar list                  # Listar eventos próximos
gog calendar list --days 7         # Próximos 7 días
gog calendar create --title "..." --date "YYYY-MM-DD" --time "HH:MM"
```

### Drive
```bash
gog drive search "query"           # Buscar archivos
gog drive download <id>            # Descargar archivo
```

### Sheets
```bash
gog sheets get <spreadsheet_id> <range>     # Leer celdas
gog sheets update <id> <range> <values>     # Escribir celdas
gog sheets append <id> <range> <values>     # Agregar filas
```

### Docs
```bash
gog docs cat <document_id>         # Leer documento
gog docs export <id> --format txt  # Exportar
```

## Consideraciones

- Confirma antes de enviar correos o crear eventos en nombre del usuario
- Para Gmail personal del usuario: verifica en USER.md si está autorizado
- Los IDs de archivos/correos se obtienen de los comandos de búsqueda
