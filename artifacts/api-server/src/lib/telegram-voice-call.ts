/**
 * Telegram haqiqiy ovozli qo‘ng‘iroq — o‘z userbot (Telethon + py-tgcalls).
 * Bot API qo‘ng‘iroq qila olmaydi; user akkaunt (MTProto) kerak.
 *
 * Env:
 *   TELEGRAM_API_ID / TELEGRAM_API_HASH  — my.telegram.org
 *   TELEGRAM_CALLER_SESSION               — session path (default scripts/telegram-caller/caller)
 *   TELEGRAM_CALL_TARGET_ID               — default Said: 5222899144
 *   TELEGRAM_CALL_AUDIO                   — mp3/ogg path yoki URL (ixtiyoriy)
 *   TELEGRAM_CALLER_BIN                   — python script override
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";

const DEFAULT_TARGET = "5222899144";

/** PM2 ba’zan .env ni tortmaydi — kerakli kalitlarni to‘ldiramiz */
function ensureHrEnvLoaded() {
  if (process.env.GEMINI_API_KEY || process.env.TELEGRAM_API_ID) return;
  const candidates = ["/opt/hr_ai/.env", path.resolve(process.cwd(), "../../.env"), path.resolve(process.cwd(), ".env")];
  for (const file of candidates) {
    try {
      if (!fs.existsSync(file)) continue;
      for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
        const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
        if (!m) continue;
        let v = m[2].trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
          v = v.slice(1, -1);
        }
        if (!process.env[m[1]]) process.env[m[1]] = v;
      }
      break;
    } catch {
      /* */
    }
  }
}
ensureHrEnvLoaded();

export type TelegramVoiceCallOpts = {
  /** Telegram user id (raqam) */
  targetId?: string | number;
  /** Qo‘ng‘iroqda o‘ynatiladigan audio (mp3/ogg path|URL) */
  audioPath?: string;
  /** Matn — audio bo‘lmasa Gemini TTS bilan mp3 yasash uchun */
  speechText?: string;
  timeoutMs?: number;
};

export type TelegramVoiceCallResult = {
  ok: boolean;
  summary: string;
  stdout: string;
  stderr: string;
};

export function tashkentTimeCallSpeech(now = new Date()): { clock: string; speech: string } {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Tashkent",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  const clock = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  const speech = [
    `Assalomu alaykum, Saidmuhammadalixon.`,
    `Hozir Toshkent vaqti: soat ${hour}, ${minute} daqiqa.`,
    `Takrorlayman: ${hour} soat ${minute} daqiqa.`,
  ].join(" ");
  return { clock, speech };
}

function callerScriptPath(): string {
  const override = process.env.TELEGRAM_CALLER_BIN?.trim();
  if (override) return override;
  return "/opt/hr_ai/scripts/telegram-caller/call_said.py";
}

function sessionReady(): boolean {
  const session =
    process.env.TELEGRAM_CALLER_SESSION?.trim() || "/opt/hr_ai/scripts/telegram-caller/caller";
  return fs.existsSync(`${session}.session`) || fs.existsSync(session);
}

export function telegramCallerConfigured(): boolean {
  const id = Number(process.env.TELEGRAM_API_ID || 0);
  const hash = process.env.TELEGRAM_API_HASH?.trim();
  return Boolean(id && hash && sessionReady());
}

function ffmpegToMp3(inputPath: string, mp3Path: string, extraInArgs: string[] = []): Promise<void> {
  return new Promise((resolve, reject) => {
    const ff = spawn(
      "ffmpeg",
      ["-y", ...extraInArgs, "-i", inputPath, "-codec:a", "libmp3lame", "-qscale:a", "5", mp3Path],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    let err = "";
    ff.stderr?.on("data", (d) => {
      err += String(d);
    });
    ff.on("error", reject);
    ff.on("close", (code) => (code === 0 ? resolve() : reject(new Error(err.slice(0, 240)))));
  });
}

export type CallVoiceGender = "male" | "female";

/** Erkak: Orus (aniq/qattiq); ayol: Erinome (clear) — env bilan override */
export function resolveCallVoice(gender: CallVoiceGender = "female"): string {
  if (gender === "male") {
    return process.env.GEMINI_TTS_VOICE_MALE?.trim() || process.env.GEMINI_TTS_VOICE?.trim() || "Orus";
  }
  return process.env.GEMINI_TTS_VOICE_FEMALE?.trim() || process.env.GEMINI_TTS_VOICE?.trim() || "Erinome";
}

function uzbekSpeechPrompt(text: string): string {
  return [
    "Siz sof o‘zbek tilida gapiradigan diktor siz.",
    "Quyidagi matnni so‘zma-so‘z, sekin, aniq va xatosiz o‘qing.",
    "Tarjima qilmang, so‘z qo‘shmang, qisqartirmang, boshqa tilga o‘tmang.",
    "Talaffuz: to‘liq o‘zbek lotin yozuvi, har bir so‘z tushunarli.",
    "Matn:",
    text,
  ].join("\n");
}

/** Gemini TTS — sof o‘zbek, erkak/ayol ovoz */
async function synthesizeGeminiMp3(
  text: string,
  voiceName: string,
): Promise<string | null> {
  const key =
    process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_AI_API_KEY?.trim() || "";
  if (!key) return null;
  const model = process.env.GEMINI_TTS_MODEL?.trim() || "gemini-2.5-flash-preview-tts";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(55_000),
    body: JSON.stringify({
      contents: [{ parts: [{ text: uzbekSpeechPrompt(text) }] }],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
      },
    }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    console.error("synthesizeGeminiMp3 HTTP", res.status, errText.slice(0, 200));
    return null;
  }
  const body = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data?: string; mimeType?: string } }> } }>;
  };
  const part = body.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
  const b64 = part?.inlineData?.data;
  if (!b64) return null;

  const id = randomBytes(6).toString("hex");
  const rawPath = path.join(os.tmpdir(), `tg-call-raw-${id}`);
  const mp3Path = path.join(os.tmpdir(), `tg-call-${id}.mp3`);
  fs.writeFileSync(rawPath, Buffer.from(b64, "base64"));
  try {
    await ffmpegToMp3(rawPath, mp3Path, ["-f", "s16le", "-ar", "24000", "-ac", "1"]).catch(() =>
      ffmpegToMp3(rawPath, mp3Path),
    );
  } finally {
    try {
      fs.unlinkSync(rawPath);
    } catch {
      /* */
    }
  }
  return fs.existsSync(mp3Path) ? mp3Path : null;
}

/** gTTS zaxira — faqat Gemini ishlamasa (tr lotin o‘zbek uchun eng yaqin) */
async function synthesizeGttsMp3(text: string): Promise<string | null> {
  const id = randomBytes(6).toString("hex");
  const mp3Path = path.join(os.tmpdir(), `tg-call-gtts-${id}.mp3`);
  const py =
    process.env.TELEGRAM_CALLER_PYTHON?.trim() ||
    (fs.existsSync("/opt/hr_ai/scripts/telegram-caller/.venv/bin/python")
      ? "/opt/hr_ai/scripts/telegram-caller/.venv/bin/python"
      : "python3");
  const script = `
from gtts import gTTS
import sys
text = sys.argv[1]
out = sys.argv[2]
for lang in ("tr", "ru"):
    try:
        gTTS(text=text, lang=lang, slow=True).save(out)
        print("ok", lang)
        raise SystemExit(0)
    except Exception as e:
        print(lang, e, file=sys.stderr)
raise SystemExit(1)
`.trim();
  const r = await new Promise<{ code: number }>((resolve) => {
    const child = spawn(py, ["-c", script, text.slice(0, 400), mp3Path], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.on("close", (code) => resolve({ code: code ?? 1 }));
    child.on("error", () => resolve({ code: 1 }));
  });
  return r.code === 0 && fs.existsSync(mp3Path) ? mp3Path : null;
}

export type SynthesizeCallOpts = {
  voice?: CallVoiceGender;
};

/** Yozilgan matnni MP3 ga aylantiradi (Gemini sof o‘zbek → gTTS zaxira) */
export async function synthesizeCallMp3(
  text: string,
  opts: SynthesizeCallOpts = {},
): Promise<string | null> {
  const clean = String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1200);
  if (!clean) return null;
  const gender: CallVoiceGender = opts.voice === "male" ? "male" : "female";
  const voiceName = resolveCallVoice(gender);
  for (let i = 0; i < 2; i++) {
    if (i) await new Promise((r) => setTimeout(r, 1200 * i));
    const gemini = await synthesizeGeminiMp3(clean, voiceName);
    if (gemini) return gemini;
  }
  const gtts = await synthesizeGttsMp3(clean);
  if (gtts) return gtts;
  console.error("synthesizeCallMp3: barcha TTS yo‘llari muvaffaqiyatsiz", { voiceName, gender });
  return null;
}

function runPython(env: NodeJS.ProcessEnv, timeoutMs: number): Promise<{ code: number; stdout: string; stderr: string }> {
  const script = callerScriptPath();
  return new Promise((resolve, reject) => {
    const child = spawn("python3", [script], {
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const t = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("userbot call timeout"));
    }, timeoutMs);
    child.stdout?.on("data", (d) => {
      stdout += String(d);
    });
    child.stderr?.on("data", (d) => {
      stderr += String(d);
    });
    child.on("error", (e) => {
      clearTimeout(t);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(t);
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

/** O‘z userbot orqali P2P qo‘ng‘iroq */
export async function placeTelegramVoiceCall(opts: TelegramVoiceCallOpts = {}): Promise<TelegramVoiceCallResult> {
  if (!telegramCallerConfigured()) {
    return {
      ok: false,
      summary:
        "Userbot sozlanmagan: TELEGRAM_API_ID, TELEGRAM_API_HASH va session (login_once.py) kerak",
      stdout: "",
      stderr: "",
    };
  }

  const { speech } = tashkentTimeCallSpeech();
  let audio = opts.audioPath || process.env.TELEGRAM_CALL_AUDIO?.trim() || "";
  if (!audio && (opts.speechText || speech)) {
    audio = (await synthesizeCallMp3(opts.speechText || speech)) || "";
  }

  const target = String(opts.targetId || process.env.TELEGRAM_CALL_TARGET_ID || DEFAULT_TARGET);
  const run = await runPython(
    {
      TELEGRAM_CALL_TARGET_ID: target,
      TELEGRAM_CALL_AUDIO: audio,
      TELEGRAM_CALL_HANGUP_SEC: process.env.TELEGRAM_CALL_HANGUP_SEC || "35",
    },
    opts.timeoutMs ?? 90_000,
  );

  const ok = run.code === 0;
  return {
    ok,
    summary: ok ? "Qo‘ng‘iroq yuborildi" : (run.stderr || run.stdout || `exit ${run.code}`).slice(0, 400),
    stdout: run.stdout.slice(0, 4000),
    stderr: run.stderr.slice(0, 4000),
  };
}
