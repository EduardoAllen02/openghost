# Manejo de Sesiones

## Una Sesión por Día

OpenGhost mantiene una sesión de Claude Code por día calendario (UTC).

- **Primer mensaje del día**: `claude --dangerously-skip-permissions -p "prompt"`
  Claude lee AGENTS.md, construye su contexto, responde.

- **Mensajes siguientes del mismo día**: `claude --dangerously-skip-permissions --continue -p "prompt"`
  Claude continúa la conversación sin re-leer todo desde cero.

- **Día siguiente**: nueva sesión automáticamente. El daily log del día anterior
  provee continuidad narrativa.

## Archivos de Estado (`state/`)

| Archivo | Contenido | Propósito |
|---------|-----------|-----------|
| `.session_date` | `YYYY-MM-DD` (UTC) | Decide --continue vs nueva sesión |
| `.claude_lock` | Timestamp ISO8601 | Previene invocaciones concurrentes |
| `session_registry.json` | `{date: {date, distilled}}` | Para cleanup automático |

Estos archivos están en `state/` (gitignored). Se crean automáticamente.

## Lock File Anti-Concurrencia

Claude puede tardar hasta 8 minutos en responder. Si llega un segundo mensaje
mientras Claude procesa el primero, el daemon retorna HTTP 503.

```
TTL del lock: 600 segundos
Si el lock tiene más de 600s: se considera stale y se elimina automáticamente
```

El lock file contiene el timestamp de cuando se adquirió, para calcular la edad.

## Forzar Nueva Sesión

Desde Telegram:
```
/new
```

Vía HTTP (desde el orbe):
```bash
curl -X POST http://localhost:8787/session/new \
  -H "X-Ghost-Token: tu-token"
```

Esto borra `.session_date` para que el próximo mensaje abra sesión nueva.

## Cleanup de Sesiones Antiguas

Claude Code almacena el historial de conversaciones localmente.
Para no acumular sesiones indefinidamente, OpenGhost hace cleanup automático.

**Configuración** en `config.json`:
```json
{
  "daemon": {
    "session_timeout_days": 15
  }
}
```

**Proceso de cleanup** (pendiente de implementar como tarea periódica):
1. `session_manager.sessions_to_cleanup()` retorna fechas > 15 días no destiladas
2. Para cada fecha: invocar Claude con prompt de distilación:
   ```
   Destila la sesión del YYYY-MM-DD en MEMORY.md.
   Extrae lo que vale recordar a largo plazo.
   Cuando termines, confirma con "DESTILADO: YYYY-MM-DD".
   ```
3. `session_manager.mark_distilled(date)` marca como destilada
4. Eliminar del historial de Claude: `claude sessions delete {id}` (si aplica)

## Forçar Nueva Sesión Programáticamente

```python
from core.session_manager import SessionManager
mgr = SessionManager(config, state_dir)
mgr.force_new_session()
```
