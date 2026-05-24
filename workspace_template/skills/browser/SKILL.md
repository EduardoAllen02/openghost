# SKILL: browser

Control de Google Chrome vía CDP (Chrome DevTools Protocol).

## Cuándo Usar

- Navegar y leer contenido de páginas web
- Hacer login en cuentas del usuario
- Ejecutar JavaScript en el contexto de una página
- Interactuar con elementos del DOM
- Tomar screenshots de páginas
- Automatizar tareas repetitivas en el navegador

## Cómo Usar

1. Inicia el servidor CDP ejecutando el script:
   ```
   python skills/browser/browser_server.py
   ```
   El servidor escucha en `http://localhost:9222` (puerto CDP de Chrome).

2. Verifica que Chrome está abierto con el puerto CDP habilitado.
   Si no está corriendo, el script intenta iniciarlo.

3. Usa las herramientas disponibles vía CDP:
   - `navigate(url)` — navegar a una URL
   - `get_html()` — obtener el HTML de la página actual
   - `evaluate(script)` — ejecutar JavaScript
   - `click(selector)` — hacer click en un elemento CSS
   - `type(selector, text)` — escribir texto en un campo
   - `screenshot()` — capturar la página

## Consideraciones de Seguridad

- Confirma antes de hacer login con credenciales nuevas
- No guardes contraseñas en archivos del workspace
- Si el usuario tiene sesiones activas, úsalas directamente (no re-login)
- Cierra el servidor CDP cuando no se use

## Troubleshooting

Si Chrome no conecta:
1. Verifica que Chrome está instalado: `where chrome` (Windows)
2. El perfil de usuario de Chrome tiene que estar disponible
3. Revisa si hay otro proceso ocupando el puerto 9222
