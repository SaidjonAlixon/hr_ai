#!/usr/bin/env python3
"""
O‘z userbot: Saidmuhammadga P2P Telegram qo‘ng‘iroq + audio.
Kerak: TELEGRAM_API_ID, TELEGRAM_API_HASH, session (login_once.py / qr_login.py).
"""
from __future__ import annotations

import asyncio
import os
import sys
from datetime import datetime
from zoneinfo import ZoneInfo

from telethon import TelegramClient

try:
    from pytgcalls import PyTgCalls
except ImportError:
    print("py-tgcalls o‘rnatilmagan: pip install py-tgcalls", file=sys.stderr)
    raise SystemExit(2)


def load_dotenv(path: str = "/opt/hr_ai/.env") -> None:
    try:
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
    except FileNotFoundError:
        pass


def tashkent_speech() -> str:
    now = datetime.now(ZoneInfo("Asia/Tashkent"))
    return (
        f"Assalomu alaykum, Saidmuhammadalixon. "
        f"Hozir Toshkent vaqti: soat {now.hour}, {now.minute} daqiqa."
    )


async def main() -> int:
    load_dotenv()
    api_id = int(os.environ.get("TELEGRAM_API_ID") or "0")
    api_hash = (os.environ.get("TELEGRAM_API_HASH") or "").strip()
    session = os.environ.get(
        "TELEGRAM_CALLER_SESSION",
        "/opt/hr_ai/scripts/telegram-caller/caller",
    )
    target = int(os.environ.get("TELEGRAM_CALL_TARGET_ID") or "5222899144")
    audio = (os.environ.get("TELEGRAM_CALL_AUDIO") or "").strip()
    hangup = int(os.environ.get("TELEGRAM_CALL_HANGUP_SEC") or "35")

    if not api_id or not api_hash:
        print("TELEGRAM_API_ID / TELEGRAM_API_HASH kerak", file=sys.stderr)
        return 2
    if not (os.path.exists(session + ".session") or os.path.exists(session)):
        print(f"Session yo‘q: {session}. Avval: python3 qr_login.py", file=sys.stderr)
        return 2
    if not audio:
        print("TELEGRAM_CALL_AUDIO yo‘q — qo‘ng‘iroq ochilmaydi", file=sys.stderr)
        return 2

    client = TelegramClient(session, api_id, api_hash)
    await client.connect()
    if not await client.is_user_authorized():
        print("Session authorize qilinmagan — qr_login.py", file=sys.stderr)
        await client.disconnect()
        return 2

    me = await client.get_me()
    print(f"Caller: {me.id} @{getattr(me, 'username', None)}")
    print(f"Target: {target}")
    print(f"Audio: {audio}")
    print("Speech intent:", tashkent_speech())

    # Telethon cache da yo‘q bo‘lsa — username / contact orqali resolve
    username = (os.environ.get("TELEGRAM_CALL_TARGET_USERNAME") or "Saidmuhammadalixon").lstrip("@")
    try:
        entity = await client.get_entity(target)
    except Exception:
        entity = await client.get_entity(username)
    target_id = int(getattr(entity, "id", target))
    print(f"Resolved target: {target_id} @{getattr(entity, 'username', None)}")
    if target_id == int(me.id):
        print("Caller == target — o‘ziga qo‘ng‘iroq bo‘lmaydi", file=sys.stderr)
        await client.disconnect()
        return 5

    calls = PyTgCalls(client)
    await calls.start()
    await calls.play(target_id, audio)
    print(f"Call started — hangup after {hangup}s")
    await asyncio.sleep(max(8, hangup))
    try:
        await calls.leave_call(target)
    except Exception as e:  # noqa: BLE001
        print(f"leave_call: {e}", file=sys.stderr)
    await client.disconnect()
    print("DONE")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
