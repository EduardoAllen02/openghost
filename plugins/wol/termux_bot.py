#!/data/data/com.termux/files/usr/bin/python3
"""
termux_bot.py — Bot Telegram para Termux (Android, siempre encendido).

Comandos:
  /encender  — Wake-on-LAN (PC apagada → envía magic packet)
  /levantar  — Levanta el daemon de Lucy si la PC está encendida pero Lucy no
  /estado    — Verifica si la PC está viva y si Lucy está activa
  /start     — Confirma que el bot está activo

Variables de entorno (.env en el mismo directorio):
  TELEGRAM_BOT_TOKEN, TELEGRAM_ALLOWED_ID
  PC_MAC_ADDRESS, PC_BROADCAST, PC_IP
  PC_PORT=8787   (daemon Lucy)
  LAUNCHER_PORT=8788  (launcher siempre activo)
"""

import asyncio
import os
import socket
import struct
from pathlib import Path

import httpx
from dotenv import load_dotenv
from telegram import Update
from telegram.ext import Application, CommandHandler

load_dotenv(Path(__file__).parent / ".env")

TOKEN          = os.environ["TELEGRAM_BOT_TOKEN"]
ALLOWED_ID     = int(os.environ["TELEGRAM_ALLOWED_ID"])
MAC_ADDRESS    = os.environ.get("PC_MAC_ADDRESS", "")
BROADCAST      = os.environ.get("PC_BROADCAST", "255.255.255.255")
PC_IP          = os.environ.get("PC_IP", "")
PC_PORT        = int(os.environ.get("PC_PORT", "8787"))
LAUNCHER_PORT  = int(os.environ.get("LAUNCHER_PORT", "8788"))


def _tcp_open(ip: str, port: int, timeout: float = 2.0) -> bool:
    try:
        s = socket.create_connection((ip, port), timeout=timeout)
        s.close()
        return True
    except OSError:
        return False


def _send_magic_packet(mac: str, broadcast: str):
    mac_bytes = bytes.fromhex(mac.replace(":", "").replace("-", ""))
    if len(mac_bytes) != 6:
        raise ValueError(f"MAC inválida: {mac}")
    packet = b"\xff" * 6 + mac_bytes * 16
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
    sock.sendto(packet, (broadcast, 9))
    sock.close()


def _is_authorized(user_id: int) -> bool:
    return user_id == ALLOWED_ID


async def cmd_start(update: Update, ctx):
    if not _is_authorized(update.effective_user.id):
        return
    await update.message.reply_text("WoL bot activo.\n/encender · /levantar · /estado")


async def cmd_estado(update: Update, ctx):
    if not _is_authorized(update.effective_user.id):
        return

    pc_viva  = _tcp_open(PC_IP, LAUNCHER_PORT) if PC_IP else False
    lucy_ok  = _tcp_open(PC_IP, PC_PORT)       if PC_IP else False

    if not pc_viva and not lucy_ok:
        msg = "PC apagada (o sin red)."
    elif pc_viva and not lucy_ok:
        msg = f"PC encendida pero Lucy no está activa.\nUsa /levantar para iniciarla."
    else:
        msg = f"PC encendida. Lucy activa en {PC_IP}:{PC_PORT}."

    await update.message.reply_text(msg)


async def cmd_encender(update: Update, ctx):
    if not _is_authorized(update.effective_user.id):
        return

    if not MAC_ADDRESS:
        await update.message.reply_text("Error: PC_MAC_ADDRESS no configurada.")
        return

    if _tcp_open(PC_IP, LAUNCHER_PORT):
        await update.message.reply_text("La PC ya está encendida.")
        return

    try:
        _send_magic_packet(MAC_ADDRESS, BROADCAST)
        await update.message.reply_text(
            f"Magic packet enviado.\n"
            "La PC debería encender en ~30 segundos si WoL está habilitado en BIOS.\n"
            "Luego usa /levantar si Lucy no arranca sola."
        )
    except Exception as e:
        await update.message.reply_text(f"Error enviando magic packet: {e}")


async def cmd_levantar(update: Update, ctx):
    if not _is_authorized(update.effective_user.id):
        return

    if not PC_IP:
        await update.message.reply_text("PC_IP no configurada.")
        return

    if not _tcp_open(PC_IP, LAUNCHER_PORT):
        await update.message.reply_text(
            "La PC no responde. Puede estar apagada — usa /encender primero."
        )
        return

    if _tcp_open(PC_IP, PC_PORT):
        await update.message.reply_text("Lucy ya está activa.")
        return

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(f"http://{PC_IP}:{LAUNCHER_PORT}/start")
            data = resp.json()
        await update.message.reply_text(data.get("msg", "Señal enviada."))
    except Exception as e:
        await update.message.reply_text(f"Error contactando el launcher: {e}")


def main():
    application = Application.builder().token(TOKEN).build()
    application.add_handler(CommandHandler("start",    cmd_start))
    application.add_handler(CommandHandler("estado",   cmd_estado))
    application.add_handler(CommandHandler("encender", cmd_encender))
    application.add_handler(CommandHandler("levantar", cmd_levantar))
    print(f"[wol-bot] Iniciado. MAC: {MAC_ADDRESS or '(no configurada)'}")
    application.run_polling()


if __name__ == "__main__":
    main()
