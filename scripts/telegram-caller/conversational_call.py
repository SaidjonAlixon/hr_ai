#!/usr/bin/env python3
"""
AI conversational Telegram P2P call.
Modes:
  A) TELEGRAM_CALL_PLAN=plan.json  — play playlist (+ optional listen), then exit
  B) stdin JSON lines protocol:
       {"cmd":"start","target_id":123,"username":"x"}
       {"cmd":"play","file":"/path/a.mp3"}
       {"cmd":"listen","sec":10,"out":"/path/l.wav"}
       {"cmd":"hangup"}
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
import traceback
from pathlib import Path

from telethon import TelegramClient

try:
    from pytgcalls import PyTgCalls
except ImportError:
    print("py-tgcalls kerak", file=sys.stderr)
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


def log(msg: str) -> None:
    print(msg, flush=True)


async def resolve_target(
    client: TelegramClient,
    target_id: int,
    username: str | None,
    phone: str | None = None,
):
    """Telethon cache da yo‘q user — username yoki telefon orqali topish."""
    from telethon.tl.types import User

    errors: list[str] = []

    async def as_user(ent):
        if ent is None:
            return None
        if isinstance(ent, User):
            return ent
        # ba’zan get_entity InputPeer qaytaradi — qayta o‘qiymiz
        try:
            full = await client.get_entity(ent)
            if isinstance(full, User):
                return full
        except Exception as e:  # noqa: BLE001
            errors.append(f"as_user:{e}")
        return None

    # 1) to‘g‘ridan-to‘g‘ri id
    try:
        u = await as_user(await client.get_entity(target_id))
        if u:
            return u
    except Exception as e:  # noqa: BLE001
        errors.append(f"id:{e}")

    # 2) username
    uname = (username or "").strip().lstrip("@")
    if uname:
        for candidate in (uname, f"@{uname}"):
            try:
                u = await as_user(await client.get_entity(candidate))
                if u:
                    return u
            except Exception as e:  # noqa: BLE001
                errors.append(f"user:{candidate}:{e}")

    # 3) telefon → ImportContacts (access_hash olish)
    raw_phone = (phone or "").strip()
    if raw_phone:
        digits = "".join(ch for ch in raw_phone if ch.isdigit())
        variants = []
        if digits:
            variants.append("+" + digits if not raw_phone.startswith("+") else raw_phone)
            variants.append(digits)
            if digits.startswith("998"):
                variants.append("+" + digits)
        seen = set()
        for ph in variants:
            if ph in seen:
                continue
            seen.add(ph)
            try:
                from telethon.tl.functions.contacts import ImportContactsRequest
                from telethon.tl.types import InputPhoneContact
                import random

                result = await client(
                    ImportContactsRequest(
                        [
                            InputPhoneContact(
                                client_id=random.randrange(1, 2**31),
                                phone=ph,
                                first_name="HR",
                                last_name="Call",
                            )
                        ]
                    )
                )
                users = list(getattr(result, "users", []) or [])
                for cand in users:
                    u = await as_user(cand)
                    if u and (int(u.id) == int(target_id) or not target_id):
                        return u
                if users:
                    u = await as_user(users[0])
                    if u:
                        return u
                u = await as_user(await client.get_entity(target_id))
                if u:
                    return u
            except Exception as e:  # noqa: BLE001
                errors.append(f"phone:{ph}:{e}")

    raise ValueError(
        f"Could not resolve PeerUser({target_id}); tried: {'; '.join(errors)[:500]}"
    )


async def prepare_user_for_call(client: TelegramClient, user) -> int:
    """
    RequestCallRequest uchun access_hash kerak.
    Qisqa xabar + get_input_entity — peer cache ni to‘ldiradi.
    """
    from telethon.tl.types import InputPeerUser, User

    if not isinstance(user, User):
        raise ValueError(f"Not a User: {type(user)}")

    try:
        await client.send_message(user, "📞 AI Saydman qo‘ng‘iroq…")
    except Exception as e:  # noqa: BLE001
        log(f"warmup message: {e}")

    peer = await client.get_input_entity(user)
    if not isinstance(peer, InputPeerUser):
        raise ValueError(f"Input peer not user: {type(peer)}")
    if not getattr(peer, "access_hash", None):
        raise ValueError("access_hash empty — user privacy/block?")
    log(f"peer ok user_id={peer.user_id} access_hash={peer.access_hash}")
    return int(peer.user_id)


async def play_file(calls: PyTgCalls, chat_id: int, file_path: str) -> None:
    if not file_path or not os.path.exists(file_path):
        raise FileNotFoundError(file_path)
    await calls.play(chat_id, file_path)
    # Taxminiy davomiylik: fayl size / bitrate yoki fixed wait + stream end
    try:
        size = os.path.getsize(file_path)
        # ~64kbps ≈ 8KB/s
        sec = max(3.0, min(90.0, size / 8000.0 + 1.5))
    except OSError:
        sec = 8.0
    await asyncio.sleep(sec)


async def listen_window(calls: PyTgCalls, chat_id: int, sec: float, out_path: str) -> None:
    """Remote audio yozishga urinadi; bo‘lmasa jim wav."""
    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    recorded = False
    # pytgcalls 3.x da record API farq qilishi mumkin
    for meth in ("start_recording", "record"):
        fn = getattr(calls, meth, None)
        if not callable(fn):
            continue
        try:
            await fn(chat_id, out_path)
            recorded = True
            log(f"recording via {meth}")
            break
        except Exception as e:  # noqa: BLE001
            log(f"{meth} fail: {e}")

    await asyncio.sleep(max(3.0, sec))

    if recorded:
        for meth in ("stop_recording", "stop_record"):
            fn = getattr(calls, meth, None)
            if callable(fn):
                try:
                    await fn(chat_id)
                except Exception as e:  # noqa: BLE001
                    log(f"stop fail: {e}")

    if not os.path.exists(out_path) or os.path.getsize(out_path) < 100:
        # Jim wav (placeholder) — orchestrator STT ni bo‘sh deb ko‘radi
        import wave
        import struct

        with wave.open(out_path, "w") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(16000)
            frames = int(16000 * min(sec, 2))
            w.writeframes(struct.pack("<" + "h" * frames, *([0] * frames)))
        log(f"wrote silent wav {out_path}")


async def run_plan(plan: dict) -> int:
    load_dotenv()
    api_id = int(os.environ.get("TELEGRAM_API_ID") or "0")
    api_hash = (os.environ.get("TELEGRAM_API_HASH") or "").strip()
    session = os.environ.get(
        "TELEGRAM_CALLER_SESSION",
        "/opt/hr_ai/scripts/telegram-caller/caller",
    )
    if not api_id or not api_hash:
        log("API missing")
        return 2

    target_id = int(plan["target_id"])
    username = plan.get("target_username")
    playlist = plan.get("playlist") or []
    listen_only = bool(plan.get("listen_only"))
    listen_out = plan.get("listen_out")
    listen_sec = float(plan.get("listen_sec") or 10)
    hangup_sec = float(plan.get("hangup_sec") or 5)

    client = TelegramClient(session, api_id, api_hash)
    await client.connect()
    if not await client.is_user_authorized():
        log("not authorized")
        await client.disconnect()
        return 2

    me = await client.get_me()
    entity = await resolve_target(
        client, target_id, username, plan.get("phone")
    )
    chat_id = await prepare_user_for_call(client, entity)
    if chat_id == int(me.id):
        log("caller==target")
        await client.disconnect()
        return 5

    calls = PyTgCalls(client)
    await calls.start()
    log(f"call start target={chat_id}")

    try:
        if playlist:
            # Birinchi play — qo‘ng‘iroqni ochadi
            await play_file(calls, chat_id, playlist[0])
            for f in playlist[1:]:
                await play_file(calls, chat_id, f)
        elif listen_only and listen_out:
            # Ring uchun qisqa jim audio
            silent = os.path.join(plan.get("work_dir") or "/tmp", "ring_silent.wav")
            if not os.path.exists(silent):
                import wave
                import struct

                with wave.open(silent, "w") as w:
                    w.setnchannels(1)
                    w.setsampwidth(2)
                    w.setframerate(16000)
                    w.writeframes(struct.pack("<" + "h" * 8000, *([0] * 8000)))
            await play_file(calls, chat_id, silent)

        if listen_out:
            await listen_window(calls, chat_id, listen_sec, listen_out)

        await asyncio.sleep(hangup_sec)
        try:
            await calls.leave_call(chat_id)
        except Exception as e:  # noqa: BLE001
            log(f"leave: {e}")
    finally:
        await client.disconnect()
    log("DONE")
    return 0


async def run_stdin_protocol() -> int:
    load_dotenv()
    api_id = int(os.environ.get("TELEGRAM_API_ID") or "0")
    api_hash = (os.environ.get("TELEGRAM_API_HASH") or "").strip()
    session = os.environ.get(
        "TELEGRAM_CALLER_SESSION",
        "/opt/hr_ai/scripts/telegram-caller/caller",
    )
    client = TelegramClient(session, api_id, api_hash)
    await client.connect()
    if not await client.is_user_authorized():
        print(json.dumps({"ok": False, "error": "not authorized"}), flush=True)
        return 2

    calls = PyTgCalls(client)
    await calls.start()
    chat_id: int | None = None
    print(json.dumps({"ok": True, "event": "ready"}), flush=True)

    loop = asyncio.get_event_loop()
    while True:
        line = await loop.run_in_executor(None, sys.stdin.readline)
        if not line:
            break
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            print(json.dumps({"ok": False, "error": "bad json"}), flush=True)
            continue
        cmd = msg.get("cmd")
        try:
            if cmd == "start":
                ent = await resolve_target(
                    client,
                    int(msg["target_id"]),
                    msg.get("username"),
                    msg.get("phone"),
                )
                chat_id = await prepare_user_for_call(client, ent)
                print(
                    json.dumps(
                        {
                            "ok": True,
                            "event": "started",
                            "chat_id": chat_id,
                            "username": getattr(ent, "username", None),
                        }
                    ),
                    flush=True,
                )
            elif cmd == "play":
                if chat_id is None:
                    raise RuntimeError("not started")
                await play_file(calls, chat_id, msg["file"])
                print(json.dumps({"ok": True, "event": "played"}), flush=True)
            elif cmd == "listen":
                if chat_id is None:
                    raise RuntimeError("not started")
                await listen_window(calls, chat_id, float(msg.get("sec") or 10), msg["out"])
                print(json.dumps({"ok": True, "event": "listened", "out": msg["out"]}), flush=True)
            elif cmd == "hangup":
                if chat_id is not None:
                    try:
                        await calls.leave_call(chat_id)
                    except Exception:  # noqa: BLE001
                        pass
                print(json.dumps({"ok": True, "event": "hungup"}), flush=True)
                break
            else:
                print(json.dumps({"ok": False, "error": "unknown cmd"}), flush=True)
        except Exception as e:  # noqa: BLE001
            print(json.dumps({"ok": False, "error": str(e)}), flush=True)
            traceback.print_exc()

    await client.disconnect()
    return 0


async def main() -> int:
    plan_path = (os.environ.get("TELEGRAM_CALL_PLAN") or "").strip()
    if plan_path:
        with open(plan_path, "r", encoding="utf-8") as f:
            plan = json.load(f)
        return await run_plan(plan)
    if not sys.stdin.isatty():
        return await run_stdin_protocol()
    log("TELEGRAM_CALL_PLAN yoki stdin kerak")
    return 2


if __name__ == "__main__":
    try:
        raise SystemExit(asyncio.run(main()))
    except Exception:
        traceback.print_exc()
        raise SystemExit(1)
