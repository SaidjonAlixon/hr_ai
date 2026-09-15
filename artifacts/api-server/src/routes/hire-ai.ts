import { Router, type IRouter } from "express";
import { db, tasksTable } from "@workspace/db";
import { requireAuth, type AuthRequest } from "../middlewares/auth";
import { isDirectorRole, isHrRole } from "../lib/roles";
import { notifyUser } from "../lib/notify";

const router: IRouter = Router();

const HIRE_MODEL = process.env.OPENAI_HIRE_MODEL?.trim() || process.env.OPENAI_HELP_MODEL?.trim() || "gpt-4o-mini";
const HIRE_TIMEOUT_MS = Number(process.env.HIRE_AI_TIMEOUT_MS || 25000);
const HIRE_AI_ENABLED = process.env.HIRE_AI !== "0" && process.env.HIRE_AI !== "false";

const recentByUser = new Map<number, number[]>();

function canUseHireAi(role?: string | null): boolean {
  const r = (role ?? "").trim().toLowerCase();
  return (
    r === "admin" ||
    r === "recruiter" ||
    r === "trainer" ||
    isHrRole(r) ||
    isDirectorRole(r)
  );
}

function rateLimited(userId: number): boolean {
  const now = Date.now();
  const prev = (recentByUser.get(userId) || []).filter((t) => now - t < 60_000);
  if (prev.length >= 12) {
    recentByUser.set(userId, prev);
    return true;
  }
  prev.push(now);
  recentByUser.set(userId, prev);
  return false;
}

type AiFillKind = "vacancy" | "request" | "candidate";

type AiFillResult = {
  description: string;
  requirements: string;
  schedule?: string;
  benefits?: string;
  notes?: string;
  interviewQuestions?: string;
  tasks: { title: string; description: string }[];
};

function fallbackFill(kind: AiFillKind, position: string): AiFillResult {
  const pos = position.trim() || "Lavozim";
  const description =
    kind === "candidate"
      ? `${pos} lavozimi uchun nomzodni baholash:\n• Tajriba va kompetentsiyalar\n• Madaniyatga moslik\n• Natijadorlik va o‘rganishga ochiqlik`
      : `${pos} lavozimida asosiy vazifalar:\n• Kundalik ishlarni sifatli bajarish\n• Jamoa bilan muvofiqlashish\n• Ichki tartib va standartlarga rioya qilish\n• Hisobot va natijalarni taqdim etish`;
  const requirements = `Talablar (${pos}):\n• Tegishli tajriba yoki o‘xshash sohada ishlash\n• Mas’uliyat va kommunikatsiya\n• O‘zbek / rus tili\n• Kompyuter savodxonligi`;
  return {
    description,
    requirements,
    schedule: "To‘liq ish kuni, 09:00 – 18:00",
    benefits: "Rasmiy ish, o‘sish imkoniyati, jamoa",
    notes: `${pos} bo‘yicha qisqa reja: aloqa → suhbat → qaror.`,
    interviewQuestions: `1. ${pos} da qanday tajribangiz bor?\n2. Eng qiyin vazifani qanday yechgansiz?\n3. Nima uchun VAKSINA MED?\n4. Kutilayotgan maosh va ish grafigi?\n5. Qachon ishga chiqa olasiz?`,
    tasks: [
      {
        title: `${pos} — nomzodlar qidiruvi`,
        description: "Kanallar orqali mos nomzodlarni topish va birinchi aloqa.",
      },
      {
        title: `${pos} — suhbatni rejalashtirish`,
        description: "Mos nomzodlar bilan suhbat vaqtini belgilash va natijani yozish.",
      },
      {
        title: `${pos} — yakuniy qaror`,
        description: "Qabul / rad qarorini qayd etish va HR ga xabar berish.",
      },
    ],
  };
}

async function openaiFill(kind: AiFillKind, position: string, context?: string): Promise<AiFillResult> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key || !HIRE_AI_ENABLED) {
    return fallbackFill(kind, position);
  }

  const system = `Siz VAKSINA MED dorixona tarmog‘i HR yordamchisisiz.
O‘zbek tilida qisqa, aniq, professional matn yozing.
Faqat JSON qaytaring, boshqa matn yo‘q.
Format:
{
  "description": "string",
  "requirements": "string",
  "schedule": "string",
  "benefits": "string",
  "notes": "string",
  "interviewQuestions": "string",
  "tasks": [{"title":"string","description":"string"}]
}
tasks — 2..4 ta rekruter vazifasi. description/requirements — bullet nuqtalar bilan.`;

  const user =
    kind === "candidate"
      ? `Nomzodni ${position} lavozimiga tayyorlash. Suhbat savollari, izoh va rekruter vazifalarini bering.${context ? `\nKontekst: ${context}` : ""}`
      : kind === "request"
        ? `Ishga olish arizasi: lavozim «${position}». Vazifalar (description) va talablar (requirements) yozing.${context ? `\nKontekst: ${context}` : ""}`
        : `Vakansiya: lavozim «${position}». Tavsif, talablar, grafik, imtiyozlar va rekruter vazifalarini yozing.${context ? `\nKontekst: ${context}` : ""}`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), HIRE_TIMEOUT_MS);
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: HIRE_MODEL,
        temperature: 0.4,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    if (!res.ok) {
      console.error("hire-ai openai", res.status, await res.text().catch(() => ""));
      return fallbackFill(kind, position);
    }
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const raw = data.choices?.[0]?.message?.content || "";
    const parsed = JSON.parse(raw) as Partial<AiFillResult>;
    const fb = fallbackFill(kind, position);
    const tasks = Array.isArray(parsed.tasks)
      ? parsed.tasks
          .filter((t) => t && typeof t.title === "string" && t.title.trim())
          .map((t) => ({
            title: String(t.title).trim().slice(0, 200),
            description: String(t.description || "").trim().slice(0, 2000),
          }))
          .slice(0, 5)
      : fb.tasks;
    return {
      description: String(parsed.description || fb.description).trim(),
      requirements: String(parsed.requirements || fb.requirements).trim(),
      schedule: String(parsed.schedule || fb.schedule || "").trim() || undefined,
      benefits: String(parsed.benefits || fb.benefits || "").trim() || undefined,
      notes: String(parsed.notes || fb.notes || "").trim() || undefined,
      interviewQuestions:
        String(parsed.interviewQuestions || fb.interviewQuestions || "").trim() || undefined,
      tasks: tasks.length ? tasks : fb.tasks,
    };
  } catch (err) {
    console.error("hire-ai", err);
    return fallbackFill(kind, position);
  } finally {
    clearTimeout(timer);
  }
}

router.post("/hire/ai-fill", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!canUseHireAi(req.userRole)) {
    res.status(403).json({ error: "Ruxsat yo‘q" });
    return;
  }
  if (!req.userId || rateLimited(req.userId)) {
    res.status(429).json({ error: "Juda ko‘p so‘rov — birozdan keyin qayta urinib ko‘ring" });
    return;
  }

  const kindRaw = String(req.body?.kind || "vacancy").toLowerCase();
  const kind: AiFillKind =
    kindRaw === "request" || kindRaw === "candidate" ? kindRaw : "vacancy";
  const position = String(req.body?.position || "").trim();
  if (!position) {
    res.status(400).json({ error: "Lavozim (position) majburiy" });
    return;
  }
  const context = typeof req.body?.context === "string" ? req.body.context.trim().slice(0, 1500) : "";
  const createTasks = req.body?.createTasks !== false;
  const assigneeIdRaw = req.body?.assigneeId;
  const assigneeId =
    assigneeIdRaw != null && assigneeIdRaw !== ""
      ? parseInt(String(assigneeIdRaw), 10)
      : req.userId!;

  const fill = await openaiFill(kind, position, context || undefined);

  const createdTaskIds: number[] = [];
  if (createTasks && Number.isFinite(assigneeId) && assigneeId > 0 && fill.tasks.length) {
    const due = new Date();
    due.setDate(due.getDate() + 3);
    for (const t of fill.tasks) {
      const [row] = await db
        .insert(tasksTable)
        .values({
          title: t.title,
          description: t.description || null,
          status: "todo",
          priority: "normal",
          dueAt: due,
          assigneeKind: "user",
          assigneeId,
          createdById: req.userId!,
          // candidateId qo‘ymaymiz — pipeline filtri Vazifalar doskasidan yashirmasin
          meta: {
            source: "hire_ai",
            kind,
            position,
            hireCandidateId:
              req.body?.candidateId != null ? Number(req.body.candidateId) : undefined,
          },
        })
        .returning({ id: tasksTable.id });
      if (row) createdTaskIds.push(row.id);
      if (assigneeId !== req.userId) {
        await notifyUser({
          userId: assigneeId,
          text: `Sizga yangi vazifa: «${t.title}» — AI tayyorladi`,
          type: "expired_task",
          linkUrl: `/vazifalar?task=${row.id}`,
          title: "Yangi vazifa",
        });
      }
    }
  }

  res.json({
    ...fill,
    createdTaskIds,
    aiEnabled: Boolean(process.env.OPENAI_API_KEY?.trim()) && HIRE_AI_ENABLED,
  });
});

export default router;
