#!/usr/bin/env python3
"""
browser_server.py — Lanza Chrome con CDP habilitado y expone helpers para Claude.

Uso: python browser_server.py [--port 9222] [--profile default]
"""

import argparse
import json
import os
import subprocess
import sys
import time
import urllib.request

CDP_PORT = 9222
CHROME_CANDIDATES = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    os.path.expandvars(r"%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"),
    "/usr/bin/google-chrome",
    "/usr/bin/chromium-browser",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
]


def find_chrome():
    for path in CHROME_CANDIDATES:
        if os.path.isfile(path):
            return path
    raise FileNotFoundError("Chrome no encontrado. Instala Google Chrome.")


def is_cdp_running(port=CDP_PORT):
    try:
        urllib.request.urlopen(f"http://localhost:{port}/json/version", timeout=2)
        return True
    except Exception:
        return False


def launch_chrome(port=CDP_PORT, profile_dir=None):
    chrome = find_chrome()
    if profile_dir is None:
        profile_dir = os.path.join(os.path.dirname(__file__), ".chrome-profile")
    os.makedirs(profile_dir, exist_ok=True)

    cmd = [
        chrome,
        f"--remote-debugging-port={port}",
        f"--user-data-dir={profile_dir}",
        "--no-first-run",
        "--no-default-browser-check",
    ]
    proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    print(f"Chrome lanzado (PID {proc.pid}), esperando CDP en puerto {port}...")
    for _ in range(10):
        time.sleep(1)
        if is_cdp_running(port):
            print(f"CDP disponible en http://localhost:{port}")
            return proc
    raise RuntimeError(f"Chrome no respondió en el puerto {port} tras 10 segundos.")


def cdp_request(method, params=None, session_id=None, port=CDP_PORT):
    """Envía un comando CDP y retorna la respuesta."""
    import socket
    import threading

    payload = {"id": 1, "method": method, "params": params or {}}
    if session_id:
        payload["sessionId"] = session_id

    tabs_url = f"http://localhost:{port}/json"
    with urllib.request.urlopen(tabs_url, timeout=5) as r:
        tabs = json.loads(r.read())

    if not tabs:
        raise RuntimeError("No hay tabs abiertas en Chrome.")

    ws_url = tabs[0]["webSocketDebuggerUrl"]

    import websocket
    result = {}
    done = threading.Event()

    def on_message(ws, msg):
        data = json.loads(msg)
        if data.get("id") == 1:
            result["data"] = data
            done.set()
            ws.close()

    ws = websocket.WebSocketApp(ws_url, on_message=on_message)
    t = threading.Thread(target=ws.run_forever, daemon=True)
    t.start()
    ws.send(json.dumps(payload))
    done.wait(timeout=15)
    return result.get("data", {})


def navigate(url, port=CDP_PORT):
    return cdp_request("Page.navigate", {"url": url}, port=port)


def get_html(port=CDP_PORT):
    r = cdp_request("Runtime.evaluate", {
        "expression": "document.documentElement.outerHTML",
        "returnByValue": True
    }, port=port)
    return r.get("result", {}).get("result", {}).get("value", "")


def evaluate(script, port=CDP_PORT):
    r = cdp_request("Runtime.evaluate", {
        "expression": script,
        "returnByValue": True,
        "awaitPromise": True
    }, port=port)
    return r.get("result", {}).get("result", {}).get("value")


def screenshot(path="screenshot.png", port=CDP_PORT):
    r = cdp_request("Page.captureScreenshot", {"format": "png"}, port=port)
    data = r.get("result", {}).get("data", "")
    import base64
    with open(path, "wb") as f:
        f.write(base64.b64decode(data))
    print(f"Screenshot guardado: {path}")
    return path


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Lanza Chrome con CDP")
    parser.add_argument("--port", type=int, default=CDP_PORT)
    parser.add_argument("--profile", default=None)
    parser.add_argument("--check", action="store_true", help="Solo verifica si CDP está activo")
    args = parser.parse_args()

    if args.check:
        if is_cdp_running(args.port):
            print(f"CDP activo en puerto {args.port}")
            sys.exit(0)
        else:
            print(f"CDP NO disponible en puerto {args.port}")
            sys.exit(1)

    if is_cdp_running(args.port):
        print(f"CDP ya activo en puerto {args.port}")
    else:
        proc = launch_chrome(port=args.port, profile_dir=args.profile)
        print("Chrome listo.")
