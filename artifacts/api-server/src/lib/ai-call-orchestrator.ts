/**
 * AI qo‘ng‘iroq orchestrator — bitta P2P chaqiruvda stdin protokol bilan suhbat.
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import readline from "node:readline";
import {
  getAiCallJob,
  insertAiCallLog,
  nextDailyScheduledAt,
  updateAiCallJob,
  type AiCallJob,
} from "./ai-call-jobs";
import { buildHelpSystemPrompt, loadPlatformHelpKnowledge } from "./platform-help-kb";
import { logger } from "./logger";
import { synthesizeCallMp3, telegramCallerConfigured } from "./telegram-voice-call";
import { pool } from "@workspace/db";

export type TranscriptTurn = { role: "assistant" | "user" | "system"; text: string };

// telegram-voice-call ensureHrEnvLoaded side-effect

const lock = { running: false };

/** Bot API getChat + DB — Telethon uchun username/telefon */
async function resolveTargetContact(job: {
  targetTelegramId: string;
  targetUserId: number | null;
}): Promise<{ username: string | null; phone: string | null }> {
  let username: string | null = null;
  let phone: string | null = null;

  if (job.targetUserId) {
    try {
      const { rows } = await pool.query(`SELECT phone FROM users WHERE id = $1 LIMIT 1`, [
        job.targetUserId,
      ]);
      if (rows[0]?.phone) phone = String(rows[0].phone);
    } catch {
      /* */
    }
  }

  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (token) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/getChat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: Number(job.targetTelegramId) }),
        signal: AbortSignal.timeout(15_000),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        result?: { username?: string };
      };
      if (json.ok && json.result?.username) {
        username = String(json.result.username);
      }
    } catch {
      /* bot chat ochmagan bo‘lishi mumkin */
    }
  }

  return { username, phone };
}

function venvPython(): string {
  const override = process.env.TELEGRAM_CALLER_PYTHON?.trim();
  if (override) return override;
  const venv = "/opt/hr_ai/scripts/telegram-caller/.venv/bin/python";
  if (fs.existsSync(venv)) return venv;
  return "python3";
}

function conversationalScript(): string {
  return (
    process.env.TELEGRAM_CONV_CALLER_BIN?.trim() ||
    "/opt/hr_ai/scripts/telegram-caller/conversational_call.py"
  );
}

function listenSec(): number {
  return Math.min(20, Math.max(5, Number(process.env.AI_CALL_LISTEN_SEC) || 10));
}

function aiCallsEnabled(): boolean {
  return process.env.AI_CALL_ENABLED !== "0";
}

type RpcReply = { ok?: boolean; event?: string; error?: string; out?: string };

class ConvCaller {
  private child: ChildProcessWithoutNullStreams;
  private rl: readline.Interface;
  private queue: Array<(v: RpcReply) => void> = [];

  constructor() {
    this.child = spawn(venvPython(), [conversationalScript()], {
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.rl = readline.createInterface({ input: this.child.stdout });
    this.rl.on("line", (line) => {
      try {
        const msg = JSON.parse(line) as RpcReply;
        const cb = this.queue.shift();
        if (cb) cb(msg);
      } catch {
        /* ignore non-json logs */
      }
    });
    this.child.stderr.on("data", (d) => {
      logger.warn({ err: String(d).slice(0, 300) }, "conv-caller stderr");
    });
  }

  private send(obj: Record<string, unknown>, timeoutMs = 90_000): Promise<RpcReply> {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        reject(new Error("conv caller timeout"));
      }, timeoutMs);
      this.queue.push((msg) => {
        clearTimeout(t);
        resolve(msg);
      });
      this.child.stdin.write(JSON.stringify(obj) + "\n");
    });
  }

  async waitReady(): Promise<void> {
    // first line should be ready — also allow stderr noise before
    const msg = await new Promise<RpcReply>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("ready timeout")), 60_000);
      this.queue.push((m) => {
        clearTimeout(t);
        resolve(m);
      });
    });
    if (!msg.ok) throw new Error(msg.error || "not ready");
  }

  start(targetId: number, username?: string | null, phone?: string | null) {
    return this.send({
      cmd: "start",
      target_id: targetId,
      username: username || null,
      phone: phone || null,
    });
  }

  play(file: string) {
    return this.send({ cmd: "play", file }, 120_000);
  }

  listen(sec: number, out: string) {
    return this.send({ cmd: "listen", sec, out }, (sec + 30) * 1000);
  }

  hangup() {
    return this.send({ cmd: "hangup" }, 30_000).catch(() => ({ ok: true }));
  }

  kill() {
    try {
      this.child.kill("SIGTERM");
    } catch {
      /* */
    }
  }
}

async function sttFromAudioFile(filePath: string): Promise<string> {
  const key = process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_AI_API_KEY?.trim() || "";
  if (!key || !fs.existsSync(filePath) || fs.statSync(filePath).size < 400) return "";
  // Jim wav (~64KB for 2s) — skip
  const raw = fs.readFileSync(filePath);
  // Agar deyarli jim bo‘lsa (wav header + zeros)
  const sample = raw.subarray(44, Math.min(raw.length, 2000));
  const nonzero = [...sample].filter((b) => b !== 0).length;
  if (nonzero < 8) return "";

  const mime = filePath.endsWith(".mp3")
    ? "audio/mpeg"
    : filePath.endsWith(".ogg")
      ? "audio/ogg"
      : "audio/wav";
  const model = process.env.GEMINI_MODEL?.trim() || "gemini-2.0-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(55_000),
    body: JSON.stringify({
      contents: [
        {
          parts: [
            {
              text: "Audio o‘zbekcha/ruscha gapni aniq matnga aylantir. Faqat transcript, boshqa izoh yo‘q.",
            },
            { inline_data: { mime_type: mime, data: raw.toString("base64") } },
          ],
        },
      ],
    }),
  });
  if (!res.ok) return "";
  const body = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  return (body.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "").trim();
}

async function platformAnswer(userText: string, targetName: string | null): Promise<string> {
  const key = process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_AI_API_KEY?.trim() || "";
  if (!key) {
    return "Hozir AI javob berolmayapti. Platforma yordamida @vaksinahrbot ga yozing.";
  }
  const system = [
    buildHelpSystemPrompt({
      fullName: targetName || undefined,
      detailed: false,
      accountLinked: true,
    }),
    "",
    "=== TELEFON SUHBATI QOIDALARI ===",
    "Sen telefonda gapiryapsan. Javob 1–3 qisqa jumla, o‘zbekcha, aniq.",
    "FAQAT vaksinahr.uz / SoftMode HR platformasi haqida.",
    "Oylik, shtraf, shaxsiy HR, smena o‘zgartirish — telefonda yechma; bot yoki platformaga yo‘naltir.",
    "Mavzu platformaga tegishli bo‘lmasa: qisqa rad et va botga yozishni ayt.",
    loadPlatformHelpKnowledge().slice(0, 12_000),
  ].join("\n");

  const model = process.env.GEMINI_MODEL?.trim() || "gemini-2.0-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(45_000),
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: userText.slice(0, 800) }] }],
      generationConfig: { temperature: 0.4, maxOutputTokens: 220 },
    }),
  });
  if (!res.ok) return "Javob ololmading. Iltimos, @vaksinahrbot ga yozing.";
  const body = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = (body.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "").trim();
  return text || "Tushunmadim. Savolingizni qisqaroq ayting yoki botga yozing.";
}

async function finishJob(
  job: AiCallJob,
  outcome: "done" | "failed",
  transcript: TranscriptTurn[],
  err?: string,
) {
  await insertAiCallLog(job.id, outcome, transcript);
  if (job.recurrence === "daily" && job.dailyTime && outcome === "done") {
    const next = nextDailyScheduledAt(job.dailyTime, new Date());
    await updateAiCallJob(job.id, {
      status: "pending",
      scheduledAt: next,
      lastError: null,
      enabled: true,
    });
  } else {
    await updateAiCallJob(job.id, { status: outcome, lastError: err ?? null });
  }
}

export async function runAiCallJob(jobId: number): Promise<{ ok: boolean; summary: string }> {
  if (!aiCallsEnabled()) return { ok: false, summary: "AI_CALL_ENABLED=0" };
  if (!telegramCallerConfigured()) return { ok: false, summary: "Userbot sozlanmagan" };
  if (lock.running) return { ok: false, summary: "Boshqa qo‘ng‘iroq band" };

  lock.running = true;
  const transcript: TranscriptTurn[] = [];
  const workDir = path.join(os.tmpdir(), `ai-call-${jobId}-${randomBytes(3).toString("hex")}`);
  fs.mkdirSync(workDir, { recursive: true });
  let caller: ConvCaller | null = null;

  try {
    const job = await getAiCallJob(jobId);
    if (!job) return { ok: false, summary: "Job topilmadi" };

    // Ochilish matni — admin yozgan matn aynan o‘qiladi
    const opening = job.openScript.trim();
    const askHint = job.conversational
      ? " Savolingizni ayting. Men tinglayman. Faqat vaksinahr platformasi haqida so‘rang."
      : "";
    const openingSpeech = `${opening}${askHint}`.trim();
    transcript.push({ role: "assistant", text: openingSpeech });

    const voice = job.voice === "male" ? "male" : "female";
    let openMp3: string | null = null;
    for (let i = 0; i < 3 && !openMp3; i++) {
      if (i) await new Promise((r) => setTimeout(r, 3000 * i));
      openMp3 = await synthesizeCallMp3(openingSpeech, { voice });
    }
    if (!openMp3) {
      await finishJob(job, "failed", transcript, "TTS ochilish muvaffaqiyatsiz (matn o‘qilmadi)");
      return { ok: false, summary: "TTS fail" };
    }

    const contact = await resolveTargetContact(job);
    caller = new ConvCaller();
    await caller.waitReady();
    const start = await caller.start(
      Number(job.targetTelegramId),
      contact.username,
      contact.phone,
    );
    if (!start.ok) {
      throw new Error(
        start.error ||
          `start fail (tg=${job.targetTelegramId}, @${contact.username || "—"}, phone=${contact.phone || "—"})`,
      );
    }

    const played = await caller.play(openMp3);
    if (!played.ok) throw new Error(played.error || "play opening fail");

    if (!job.conversational) {
      await caller.hangup();
      await finishJob(job, "done", transcript);
      return { ok: true, summary: "Announcement done" };
    }

    for (let turn = 1; turn <= job.maxTurns; turn++) {
      const listenFile = path.join(workDir, `listen_${turn}.wav`);
      await caller.listen(listenSec(), listenFile);
      let userText = await sttFromAudioFile(listenFile);
      if (!userText) {
        const miss =
          "Sizni aniq eshitmadim. Savolingizni @vaksinahrbot ga yozing yoki yana qisqa ayting.";
        transcript.push({ role: "assistant", text: miss });
        const missMp3 = await synthesizeCallMp3(miss, { voice });
        if (missMp3) await caller.play(missMp3);
        // Bitta qayta urinish
        if (turn === 1) {
          await caller.listen(listenSec(), listenFile);
          userText = await sttFromAudioFile(listenFile);
        }
        if (!userText) break;
      }

      transcript.push({ role: "user", text: userText });
      const answer = await platformAnswer(userText, job.targetName);
      transcript.push({ role: "assistant", text: answer });
      const ansMp3 = await synthesizeCallMp3(answer, { voice });
      if (!ansMp3) break;
      await caller.play(ansMp3);

      if (/rahmat|tushundim|hammasi|bye|xayr/i.test(userText)) break;

      if (turn < job.maxTurns) {
        const again = await synthesizeCallMp3("Yana savol bo‘lsa ayting, aks holda xayr.", { voice });
        if (again) await caller.play(again);
      }
    }

    await caller.hangup();
    await finishJob(job, "done", transcript);
    return { ok: true, summary: "Conversational call finished" };
  } catch (err) {
    logger.error({ err, jobId }, "runAiCallJob");
    const job = await getAiCallJob(jobId);
    if (job) await finishJob(job, "failed", transcript, String(err).slice(0, 400));
    return { ok: false, summary: String(err).slice(0, 200) };
  } finally {
    caller?.kill();
    lock.running = false;
    try {
      fs.rmSync(workDir, { recursive: true, force: true });
    } catch {
      /* */
    }
  }
}

export function isAiCallBusy(): boolean {
  return lock.running;
}
