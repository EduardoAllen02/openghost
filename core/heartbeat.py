"""
heartbeat.py — Scheduler autónomo de heartbeat.

Lee {workspace_dir}/heartbeat.md cada interval_minutes.
Si tiene contenido → invoca Claude. Si está vacío → no hace nada (costo cero).
"""

import threading
from datetime import datetime, timezone
from pathlib import Path


class HeartbeatScheduler:
    def __init__(self, config: dict, wake, claude_lock: threading.Lock,
                 publish_log, context_builder):
        hb_cfg = config.get("heartbeat", {})
        self.interval = hb_cfg.get("interval_minutes", 30) * 60
        self.workspace_dir = config.get("workspace_dir", ".")
        self.heartbeat_file = Path(self.workspace_dir) / "heartbeat.md"
        self.wake = wake
        self.claude_lock = claude_lock
        self.publish_log = publish_log
        self.context_builder = context_builder
        self._timer: threading.Timer | None = None

    def start(self):
        self._schedule()
        mins = int(self.interval // 60)
        self.publish_log(f"[heartbeat] Scheduler activo — cada {mins} min")

    def stop(self):
        if self._timer:
            self._timer.cancel()

    def _schedule(self):
        self._timer = threading.Timer(self.interval, self._tick)
        self._timer.daemon = True
        self._timer.start()

    def _tick(self):
        try:
            self._run()
        finally:
            self._schedule()

    def _run(self):
        if not self.heartbeat_file.exists():
            return

        content = self.heartbeat_file.read_text(encoding="utf-8").strip()
        if not content:
            return

        meaningful = [l for l in content.splitlines()
                      if l.strip() and not l.startswith("#") and l.strip() != "---"]
        if not meaningful:
            return

        if not self.claude_lock.acquire(blocking=False):
            self.publish_log("[heartbeat] Claude ocupado, saltando ciclo")
            return

        ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        self.publish_log(f"[heartbeat] Ejecutando ciclo {ts}")
        try:
            prompt = self.context_builder.build_heartbeat(content)
            self.wake.invoke(prompt, on_log=self.publish_log)
        except Exception as e:
            self.publish_log(f"[heartbeat] Error: {e}")
        finally:
            self.claude_lock.release()
