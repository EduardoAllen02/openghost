# Wake-on-LAN — Feature Futura

## Visión

Poder encender la PC y activar el agente desde cualquier parte,
usando un dispositivo siempre encendido como intermediario
(Raspberry Pi, celular Android con Termux, otro servidor).

## Flujo Planeado

```
Usuario (app móvil / Telegram)
  │
  └── Envía comando: "wake up" o botón en app
        │
        ▼
Dispositivo siempre encendido (Raspberry Pi / Android Termux)
  - Corre un daemon ligero 24/7
  - Tiene el OpenGhost Telegram bot escuchando
        │
        ▼
Envía Magic Packet UDP (WoL) a la PC
  MAC address configurada en config.json → "wake_on_lan.mac_address"
        │
        ▼
PC se enciende (BIOS con WoL habilitado)
        │
        ▼
Task Scheduler / startup script inicia OpenGhost daemon
        │
        ▼
Usuario recibe confirmación en Telegram: "OpenGhost activo"
```

## Configuración en config.json

```json
{
  "wake_on_lan": {
    "enabled": true,
    "mac_address": "AA:BB:CC:DD:EE:FF",
    "broadcast": "255.255.255.255",
    "trigger_via": "telegram"
  }
}
```

## Requisitos de la PC

1. BIOS/UEFI con "Wake on LAN" o "Power on by PCI-E" habilitado
2. Adaptador de red compatible con WoL
3. PC conectada por cable ethernet (WoL via WiFi es menos confiable)
4. Task Scheduler con tarea de inicio que lance `start.bat` al iniciar Windows

## Requisitos del Dispositivo Intermediario

- Siempre encendido y conectado a internet
- Python 3.x con `python-telegram-bot`
- En la misma red local que la PC (para el Magic Packet UDP)
  O acceso VPN a la red local

## Implementación del Magic Packet (Python)

```python
import socket
import struct

def send_magic_packet(mac_address: str, broadcast: str = "255.255.255.255"):
    mac_clean = mac_address.replace(":", "").replace("-", "")
    mac_bytes = bytes.fromhex(mac_clean)
    magic = b"\xff" * 6 + mac_bytes * 16
    
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        sock.sendto(magic, (broadcast, 9))
    
    print(f"Magic packet enviado a {mac_address}")
```

## Auto-inicio en Windows

Para que OpenGhost arranque automáticamente cuando la PC se enciende:

```
Task Scheduler → Crear tarea básica
  - Disparador: "Al iniciar sesión"
  - Acción: Iniciar programa → start.bat
  - Ruta: C:\Users\Yeyian PC\Documents\VSCodeProjects\OpenGhost\start.bat
```

O via PowerShell:
```powershell
$action = New-ScheduledTaskAction -Execute "C:\...\OpenGhost\start.bat"
$trigger = New-ScheduledTaskTrigger -AtLogOn
Register-ScheduledTask -Action $action -Trigger $trigger -TaskName "OpenGhost"
```

## Estado Actual

Esta feature está **diseñada pero no implementada**.
El campo `wake_on_lan` en `config.json` está reservado para cuando se implemente.

Prioridad: después de que el orbe de voz y los canales principales estén estables.
