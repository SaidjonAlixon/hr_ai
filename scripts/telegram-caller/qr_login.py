#!/usr/bin/env python3
"""
QR login — token tez eskiradi, shuning uchun har 25s yangilanadi.
MUHIM: oddiy kamera/iMe emas — Telegram → Settings → Devices → Link Desktop Device.
"""
from __future__ import annotations

import asyncio
import os
import sys
import time

from telethon import TelegramClient
from telethon.errors import SessionPasswordNeededError


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


def save_qr(url: str, out_dir: str) -> str | None:
    url_path = os.path.join(out_dir, "qr_url.txt")
    with open(url_path, "w", encoding="utf-8") as f:
        f.write(url + "\n")
    png = os.path.join(out_dir, "qr.png")
    try:
        import qrcode

        img = qrcode.make(url, box_size=12, border=2)
        img.save(png)
        return png
    except Exception as e:  # noqa: BLE001
        print(f"qr.png skip: {e}", file=sys.stderr)
        return None


async def main() -> int:
    load_dotenv()
    api_id = int(os.environ.get("TELEGRAM_API_ID") or "0")
    api_hash = (os.environ.get("TELEGRAM_API_HASH") or "").strip()
    session = os.environ.get(
        "TELEGRAM_CALLER_SESSION",
        "/opt/hr_ai/scripts/telegram-caller/caller",
    )
    out_dir = os.path.dirname(session) or "."
    os.makedirs(out_dir, exist_ok=True)
    timeout = int(os.environ.get("TELEGRAM_QR_TIMEOUT") or "240")

    if not api_id or not api_hash:
        print("TELEGRAM_API_ID / TELEGRAM_API_HASH kerak", file=sys.stderr)
        return 2

    client = TelegramClient(session, api_id, api_hash)
    await client.connect()
    if await client.is_user_authorized():
        me = await client.get_me()
        print(f"Already logged in: {me.id} @{getattr(me, 'username', None)}")
        await client.disconnect()
        return 0

    print("Scan INSIDE Telegram: Settings → Devices → Link Desktop Device")
    print("NOT Camera app, NOT iMe")

    qr = await client.qr_login()
    save_qr(qr.url, out_dir)
    print("QR_URL=" + qr.url)
    print(f"QR_PNG={out_dir}/qr.png")

    deadline = time.time() + timeout
    while time.time() < deadline:
        remaining = deadline - time.time()
        wait_for = min(25.0, max(3.0, remaining))
        try:
            await asyncio.wait_for(qr.wait(), timeout=wait_for)
            break
        except SessionPasswordNeededError:
            pwd = (os.environ.get("TELEGRAM_2FA_PASSWORD") or "").strip()
            if not pwd:
                print("2FA parol kerak: TELEGRAM_2FA_PASSWORD", file=sys.stderr)
                await client.disconnect()
                return 3
            await client.sign_in(password=pwd)
            break
        except asyncio.TimeoutError:
            # token yangilash
            try:
                qr = await qr.recreate()
                save_qr(qr.url, out_dir)
                print("QR_REFRESH=" + qr.url)
            except Exception as e:  # noqa: BLE001
                print(f"recreate fail: {e}", file=sys.stderr)
                try:
                    qr = await client.qr_login()
                    save_qr(qr.url, out_dir)
                    print("QR_URL=" + qr.url)
                except Exception as e2:  # noqa: BLE001
                    print(f"qr_login fail: {e2}", file=sys.stderr)
                    await asyncio.sleep(2)
        except Exception as e:  # noqa: BLE001
            print(f"wait err: {e}", file=sys.stderr)
            await asyncio.sleep(2)
    else:
        print("QR timeout", file=sys.stderr)
        await client.disconnect()
        return 4

    if not await client.is_user_authorized():
        print("still not authorized", file=sys.stderr)
        await client.disconnect()
        return 4

    me = await client.get_me()
    print(f"OK logged in as {me.id} @{getattr(me, 'username', None)}")
    await client.disconnect()
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
