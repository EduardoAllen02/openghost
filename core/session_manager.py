"""
session_manager.py — Maneja el ciclo de vida de las sesiones de Claude Code.

Una sesión por día: el primer mensaje del día abre sesión nueva,
los siguientes usan --continue para mantener el contexto.
Lock file TTL 600s previene invocaciones concurrentes.
"""

import json
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path


LOCK_MAX_AGE_SECONDS = 600


class SessionManager:
    def __init__(self, config: dict, state_dir: str):
        self.state_dir = Path(state_dir)
        self.state_dir.mkdir(parents=True, exist_ok=True)
        self.lock_file = self.state_dir / ".claude_lock"
        self.session_date_file = self.state_dir / ".session_date"
        self.registry_file = self.state_dir / "session_registry.json"
        self.timeout_days = config.get("daemon", {}).get("session_timeout_days", 15)

    def _now_utc(self) -> str:
        return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    def _today(self) -> str:
        return datetime.now(timezone.utc).strftime("%Y-%m-%d")

    # ── Lock ──────────────────────────────────────────────────────────────────

    def is_locked(self) -> bool:
        if not self.lock_file.exists():
            return False
        age = datetime.now().timestamp() - self.lock_file.stat().st_mtime
        if age > LOCK_MAX_AGE_SECONDS:
            self._release_lock()
            return False
        return True

    def acquire_lock(self):
        self.lock_file.write_text(self._now_utc())

    def _release_lock(self):
        try:
            self.lock_file.unlink(missing_ok=True)
        except OSError:
            pass

    def release_lock(self):
        self._release_lock()

    # ── Session ───────────────────────────────────────────────────────────────

    def is_new_session(self) -> bool:
        """
        True si hay que abrir sesión nueva (claude sin --continue).
        False si hay sesión activa hoy (usar --continue).

        Como efecto secundario, marca hoy en .session_date cuando detecta nuevo día.
        """
        if not self.session_date_file.exists():
            self._mark_session_today()
            return True

        saved = self.session_date_file.read_text().strip()
        today = self._today()
        if saved != today:
            self._mark_session_today()
            return True

        return False

    def _mark_session_today(self):
        self.session_date_file.write_text(self._today())

    def force_new_session(self):
        """Fuerza que el próximo mensaje abra sesión nueva (comando /new)."""
        self.session_date_file.unlink(missing_ok=True)

    def current_session_date(self) -> str | None:
        if not self.session_date_file.exists():
            return None
        return self.session_date_file.read_text().strip()

    # ── Registry (para cleanup) ───────────────────────────────────────────────

    def register_session(self, date: str | None = None):
        date = date or self._today()
        registry = self._load_registry()
        if date not in registry:
            registry[date] = {"date": date, "distilled": False}
            self._save_registry(registry)

    def _load_registry(self) -> dict:
        if not self.registry_file.exists():
            return {}
        try:
            return json.loads(self.registry_file.read_text())
        except Exception:
            return {}

    def _save_registry(self, registry: dict):
        self.registry_file.write_text(json.dumps(registry, indent=2))

    def sessions_to_cleanup(self) -> list[str]:
        """Retorna fechas de sesiones antiguas no destiladas."""
        cutoff = (
            datetime.now(timezone.utc) - timedelta(days=self.timeout_days)
        ).strftime("%Y-%m-%d")
        registry = self._load_registry()
        return [
            date for date, meta in registry.items()
            if date < cutoff and not meta.get("distilled")
        ]

    def mark_distilled(self, date: str):
        registry = self._load_registry()
        if date in registry:
            registry[date]["distilled"] = True
            self._save_registry(registry)

    def delete_old_session_files(self, workspace_dir: str) -> int:
        """Borra .jsonl de sesiones antiguas en ~/.claude/projects/<workspace>/."""
        encoded = re.sub(r"[:\\/\s]", "-", workspace_dir)
        sessions_dir = Path.home() / ".claude" / "projects" / encoded

        if not sessions_dir.exists():
            return 0

        cutoff_ts = (datetime.now() - timedelta(days=self.timeout_days)).timestamp()
        deleted = 0
        for f in sessions_dir.glob("*.jsonl"):
            try:
                if f.stat().st_mtime < cutoff_ts:
                    f.unlink()
                    deleted += 1
            except OSError:
                pass
        return deleted
