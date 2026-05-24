# TTS Proxy

## Qué hace

El proxy TTS convierte texto a audio. Expone endpoints OpenAI-compatibles
y enruta las peticiones al provider configurado.

```
orbe / cliente
    │
    POST /v1/audio/speech
    {"input": "texto", "voice": "id-opcional"}
    │
    ▼
tts-proxy/proxy.py :5052
    │
    ├── fish     → Fish Audio API (voz clonada con Fish)
    ├── openai   → OpenAI TTS (o cualquier proxy compatible)
    └── elevenlabs → ElevenLabs API
    │
    ▼
MP3 bytes
```

## Seleccionar Provider

En `config.json`:
```json
{
  "tts": {
    "enabled": true,
    "provider": "fish",
    "proxy_port": 5052,
    "fish": {
      "api_key_env": "FISH_API_KEY",
      "voice_id": "tu-voice-id-de-fish",
      "model": "speech-1.6"
    }
  }
}
```

## Configurar Cada Provider

### Fish Audio (default)

Fish Audio permite clonar una voz con pocos segundos de audio.
El `voice_id` es el ID del modelo de voz clonado.

```env
FISH_API_KEY=tu-api-key-de-fish-audio
```

```json
"fish": {
  "api_key_env": "FISH_API_KEY",
  "voice_id": "0f0e1d637b77425698158ff4109d1829",
  "model": "speech-1.6"
}
```

### OpenAI TTS

Compatible con la API oficial de OpenAI o cualquier proxy que use el mismo formato.

```env
OPENAI_API_KEY=sk-...
```

```json
"openai": {
  "api_key_env": "OPENAI_API_KEY",
  "voice": "alloy",
  "model": "tts-1"
}
```

Voces disponibles: alloy, echo, fable, onyx, nova, shimmer.

### ElevenLabs

```env
ELEVENLABS_API_KEY=tu-api-key
```

```json
"elevenlabs": {
  "api_key_env": "ELEVENLABS_API_KEY",
  "voice_id": "id-de-voz-elevenlabs",
  "model": "eleven_multilingual_v2"
}
```

## Etiquetas TTS en Respuestas de Claude

Para que una respuesta incluya audio, Claude usa etiquetas:

```
[[tts:text]]texto que se sintetizará aquí[/tts:text]]
```

El orbe extrae el contenido de las etiquetas, llama al proxy,
y reproduce el audio. El texto completo (incluyendo partes sin etiquetas)
se muestra en el chat.

**Convenciones del contenido TTS:**
- No incluir código, rutas de archivos, o datos técnicos
- Usar el idioma primario del agente
- Frases cortas y naturales (como hablaría alguien en voz)

## Arrancar el Proxy Manualmente

```bash
python tts-proxy/proxy.py --port 5052
```

El daemon lo inicia automáticamente si `tts.enabled = true` en config.

## Verificar que Funciona

```bash
curl -X POST http://localhost:5052/health
# {"ok": true, "provider": "FishAudioProvider"}

curl -X POST http://localhost:5052/v1/audio/speech \
  -H "Content-Type: application/json" \
  -d '{"input": "hola mundo"}' \
  --output test.mp3
```
