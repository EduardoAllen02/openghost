# Plugin: Wake-on-LAN

Bot Telegram para Termux que permite encender la PC principal desde el teléfono.

## Arquitectura

```
[Eduardo] → Telegram → [Termux Bot (Android)] → magic packet → [PC enciende]
[PC arranca] → daemon.py inicia → [Eduardo puede usar Lucy normalmente]
[Eduardo] → /apagar → [daemon.py] → shutdown
```

## Requisitos

- Android con Termux instalado
- PC con WoL habilitado en BIOS
- PC y Android en la misma red LAN (o acceso via port-forwarding)
- Bot de Telegram separado (diferente al bot del daemon)

## Instalación en Termux

```bash
pkg install python
pip install python-telegram-bot python-dotenv
```

## Configuración

Crea `.env` en el mismo directorio que `termux_bot.py`:

```env
TELEGRAM_BOT_TOKEN=TOKEN_DEL_BOT_TERMUX
TELEGRAM_ALLOWED_ID=TU_USER_ID_DE_TELEGRAM
PC_MAC_ADDRESS=AA:BB:CC:DD:EE:FF
PC_BROADCAST=192.168.1.255
PC_IP=192.168.1.X
PC_PORT=8787
```

Para obtener tu user ID de Telegram, manda cualquier mensaje a @userinfobot.

Para obtener la MAC de la PC en Windows:
```
ipconfig /all
# Busca la línea "Dirección física" del adaptador de red
```

## Habilitar WoL en BIOS

En la BIOS de la PC busca: "Wake on LAN", "Power On By PCI-E", o similar.
Actívalo. El adaptador de red debe soportar WoL (la mayoría lo hace).

En Windows, también actívalo en el adaptador:
- Administrador de dispositivos → Adaptadores de red → [tu tarjeta] → Propiedades
- Pestaña "Administración de energía" → Permitir que este dispositivo reactive el equipo

## Arrancar el bot

```bash
# En Termux, como servicio en background:
python termux_bot.py &

# O con nohup para que sobreviva al cerrar la terminal:
nohup python termux_bot.py > wol.log 2>&1 &
```

## Comandos disponibles

| Comando | Descripción |
|---------|-------------|
| `/encender` | Envía magic packet para despertar la PC |
| `/estado_pc` | Verifica si la PC está online |

## Apagado remoto

El comando `/apagar` está en el **bot principal** (daemon.py de la PC).
Solo funciona cuando la PC ya está encendida y el daemon corriendo.
