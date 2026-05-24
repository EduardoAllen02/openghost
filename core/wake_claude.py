"""
wake_claude.py — Invoca Claude Code CLI y captura la respuesta.

Usa --output-format stream-json para recibir eventos estructurados en tiempo real
(tool_use, thinking, result) en lugar de depender de stderr.
"""

import json
import subprocess
import sys
import threading
from datetime import datetime, timezone
from typing import Callable

from core.session_manager import SessionManager


def _now_str() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _format_tool_input(name: str, inp: dict) -> str:
    if name in ("Read", "Write", "Edit", "NotebookEdit"):
        p = inp.get("file_path") or inp.get("notebook_path") or ""
        return p.replace("\\", "/").split("/")[-1] or p
    if name == "Bash":
        return (inp.get("command") or "")[:80].replace("\n", " ")
    if name in ("WebFetch",):
        return (inp.get("url") or "")[:80]
    if name in ("WebSearch",):
        return inp.get("query") or ""
    if name in ("Glob", "Grep"):
        return inp.get("pattern") or inp.get("glob") or ""
    if name == "TodoWrite":
        return f"{len(inp.get('todos', []))} todo(s)"
    return ""


class WakeClaude:
    def __init__(self, config: dict, session_mgr: SessionManager):
        self.claude_cmd = config.get("claude", {}).get("command", "claude")
        self.timeout = config.get("claude", {}).get("timeout_seconds", 480)
        self.workspace_dir = config.get("workspace_dir", ".")
        self.session_mgr = session_mgr
        self._current_proc: subprocess.Popen | None = None
        self._proc_lock = threading.Lock()

    def kill_current(self) -> bool:
        with self._proc_lock:
            if self._current_proc and self._current_proc.poll() is None:
                self._current_proc.kill()
                return True
        return False

    def invoke(self, prompt: str, on_log: Callable[[str], None] | None = None,
               force_new_session: bool = False) -> str:
        """
        Invoca Claude Code con el prompt dado.
        Decide automáticamente --continue vs nueva sesión.
        Emite eventos de herramientas y thinking via on_log en tiempo real.
        Retorna el texto de respuesta final.
        """
        if self.session_mgr.is_locked():
            raise RuntimeError("Claude ya está corriendo (lock activo).")

        new_session = force_new_session or self.session_mgr.is_new_session()
        mode = "nueva sesión" if new_session else "continuar sesión"

        base = [self.claude_cmd, "--dangerously-skip-permissions",
                "--verbose", "--output-format", "stream-json"]
        if new_session:
            cmd = base + ["-p", prompt]
        else:
            cmd = base + ["--continue", "-p", prompt]

        self.session_mgr.acquire_lock()
        self.session_mgr.register_session()
        print(f"[{_now_str()}] Claude invocado ({mode})", flush=True)

        if on_log:
            on_log(f"[session] {mode}")

        try:
            extra = {}
            if sys.platform == "win32":
                extra["creationflags"] = subprocess.CREATE_NO_WINDOW
            proc = subprocess.Popen(
                cmd,
                cwd=self.workspace_dir,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                encoding="utf-8",
                errors="replace",
                **extra,
            )
            with self._proc_lock:
                self._current_proc = proc

            final_response: list[str] = [""]

            def _read_stdout():
                for raw in proc.stdout:
                    raw = raw.strip()
                    if not raw:
                        continue
                    try:
                        event = json.loads(raw)
                    except json.JSONDecodeError:
                        continue
                    evt_type = event.get("type")
                    if evt_type == "assistant" and on_log:
                        for block in event.get("message", {}).get("content", []):
                            bt = block.get("type")
                            if bt == "thinking":
                                preview = block.get("thinking", "")[:200].replace("\n", " ")
                                if preview:
                                    on_log(f"[thinking] {preview}")
                            elif bt == "tool_use":
                                name = block.get("name", "?")
                                detail = _format_tool_input(name, block.get("input", {}))
                                on_log(f"→ {name}" + (f": {detail}" if detail else ""))
                    elif evt_type == "result":
                        final_response[0] = event.get("result", "")

            def _discard_stderr():
                for _ in proc.stderr:
                    pass

            t_out = threading.Thread(target=_read_stdout, daemon=True)
            t_err = threading.Thread(target=_discard_stderr, daemon=True)
            t_out.start()
            t_err.start()

            try:
                proc.wait(timeout=self.timeout)
            except subprocess.TimeoutExpired:
                proc.kill()
                raise RuntimeError(f"Claude no respondió en {self.timeout}s.")
            finally:
                t_err.join(timeout=3)
                t_out.join(timeout=3)

            if proc.returncode not in (0, -9, -15):
                print(f"[{_now_str()}] Claude returncode={proc.returncode}", flush=True)

            return final_response[0]

        except FileNotFoundError:
            raise RuntimeError(
                f"Comando '{self.claude_cmd}' no encontrado. "
                "Verifica que Claude Code CLI está instalado y en el PATH."
            )
        finally:
            with self._proc_lock:
                self._current_proc = None
            self.session_mgr.release_lock()
