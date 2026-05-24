"""
launcher.py — Servidor siempre activo en la PC.

Al arrancar Windows (vía startup folder):
  1. Espera 8 segundos a que la red y el escritorio estén listos
  2. Lanza daemon.py (Lucy) con ventana de consola visible
  3. Espera hasta 30s a que Lucy responda en :8787
  4. Lanza el Orbe Electron (sin consola extra)

Escucha en :8788:
  POST /start  → lanza Lucy + Orbe si no están activos
  GET  /health → estado de Lucy (:8787)
"""

import socket
import subprocess
import sys
import threading
import time
from pathlib import Path

from flask import Flask, jsonify

GHOST_DIR = Path(__file__).parent.parent.parent
DAEMON_PY = GHOST_DIR / "core" / "daemon.py"
ORB_DIR   = GHOST_DIR / "channels" / "orb"
PORT      = 8788

# npm.cmd en Windows — fallback a "npm" si no está en la ruta exacta
_NPM_PATHS = [
    r"C:\Program Files\nodejs\npm.cmd",
    r"C:\Users\Yeyian PC\AppData\Roaming\npm\npm.cmd",
    "npm",
]

app = Flask(__name__)
_daemon_proc = None
_orb_proc    = None
_lock        = threading.Lock()


def _port_open(port: int, timeout: float = 1.0) -> bool:
    try:
        s = socket.create_connection(("127.0.0.1", port), timeout=timeout)
        s.close()
        return True
    except OSError:
        return False


def _daemon_running() -> bool:
    return _port_open(8787)


def _find_npm() -> str:
    for p in _NPM_PATHS:
        if p == "npm" or Path(p).exists():
            return p
    return "npm"


def _launch_daemon():
    global _daemon_proc
    if _daemon_running():
        print("[launcher] Lucy ya activa.", flush=True)
        return
    print("[launcher] Iniciando Lucy (daemon)...", flush=True)
    _daemon_proc = subprocess.Popen(
        [sys.executable, str(DAEMON_PY)],
        cwd=str(GHOST_DIR),
        creationflags=subprocess.CREATE_NEW_CONSOLE,
    )
    print(f"[launcher] Lucy PID={_daemon_proc.pid}", flush=True)


def _launch_orb():
    global _orb_proc
    print("[launcher] Esperando que Lucy esté lista...", flush=True)
    for _ in range(30):
        if _daemon_running():
            break
        time.sleep(1)
    else:
        print("[launcher] Lucy no respondió en 30s — Orbe no iniciado.", flush=True)
        return

    print("[launcher] Iniciando Orbe...", flush=True)
    _orb_proc = subprocess.Popen(
        [_find_npm(), "start"],
        cwd=str(ORB_DIR),
        creationflags=subprocess.CREATE_NO_WINDOW,
    )
    print(f"[launcher] Orbe PID={_orb_proc.pid}", flush=True)


def _autostart():
    time.sleep(8)  # dar tiempo al escritorio y la red
    with _lock:
        _launch_daemon()
    _launch_orb()


# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.route("/start", methods=["POST"])
def start_daemon():
    with _lock:
        if _daemon_running():
            return jsonify({"ok": True, "msg": "Lucy ya estaba activa."})
        _launch_daemon()
    threading.Thread(target=_launch_orb, daemon=True).start()
    pid = _daemon_proc.pid if _daemon_proc else None
    return jsonify({"ok": True, "msg": "Lucy iniciando...", "pid": pid})


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"ok": True, "lucy": _daemon_running()})


if __name__ == "__main__":
    print(f"[launcher] Escuchando en http://0.0.0.0:{PORT}", flush=True)
    threading.Thread(target=_autostart, daemon=True).start()
    app.run(host="0.0.0.0", port=PORT, use_reloader=False)
