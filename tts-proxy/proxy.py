"""
proxy.py — Proxy TTS flexible para OpenGhost.

Expone endpoints OpenAI-compatibles (/v1/audio/speech) y enruta
las peticiones al provider configurado (Fish Audio, OpenAI o ElevenLabs).

Uso: python proxy.py [--port 5052]
"""

import argparse
import json
import os
import sys
from abc import ABC, abstractmethod
from pathlib import Path

import requests
from dotenv import load_dotenv
from flask import Flask, Response, jsonify, request

PROXY_DIR = Path(__file__).parent
load_dotenv(PROXY_DIR / ".env")
load_dotenv(PROXY_DIR.parent / ".env")

app = Flask(__name__)


# ── Providers ─────────────────────────────────────────────────────────────────

class TTSProvider(ABC):
    @abstractmethod
    def synthesize(self, text: str, voice_id: str | None, fmt: str = "mp3") -> tuple[bytes, str]:
        ...


class FishAudioProvider(TTSProvider):
    BASE_URL = "https://api.fish.audio/v1/tts"

    def __init__(self, cfg: dict):
        self.api_key = os.environ.get(cfg.get("api_key_env", "FISH_API_KEY"), "")
        self.default_voice = cfg.get("voice_id", "")
        self.model = cfg.get("model", "speech-1.6")

    def synthesize(self, text: str, voice_id: str | None, fmt: str = "mp3") -> tuple[bytes, str]:
        vid = voice_id or self.default_voice
        payload = {
            "text": text,
            "reference_id": vid,
            "format": fmt,
            "latency": "balanced",
            "normalize": True,
            "chunk_length": 200,
        }
        if fmt == "mp3":
            payload["mp3_bitrate"] = 128
        headers = {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"}
        r = requests.post(self.BASE_URL, json=payload, headers=headers, timeout=30)
        r.raise_for_status()
        mimetype = "audio/ogg" if fmt == "opus" else "audio/mpeg"
        return r.content, mimetype


class OpenAITTSProvider(TTSProvider):
    BASE_URL = "https://api.openai.com/v1/audio/speech"

    def __init__(self, cfg: dict):
        self.api_key = os.environ.get(cfg.get("api_key_env", "OPENAI_API_KEY"), "")
        self.voice = cfg.get("voice", "alloy")
        self.model = cfg.get("model", "tts-1")

    def synthesize(self, text: str, voice_id: str | None, fmt: str = "mp3") -> tuple[bytes, str]:
        payload = {
            "model": self.model,
            "input": text,
            "voice": voice_id or self.voice,
        }
        headers = {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"}
        r = requests.post(self.BASE_URL, json=payload, headers=headers, timeout=30)
        r.raise_for_status()
        return r.content, "audio/mpeg"


class ElevenLabsProvider(TTSProvider):
    BASE_URL = "https://api.elevenlabs.io/v1/text-to-speech"

    def __init__(self, cfg: dict):
        self.api_key = os.environ.get(cfg.get("api_key_env", "ELEVENLABS_API_KEY"), "")
        self.default_voice = cfg.get("voice_id", "")
        self.model = cfg.get("model", "eleven_multilingual_v2")

    def synthesize(self, text: str, voice_id: str | None, fmt: str = "mp3") -> tuple[bytes, str]:
        vid = voice_id or self.default_voice
        url = f"{self.BASE_URL}/{vid}"
        payload = {
            "text": text,
            "model_id": self.model,
            "voice_settings": {"stability": 0.5, "similarity_boost": 0.75},
        }
        headers = {"xi-api-key": self.api_key, "Content-Type": "application/json"}
        r = requests.post(url, json=payload, headers=headers, timeout=30)
        r.raise_for_status()
        return r.content, "audio/mpeg"


# ── Provider factory ──────────────────────────────────────────────────────────

PROVIDERS = {
    "fish": FishAudioProvider,
    "openai": OpenAITTSProvider,
    "elevenlabs": ElevenLabsProvider,
}


def _load_provider() -> TTSProvider:
    config_path = PROXY_DIR.parent / "config.json"
    cfg = {}
    if config_path.exists():
        with open(config_path) as f:
            cfg = json.load(f).get("tts", {})

    provider_name = cfg.get("provider", "fish")
    provider_cfg = cfg.get(provider_name, {})
    cls = PROVIDERS.get(provider_name)
    if not cls:
        raise ValueError(f"Provider TTS desconocido: {provider_name}")
    return cls(provider_cfg)


_provider: TTSProvider | None = None


def get_provider() -> TTSProvider:
    global _provider
    if _provider is None:
        _provider = _load_provider()
    return _provider


# ── Endpoints ─────────────────────────────────────────────────────────────────

def _handle_tts():
    data = request.get_json(silent=True) or {}
    text = data.get("input", "")
    if not text:
        return jsonify({"error": "'input' requerido"}), 400

    voice_id = data.get("voice") or None
    fmt = data.get("response_format", "mp3")

    try:
        audio, mimetype = get_provider().synthesize(text, voice_id, fmt)
        return Response(audio, mimetype=mimetype)
    except requests.HTTPError as e:
        return jsonify({"error": f"Error del provider TTS: {e}"}), 502
    except requests.Timeout:
        return jsonify({"error": "Timeout del provider TTS"}), 504
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/audio/speech", methods=["POST"])
def speech():
    return _handle_tts()


@app.route("/v1/audio/speech", methods=["POST"])
def speech_v1():
    return _handle_tts()


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"ok": True, "provider": type(get_provider()).__name__})


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="OpenGhost TTS Proxy")
    parser.add_argument("--port", type=int, default=5052)
    parser.add_argument("--host", default="127.0.0.1")
    args = parser.parse_args()

    provider = get_provider()
    print(f"[tts-proxy] Provider: {type(provider).__name__} | Puerto: {args.port}", flush=True)
    app.run(host=args.host, port=args.port, use_reloader=False)
