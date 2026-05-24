"""
daemon.py — Orquestador principal de OpenGhost.

HTTP server en :8787. Recibe mensajes de canales autorizados,
invoca Claude Code, y devuelve la respuesta.
Un mensaje a la vez (lock-based), sesión única por día.
"""

import json
import os
import queue as _queue_mod
import sys
import threading
import traceback
from datetime import datetime, timezone
from pathlib import Path

import requests as _http

from dotenv import load_dotenv
from flask import Flask, Response, jsonify, request, stream_with_context

GHOST_DIR = Path(__file__).parent.parent
sys.path.insert(0, str(GHOST_DIR))

from core.context_builder import ContextBuilder
from core.heartbeat import HeartbeatScheduler
from core.session_manager import SessionManager
from core.wake_claude import WakeClaude


def _load_config() -> dict:
    config_path = GHOST_DIR / "config.json"
    if not config_path.exists():
        raise FileNotFoundError(f"config.json no encontrado en {config_path}")
    with open(config_path) as f:
        return json.load(f)


def _load_allowlist(path: str) -> set:
    try:
        with open(path) as f:
            data = json.load(f)
        return {str(uid) for uid in data.get("allowed_ids", [])}
    except Exception:
        return set()


# ── Bootstrap ─────────────────────────────────────────────────────────────────

load_dotenv(GHOST_DIR / ".env")
config = _load_config()
_workspace_env = Path(config.get("workspace_dir", "")) / ".env"
if _workspace_env.exists():
    load_dotenv(_workspace_env, override=True)

STATE_DIR = GHOST_DIR / "state"
STATE_DIR.mkdir(exist_ok=True)

session_mgr = SessionManager(config, str(STATE_DIR))
context_builder = ContextBuilder(config)
wake = WakeClaude(config, session_mgr)

_claude_lock = threading.Lock()

# Reasoning mode para Telegram (muestra tools usados en la respuesta)
_tg_reasoning_mode = False

# SSE log streaming
_sse_lock   = threading.Lock()
_sse_queues: list[_queue_mod.Queue] = []

def _publish_log(line: str):
    with _sse_lock:
        for q in _sse_queues:
            try:
                q.put_nowait(line)
            except _queue_mod.Full:
                pass

app = Flask(__name__)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _now_str() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _orb_token() -> str | None:
    return os.environ.get("ORB_TOKEN")


def _validate_orb_request() -> bool:
    token = _orb_token()
    if not token:
        return True  # sin token configurado: acceso local sin restricción
    return request.headers.get("X-Ghost-Token") == token


def _process_message(text: str, channel: str, extra_log=None,
                     image_paths: list[str] | None = None) -> dict:
    """Núcleo: construir prompt → invocar Claude → parsear respuesta."""
    prompt = context_builder.build(text, channel, image_paths=image_paths)
    def _combined_log(line: str):
        _publish_log(line)
        if extra_log:
            extra_log(line)
    raw = wake.invoke(prompt, on_log=_combined_log,
                      force_new_session=(text == "__DADDY_HOME__"))
    return ContextBuilder.parse_response(raw)


# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.route("/message", methods=["POST"])
def receive_message():
    if not _validate_orb_request():
        return jsonify({"error": "unauthorized"}), 401

    data = request.get_json(silent=True) or {}
    text = (data.get("text") or "").strip()
    channel = data.get("channel", "orb")
    image_paths = data.get("image_paths") or data.get("file_paths") or None

    if not text and not image_paths:
        return jsonify({"error": "text o image_paths requerido"}), 400

    if not _claude_lock.acquire(blocking=False):
        return jsonify({"error": "busy", "message": "Claude está procesando otro mensaje."}), 503

    try:
        result = _process_message(
            text or "Analiza este archivo.", channel, image_paths=image_paths
        )
        return jsonify(result)
    except RuntimeError as e:
        return jsonify({"error": str(e)}), 503
    except Exception:
        traceback.print_exc()
        return jsonify({"error": "error interno"}), 500
    finally:
        _claude_lock.release()


@app.route("/stop", methods=["POST"])
def stop_current():
    if not _validate_orb_request():
        return jsonify({"error": "unauthorized"}), 401

    killed = wake.kill_current()
    return jsonify({"ok": True, "killed": killed})


@app.route("/shutdown", methods=["POST"])
def shutdown_system():
    if not _validate_orb_request():
        return jsonify({"error": "unauthorized"}), 401

    threading.Timer(5.0, _do_shutdown).start()
    _publish_log("[shutdown] Apagando sistema en 5 segundos...")
    return jsonify({"ok": True, "message": "Apagando en 5 segundos..."})


@app.route("/session/new", methods=["POST"])
def new_session():
    if not _validate_orb_request():
        return jsonify({"error": "unauthorized"}), 401

    session_mgr.force_new_session()
    return jsonify({"ok": True, "message": "Próximo mensaje abrirá sesión nueva."})


@app.route("/status", methods=["GET"])
def status():
    locked = not _claude_lock.acquire(blocking=False)
    if not locked:
        _claude_lock.release()
    return jsonify({
        "ok": True,
        "locked": locked,
        "session_date": session_mgr.current_session_date(),
        "workspace": config.get("workspace_dir"),
        "timestamp": _now_str(),
    })


@app.route("/logs/stream")
def logs_stream():
    q: _queue_mod.Queue = _queue_mod.Queue(maxsize=200)
    with _sse_lock:
        _sse_queues.append(q)

    def generate():
        try:
            while True:
                try:
                    line = q.get(timeout=20)
                    yield f"data: {json.dumps({'line': line})}\n\n"
                except _queue_mod.Empty:
                    yield ": keepalive\n\n"
        except GeneratorExit:
            pass
        finally:
            with _sse_lock:
                try:
                    _sse_queues.remove(q)
                except ValueError:
                    pass

    return Response(
        stream_with_context(generate()),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── Telegram helpers ──────────────────────────────────────────────────────────

def _transcribe_voice(audio_bytes: bytes) -> str:
    api_key = os.environ.get("GROQ_API_KEY", "")
    if not api_key:
        raise RuntimeError("GROQ_API_KEY no configurada")
    resp = _http.post(
        "https://api.groq.com/openai/v1/audio/transcriptions",
        headers={"Authorization": f"Bearer {api_key}"},
        files={"file": ("voice.ogg", audio_bytes, "audio/ogg")},
        data={"model": "whisper-large-v3-turbo", "response_format": "text"},
        timeout=30,
    )
    resp.raise_for_status()
    return resp.text.strip()


def _do_shutdown():
    import subprocess as _sp
    if sys.platform == "win32":
        _sp.run(["shutdown", "/s", "/t", "0"])
    else:
        _sp.run(["shutdown", "-h", "now"])


async def _send_tg_response(update, result: dict, logs: list | None = None):
    from io import BytesIO
    display_text = (result.get("text_clean") or "").strip()
    if logs and _tg_reasoning_mode:
        tool_lines = [l for l in logs if l.startswith("→ ") or l.startswith("[session]")]
        if tool_lines:
            display_text = "```\n" + "\n".join(tool_lines) + "\n```\n\n" + display_text

    if result.get("has_audio") and result.get("audio_text"):
        try:
            tts_port = config.get("tts", {}).get("proxy_port", 5052)
            tts_resp = _http.post(
                f"http://127.0.0.1:{tts_port}/v1/audio/speech",
                json={"input": result["audio_text"], "response_format": "opus"},
                timeout=30,
            )
            if tts_resp.ok:
                await update.message.reply_voice(voice=BytesIO(tts_resp.content))
        except Exception as e:
            print(f"[telegram] TTS voice note failed: {e}", flush=True)

    if display_text:
        await update.message.reply_text(display_text)


# ── Telegram integration (opcional) ───────────────────────────────────────────

def _start_telegram(cfg: dict):
    from telegram import Update
    from telegram.ext import Application, CommandHandler, MessageHandler, filters

    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    if not token:
        print("[telegram] TELEGRAM_BOT_TOKEN no configurado — bot desactivado.", flush=True)
        return

    allowlist_file = cfg.get("channels", {}).get("telegram", {}).get("allowlist_file", "")
    allowlist = _load_allowlist(str(GHOST_DIR / allowlist_file)) if allowlist_file else set()

    def is_authorized(user_id: int) -> bool:
        if not allowlist:
            return False
        return str(user_id) in allowlist

    async def cmd_start(update: Update, ctx):
        if not is_authorized(update.effective_user.id):
            return
        await update.message.reply_text("OpenGhost activo.")

    async def cmd_new(update: Update, ctx):
        if not is_authorized(update.effective_user.id):
            return
        session_mgr.force_new_session()
        await update.message.reply_text("Nueva sesión en el próximo mensaje.")

    async def cmd_status(update: Update, ctx):
        if not is_authorized(update.effective_user.id):
            return
        locked = not _claude_lock.acquire(blocking=False)
        if not locked:
            _claude_lock.release()
        date = session_mgr.current_session_date() or "ninguna"
        await update.message.reply_text(
            f"Estado: {'procesando' if locked else 'libre'}\nSesión: {date}"
        )

    async def cmd_stop(update: Update, ctx):
        if not is_authorized(update.effective_user.id):
            return
        killed = wake.kill_current()
        msg = "Claude detenido." if killed else "No había nada en curso."
        await update.message.reply_text(msg)

    async def cmd_reasoning(update: Update, ctx):
        global _tg_reasoning_mode
        if not is_authorized(update.effective_user.id):
            return
        args = ctx.args
        val = args[0].lower() if args else None
        if val in ("on", "true"):
            _tg_reasoning_mode = True
        elif val in ("off", "false"):
            _tg_reasoning_mode = False
        else:
            _tg_reasoning_mode = not _tg_reasoning_mode
        await update.message.reply_text(f"Reasoning: {'ON' if _tg_reasoning_mode else 'OFF'}")

    async def cmd_apagar(update: Update, ctx):
        if not is_authorized(update.effective_user.id):
            return

        await update.message.reply_text("Preparando apagado...")

        if _claude_lock.acquire(blocking=False):
            try:
                result = _process_message(
                    "PROTOCOLO DE APAGADO: El usuario ha solicitado apagar la PC desde Telegram. "
                    "Ejecuta en orden:\n"
                    "1. Cierra todos los programas y procesos que hayas abierto "
                    "(browser_server, Chrome, Spotify, cualquier script en background).\n"
                    "2. Guarda cualquier estado importante en memory/ si hay algo pendiente.\n"
                    "3. Responde confirmando qué cerraste. Sé breve y directo.",
                    "telegram",
                )
                await _send_tg_response(update, result)
            except Exception:
                traceback.print_exc()
            finally:
                _claude_lock.release()

        await update.message.reply_text("Apagando en 5 segundos.")
        threading.Timer(5.0, _do_shutdown).start()

    async def cmd_apagar_force(update: Update, ctx):
        if not is_authorized(update.effective_user.id):
            return
        await update.message.reply_text(
            "Apagado forzado en 15 segundos.\n"
            "Windows cerrará todos los programas automáticamente."
        )
        def _graceful_shutdown():
            import subprocess as _sp
            if sys.platform == "win32":
                _sp.run(["shutdown", "/s", "/t", "15"])
            else:
                _sp.run(["shutdown", "-h", "+1"])
        threading.Thread(target=_graceful_shutdown, daemon=True).start()

    async def handle_photo(update: Update, ctx):
        if not is_authorized(update.effective_user.id):
            return

        await update.message.chat.send_action("typing")
        print("[telegram] foto recibida — descargando...", flush=True)

        photo = update.message.photo[-1]
        caption = update.message.caption or ""
        tg_file = await ctx.bot.get_file(photo.file_id)
        img_bytes = bytes(await tg_file.download_as_bytearray())
        print(f"[telegram] foto descargada ({len(img_bytes)} bytes)", flush=True)

        img_dir = GHOST_DIR / "state" / "images"
        img_dir.mkdir(exist_ok=True)
        ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S_%f")
        img_path = img_dir / f"tg_{ts}.jpg"
        img_path.write_bytes(img_bytes)

        if not _claude_lock.acquire(blocking=False):
            await update.message.reply_text("Claude está ocupado, intenta en un momento.")
            img_path.unlink(missing_ok=True)
            return
        try:
            result = _process_message(
                caption or "Analiza esta imagen.",
                "telegram",
                image_paths=[str(img_path)],
            )
            await _send_tg_response(update, result)
        except RuntimeError as e:
            await update.message.reply_text(f"Error: {e}")
        except Exception:
            traceback.print_exc()
            await update.message.reply_text("Error interno.")
        finally:
            _claude_lock.release()
            img_path.unlink(missing_ok=True)

    async def handle_text(update: Update, ctx):
        if not is_authorized(update.effective_user.id):
            return

        text = update.message.text or ""
        await update.message.chat.send_action("typing")

        if not _claude_lock.acquire(blocking=False):
            await update.message.reply_text("Claude está procesando otro mensaje. Intenta en un momento.")
            return

        try:
            logs: list[str] = []
            result = _process_message(text, "telegram",
                                      extra_log=(logs.append if _tg_reasoning_mode else None))
            await _send_tg_response(update, result, logs)
        except RuntimeError as e:
            await update.message.reply_text(f"Error: {e}")
        except Exception:
            traceback.print_exc()
            await update.message.reply_text("Error interno.")
        finally:
            _claude_lock.release()

    async def handle_voice(update: Update, ctx):
        if not is_authorized(update.effective_user.id):
            return

        await update.message.chat.send_action("typing")
        tg_file = await ctx.bot.get_file(update.message.voice.file_id)
        audio_bytes = bytes(await tg_file.download_as_bytearray())

        try:
            transcribed = _transcribe_voice(audio_bytes)
        except Exception as e:
            await update.message.reply_text(f"Error transcribiendo audio: {e}")
            return

        if not _claude_lock.acquire(blocking=False):
            await update.message.reply_text("Claude está ocupado, intenta en un momento.")
            return

        try:
            result = _process_message(transcribed, "telegram_voice")
            await _send_tg_response(update, result)
        except RuntimeError as e:
            await update.message.reply_text(f"Error: {e}")
        except Exception:
            traceback.print_exc()
            await update.message.reply_text("Error interno.")
        finally:
            _claude_lock.release()

    def thread_target():
        app_tg = Application.builder().token(token).build()
        app_tg.add_handler(CommandHandler("start",     cmd_start))
        app_tg.add_handler(CommandHandler("new",       cmd_new))
        app_tg.add_handler(CommandHandler("status",    cmd_status))
        app_tg.add_handler(CommandHandler("stop",      cmd_stop))
        app_tg.add_handler(CommandHandler("reasoning",     cmd_reasoning))
        app_tg.add_handler(CommandHandler("apagar",        cmd_apagar))
        app_tg.add_handler(CommandHandler("apagar_force",  cmd_apagar_force))
        app_tg.add_handler(MessageHandler(filters.PHOTO, handle_photo))
        app_tg.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_text))
        app_tg.add_handler(MessageHandler(filters.VOICE, handle_voice))
        print("[telegram] Bot iniciado.", flush=True)
        app_tg.run_polling(allowed_updates=Update.ALL_TYPES)

    t = threading.Thread(target=thread_target, daemon=True, name="telegram-bot")
    t.start()


# ── TTS Proxy (opcional) ──────────────────────────────────────────────────────

def _start_tts_proxy(cfg: dict):
    import subprocess as sp, socket
    tts_script = GHOST_DIR / "tts-proxy" / "proxy.py"
    if not tts_script.exists():
        return
    port = cfg.get("tts", {}).get("proxy_port", 5052)
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=0.5):
            print(f"[tts-proxy] Ya corriendo en :{port}", flush=True)
            return None
    except OSError:
        pass
    proc = sp.Popen(
        [sys.executable, str(tts_script), "--port", str(port)],
        cwd=str(GHOST_DIR),
    )
    print(f"[tts-proxy] Iniciado en puerto {port} (PID {proc.pid})", flush=True)
    return proc


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    host = config.get("daemon", {}).get("host", "127.0.0.1")
    port = config.get("daemon", {}).get("port", 8787)

    if config.get("tts", {}).get("enabled"):
        _start_tts_proxy(config)

    if config.get("channels", {}).get("telegram", {}).get("enabled"):
        _start_telegram(config)

    if config.get("heartbeat", {}).get("enabled"):
        hb = HeartbeatScheduler(config, wake, _claude_lock, _publish_log, context_builder)
        hb.start()

    deleted = session_mgr.delete_old_session_files(config.get("workspace_dir", ""))
    if deleted:
        print(f"[cleanup] {deleted} sesión(es) antigua(s) eliminada(s)", flush=True)

    print(f"[daemon] OpenGhost escuchando en http://{host}:{port}", flush=True)
    app.run(host=host, port=port, threaded=True, use_reloader=False)
