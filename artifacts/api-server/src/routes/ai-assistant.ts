/**
 * Yordamchi AI — admin bo‘limi API.
 * Taklifni tasdiqlash = amal bajariladi + xodimga Telegramdan yakuniy javob ketadi.
 * Rad etish = amal bajarilmaydi, suhbat davom etadi (xodimga qo‘shimcha so‘rov ketadi).
 */
import { Router, type IRouter, type Response } from "express";
import { and, desc, eq } from "drizzle-orm";
import {
  pool,
  db,
  usersTable,
  employeesTable,
  attendanceRecordsTable,
  attestatsiyaAttemptsTable,
} from "@workspace/db";
import { requireAuth, type AuthRequest } from "../middlewares/auth";
import { ensureAiAssistantSchema, sendAssistantFollowUp } from "../lib/ai-assistant";
import { notifyByRoles } from "../lib/notify";

const router: IRouter = Router();

/** Yordamchi AI — FAQAT admin (direktor/asoschi ham kira olmaydi) */
function requireAdmin(req: AuthRequest, res: Response): boolean {
  if ((req.userRole || "") !== "admin") {
    res.status(403).json({ error: "Faqat admin" });
    return false;
  }
  return true;
}

type ProposalRow = {
  id: number;
  conversation_id: number;
  platform_user_id: number | null;
  kind: string;
  title: string;
  summary: string;
  payload: Record<string, unknown>;
  status: string;
  decided_by_id: number | null;
  decided_at: string | null;
  decision_note: string | null;
  execution_result: string | null;
  created_at: string;
  display_name: string | null;
  username: string | null;
  telegram_chat_id: string;
  user_full_name: string | null;
  user_role: string | null;
};

const PROPOSAL_SELECT = `
  SELECT p.*, c.display_name, c.username, c.telegram_chat_id,
         u.full_name AS user_full_name, u.role AS user_role
  FROM ai_assistant_proposals p
  JOIN ai_assistant_conversations c ON c.id = p.conversation_id
  LEFT JOIN users u ON u.id = p.platform_user_id
`;

router.get("/ai-assistant/overview", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  await ensureAiAssistantSchema();
  const proposals = await pool.query<ProposalRow>(
    `${PROPOSAL_SELECT} ORDER BY CASE WHEN p.status='pending' THEN 0 ELSE 1 END, p.created_at DESC LIMIT 100`,
  );
  const convs = await pool.query(
    `SELECT c.*, u.full_name AS user_full_name,
            (SELECT COUNT(*) FROM ai_assistant_proposals p WHERE p.conversation_id = c.id AND p.status='pending') AS pending_count
     FROM ai_assistant_conversations c
     LEFT JOIN users u ON u.id = c.platform_user_id
     ORDER BY c.updated_at DESC LIMIT 50`,
  );
  res.json({
    aiEnabled: process.env.AI_ASSISTANT_ENABLED !== "0" && Boolean(process.env.OPENAI_API_KEY?.trim()),
    proposals: proposals.rows,
    conversations: convs.rows,
  });
});

router.get("/ai-assistant/conversations/:id/messages", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  await ensureAiAssistantSchema();
  const id = Number(req.params.id);
  const { rows } = await pool.query(
    `SELECT * FROM ai_assistant_messages WHERE conversation_id = $1 ORDER BY id ASC LIMIT 200`,
    [id],
  );
  res.json({ messages: rows });
});

/* ------------------------------------------------------------ ijrochilar */

async function executeProposal(p: ProposalRow): Promise<string> {
  const payload = p.payload || {};
  const userId = p.platform_user_id ?? (Number(payload.userId) || null);

  if (p.kind === "atestatsiya_retake") {
    if (!userId) throw new Error("Xodim aniqlanmagan — avval xodimni bog‘lang");
    const examId = Number(payload.examId) || null;
    const attempts = await db
      .select()
      .from(attestatsiyaAttemptsTable)
      .where(eq(attestatsiyaAttemptsTable.userId, userId))
      .orderBy(desc(attestatsiyaAttemptsTable.startedAt));
    const target =
      (examId ? attempts.find((a) => a.examId === examId) : undefined) ??
      attempts.find((a) => a.passed === false) ??
      attempts[0];
    if (!target) return "Urinish topilmadi — test hali boshlanmagan, xodim testni odatdagidek boshlay oladi.";
    if (target.passed === true) throw new Error("Xodim bu testdan o‘tgan — qayta ochish kerak emas");
    await db
      .update(attestatsiyaAttemptsTable)
      .set({ retakeAllowed: true, retakeGrantedById: null, retakeGrantedAt: new Date(), updatedAt: new Date() })
      .where(eq(attestatsiyaAttemptsTable.id, target.id));
    return `Atestatsiya qayta topshirish ochildi (urinish #${target.id}).`;
  }

  if (p.kind === "davomat_fix") {
    if (!userId) throw new Error("Xodim aniqlanmagan — avval xodimni bog‘lang");
    const workDate = String(payload.workDate || "").trim();
    const checkIn = payload.checkInAt ? new Date(String(payload.checkInAt)) : null;
    const checkOut = payload.checkOutAt ? new Date(String(payload.checkOutAt)) : null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate) || (!checkIn && !checkOut)) {
      throw new Error(
        "Davomat tuzatish uchun sana va vaqtlar yetarli emas — Davomat bo‘limida qo‘lda tuzating, bu taklifni yoping.",
      );
    }
    const [emp] = await db
      .select({ id: employeesTable.id })
      .from(employeesTable)
      .where(eq(employeesTable.userId, userId))
      .limit(1);
    if (!emp) throw new Error("Xodim kartochkasi (employee) topilmadi");
    const [existing] = await db
      .select()
      .from(attendanceRecordsTable)
      .where(and(eq(attendanceRecordsTable.employeeId, emp.id), eq(attendanceRecordsTable.workDate, workDate)))
      .limit(1);
    const note = `Yordamchi AI #${p.id}: admin tasdiqladi. ${String(payload.note || p.summary).slice(0, 300)}`;
    if (existing) {
      await db
        .update(attendanceRecordsTable)
        .set({
          checkInAt: checkIn ?? existing.checkInAt,
          checkOutAt: checkOut ?? existing.checkOutAt,
          source: "manual",
          notes: note,
          updatedAt: new Date(),
        })
        .where(eq(attendanceRecordsTable.id, existing.id));
    } else {
      await db.insert(attendanceRecordsTable).values({
        employeeId: emp.id,
        userId,
        workDate,
        checkInAt: checkIn,
        checkOutAt: checkOut,
        status: "present",
        source: "manual",
        notes: note,
      });
    }
    return `Davomat ${workDate} uchun tuzatildi.`;
  }

  // account_help / admin_task — adminlarga vazifa sifatida yetkaziladi
  await notifyByRoles({
    roles: ["admin"],
    title: "Yordamchi AI — tasdiqlangan amal",
    text: `${p.title}: ${p.summary}`.slice(0, 900),
    type: "ai_assistant",
    linkUrl: "/admin/yordamchi-ai",
  }).catch(() => undefined);
  if (userId) {
    const [u] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    if (u) {
      const { notifyUser } = await import("../lib/notify");
      await notifyUser({
        userId,
        title: "So‘rovingiz bajarildi",
        text: p.title,
        type: "ai_assistant",
        linkUrl: "/dashboard",
      }).catch(() => undefined);
    }
  }
  return "Adminlarga vazifa yuborildi / xodim xabardor qilindi.";
}

router.post("/ai-assistant/proposals/:id/approve", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  await ensureAiAssistantSchema();
  const id = Number(req.params.id);
  const { rows } = await pool.query<ProposalRow>(`${PROPOSAL_SELECT} WHERE p.id = $1`, [id]);
  const p = rows[0];
  if (!p) {
    res.status(404).json({ error: "Taklif topilmadi" });
    return;
  }
  if (p.status !== "pending") {
    res.status(409).json({ error: "Taklif allaqachon ko‘rib chiqilgan" });
    return;
  }
  let result: string;
  try {
    result = await executeProposal(p);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Bajarilmadi";
    await pool.query(
      `UPDATE ai_assistant_proposals SET status='failed', decided_by_id=$2, decided_at=NOW(), execution_result=$3 WHERE id=$1`,
      [id, req.userId!, msg],
    );
    res.status(422).json({ error: msg });
    return;
  }
  await pool.query(
    `UPDATE ai_assistant_proposals
     SET status='executed', decided_by_id=$2, decided_at=NOW(), decision_note=$3, execution_result=$4
     WHERE id=$1`,
    [id, req.userId!, String(req.body?.note || "").slice(0, 500) || null, result],
  );
  await pool.query(`UPDATE ai_assistant_conversations SET status='active', updated_at=NOW() WHERE id=$1`, [
    p.conversation_id,
  ]);
  const completion =
    (typeof p.payload?.completionText === "string" && p.payload.completionText.trim()) ||
    `Yaxshi xabar 🙂 So‘rovingiz ko‘rib chiqildi va hal qilindi: ${p.title}. Yana savol bo‘lsa yozing.`;
  await sendAssistantFollowUp(p.conversation_id, completion);
  if (p.platform_user_id) {
    const { notifyUser } = await import("../lib/notify");
    await notifyUser({
      userId: p.platform_user_id,
      title: "Yordamchi AI",
      text: completion,
      type: "ai_assistant",
      linkUrl: "/yordam",
    }).catch(() => undefined);
  }
  res.json({ ok: true, result });
});

router.post("/ai-assistant/proposals/:id/reject", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  await ensureAiAssistantSchema();
  const id = Number(req.params.id);
  const note = String(req.body?.note || "").trim().slice(0, 500);
  const { rows } = await pool.query<ProposalRow>(`${PROPOSAL_SELECT} WHERE p.id = $1`, [id]);
  const p = rows[0];
  if (!p) {
    res.status(404).json({ error: "Taklif topilmadi" });
    return;
  }
  if (p.status !== "pending") {
    res.status(409).json({ error: "Taklif allaqachon ko‘rib chiqilgan" });
    return;
  }
  await pool.query(
    `UPDATE ai_assistant_proposals SET status='rejected', decided_by_id=$2, decided_at=NOW(), decision_note=$3 WHERE id=$1`,
    [id, req.userId!, note || null],
  );
  await pool.query(`UPDATE ai_assistant_conversations SET status='active', updated_at=NOW() WHERE id=$1`, [
    p.conversation_id,
  ]);
  const follow =
    note ||
    "So‘rovingizni ko‘rib chiqdim — hozircha qo‘shimcha aniqlik kerak. Iltimos, vaziyatni biroz batafsil yozing (sana, vaqt, qanday xato chiqyapti), davom etamiz 🙂";
  await sendAssistantFollowUp(p.conversation_id, follow);
  res.json({ ok: true });
});

/** Admin suhbatga qo‘lda javob yozadi (bot nomidan Telegramga ketadi) */
router.post("/ai-assistant/conversations/:id/reply", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  await ensureAiAssistantSchema();
  const id = Number(req.params.id);
  const text = String(req.body?.text || "").trim().slice(0, 3000);
  if (!text) {
    res.status(400).json({ error: "Matn bo‘sh" });
    return;
  }
  await pool.query(`INSERT INTO ai_assistant_messages (conversation_id, role, text) VALUES ($1,'admin',$2)`, [id, text]);
  await sendAssistantFollowUp(id, text);
  res.json({ ok: true });
});

export default router;
