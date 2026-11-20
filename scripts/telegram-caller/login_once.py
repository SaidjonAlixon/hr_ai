#!/usr/bin/env python3
"""Bir martalik Telethon login — session fayl yaratadi."""
from __future__ import annotations

import asyncio
import os
import sys

from telethon import TelegramClient


def load_dotenv(path: str = "/opt/hr_ai/.env") -> None:
    try:
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                v = v.strip().strip('"').strip("'")
                os.environ.setdefault(k.strip(), v)
    except FileNotFoundError:
        pass


async def main() -> int:
    load_dotenv()
    api_id = int(os.environ.get("TELEGRAM_API_ID") or "0")
    api_hash = (os.environ.get("TELEGRAM_API_HASH") or "").strip()
    session = os.environ.get(
        "TELEGRAM_CALLER_SESSION",
        "/opt/hr_ai/scripts/telegram-caller/caller",
    )
    phone = (os.environ.get("TELEGRAM_CALLER_PHONE") or "").strip()
    if not api_id or not api_hash:
        print("TELEGRAM_API_ID va TELEGRAM_API_HASH ni .env ga qo‘ying", file=sys.stderr)
        return 2
    client = TelegramClient(session, api_id, api_hash)
    await client.start(phone=phone or None)
    me = await client.get_me()
    print(f"OK logged in as {me.id} @{getattr(me, 'username', None)}")
    await client.disconnect()
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
