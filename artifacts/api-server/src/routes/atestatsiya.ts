/**
 * Atestatsiya — stajyor / farmasevt / mudir uchun vaqt va joy bilan cheklangan test.
 *  - Test faqat belgilangan oynada (startsAt … endsAt) ochiladi.
 *  - branch: faqat o‘z filiali GPS zonasida; office: faqat asosiy ofis zonasida.
 *  - Boshlangach taymer: min(boshlangan + davomiylik, oyna tugashi). Vaqt tugasa saqlangan javoblar bilan yakunlanadi.
 *  - Admin / direktor / trener: kiritadi, jonli kuzatadi, natijani bekor qiladi yoki qayta topshirishga ruxsat beradi.
 */
import { Router, type IRouter, type Response } from "express";
import { and, asc, desc, eq, inArray, type SQL } from "drizzle-orm";
import {
  db,
  attestatsiyaAttemptsTable,
  attestatsiyaExamsTable,
  usersTable,
  type AttestatsiyaQuestionRow,
} from "@workspace/db";
import { requireAuth, type AuthRequest } from "../middlewares/auth";
import { canManageDarsliklar, darslikTrackForRole } from "../lib/roles";
import { resolveUserBranches } from "../lib/employee-branch";
import { haversineMeters } from "../lib/mobile-attendance";
import { notifyByRoles, notifyUser } from "../lib/notify";
import {
  DAVOMAT_GEOFENCE_METERS,
  DAVOMAT_OFFICE_GEOFENCE_METERS,
  DAVOMAT_SITE_LAT,
  DAVOMAT_SITE_LNG,
} from "./davomat";

const router: IRouter = Router();

const TRACKS = ["stajyor", "farmasevt", "mudir"] as const;
type Track = (typeof TRACKS)[number];
const TRACK_LABEL: Record<Track, string> = { stajyor: "Stajyor", farmasevt: "Farmasevt", mudir: "Mudir" };

/** GPS xatoligi uchun zona chetiga qo‘shimcha */
const GEO_SLACK_M = 15;
/** Bundan past aniqlikdagi GPS qabul qilinmaydi */
const MAX_ACCURACY_M = 150;
/** Tarmoq kechikishi uchun: taymer tugagach shuncha vaqt ichida yuborilgan javob qabul qilinadi */
const SUBMIT_GRACE_MS = 30_000;

type Exam = typeof attestatsiyaExamsTable.$inferSelect;
type Attempt = typeof attestatsiyaAttemptsTable.$inferSelect;

const fmtTashkent = new Intl.DateTimeFormat("ru-RU", {
  timeZone: "Asia/Tashkent",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});
const fmtDt = (d: Date | null | undefined) => (d ? fmtTashkent.format(d).replace(",", "") : "—");

function parseTrack(raw: unknown): Track | null {
  const v = String(raw ?? "").trim().toLowerCase();
  return (TRACKS as readonly string[]).includes(v) ? (v as Track) : null;
}

function requireManager(req: AuthRequest, res: Response): boolean {
  if (!canManageDarsliklar(req.userRole)) {
    res.status(403).json({ error: "Faqat admin, direktor yoki trener" });
    return false;
  }
  return true;
}

function windowState(exam: Exam, now = Date.now()): "upcoming" | "open" | "closed" {
  if (now < exam.startsAt.getTime()) return "upcoming";
  if (now >= exam.endsAt.getTime()) return "closed";
  return "open";
}

function isFinished(a: Attempt) {
  return a.status === "submitted" || a.status === "expired";
}

function grade(exam: Exam, answers: Record<string, number>) {
  const qs = exam.questionsJson || [];
  const total = qs.length;
  let correct = 0;
  for (const q of qs) if (answers[q.id] === q.correctIndex) correct += 1;
  const score = total ? Math.round((correct / total) * 100) : 0;
  return { total, correct, score, passed: score >= (exam.passScore || 50) };
}

function sanitizeAnswers(exam: Exam, raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw || typeof raw !== "object") return out;
  const byId = new Map((exam.questionsJson || []).map((q) => [q.id, q]));
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const q = byId.get(k);
    const n = Number(v);
    if (q && Number.isInteger(n) && n >= 0 && n < q.options.length) out[k] = n;
  }
  return out;
}

function shuffled<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** Vaqti tugagan, lekin yakunlanmagan urinishlarni saqlangan javoblar bilan yopadi */
async function finalizeExpired(attempts: Attempt[], examById: Map<number, Exam>): Promise<Attempt[]> {
  const now = Date.now();
  const out: Attempt[] = [];
  for (const a of attempts) {
    const exam = examById.get(a.examId);
    if (a.status !== "in_progress" || !exam || now <= a.deadlineAt.getTime() + SUBMIT_GRACE_MS) {
      out.push(a);
      continue;
    }
    const g = grade(exam, a.answersJson || {});
    const [upd] = await db
      .update(attestatsiyaAttemptsTable)
      .set({
        status: "expired",
        submittedAt: a.deadlineAt,
        score: g.score,
        correct: g.correct,
        total: g.total,
        passed: g.passed,
        updatedAt: new Date(),
      })
      .where(and(eq(attestatsiyaAttemptsTable.id, a.id), eq(attestatsiyaAttemptsTable.status, "in_progress")))
      .returning();
    out.push(upd ?? a);
  }
  return out;
}

async function loadAttempts(where: SQL | undefined) {
  return db
    .select()
    .from(attestatsiyaAttemptsTable)
    .where(where)
    .orderBy(asc(attestatsiyaAttemptsTable.attemptNo), asc(attestatsiyaAttemptsTable.id));
}

function latestOf(attempts: Attempt[]): Attempt | null {
  return attempts.length ? attempts[attempts.length - 1]! : null;
}

function answeredCount(a: Attempt) {
  return Object.keys(a.answersJson || {}).length;
}

function learnerAttempt(a: Attempt, exam: Exam, withQuestions: boolean) {
  const reveal = exam.showResult && isFinished(a);
  const byId = new Map((exam.questionsJson || []).map((q) => [q.id, q]));
  const order = (a.questionOrder?.length ? a.questionOrder : (exam.questionsJson || []).map((q) => q.id)).filter(
    (id) => byId.has(id),
  );
  return {
    id: a.id,
    attemptNo: a.attemptNo,
    status: a.status,
    startedAt: a.startedAt.toISOString(),
    deadlineAt: a.deadlineAt.toISOString(),
    submittedAt: a.submittedAt ? a.submittedAt.toISOString() : null,
    answeredCount: answeredCount(a),
    total: a.total || order.length,
    score: reveal ? a.score : null,
    correct: reveal ? a.correct : null,
    passed: reveal ? a.passed : null,
    resultHidden: isFinished(a) && !exam.showResult,
    locationLabel: a.locationLabel,
    retakeAllowed: a.retakeAllowed,
    annulReason: a.status === "annulled" ? a.annulReason : null,
    questions: withQuestions
      ? order.map((id) => {
          const q = byId.get(id)!;
          return { id: q.id, text: q.text, options: q.options };
        })
      : undefined,
    answers: withQuestions ? a.answersJson || {} : undefined,
  };
}

function startPolicy(exam: Exam, attempts: Attempt[]) {
  const latest = latestOf(attempts);
  const state = windowState(exam);
  if (latest?.status === "in_progress") return { canStart: false, canResume: true, reason: null as string | null };
  if (state === "upcoming") return { canStart: false, canResume: false, reason: `Test ${fmtDt(exam.startsAt)} da ochiladi` };
  if (state === "closed") return { canStart: false, canResume: false, reason: "Test vaqti tugagan" };
  if (!latest || latest.retakeAllowed) return { canStart: true, canResume: false, reason: null };
  if (latest.status === "annulled") return { canStart: false, canResume: false, reason: "Natijangiz bekor qilingan" };
  return { canStart: false, canResume: false, reason: "Siz bu testni topshirgansiz" };
}

/* ---------------------------------- Xodim ---------------------------------- */

function resolveLearner(req: AuthRequest, res: Response): { track: Track; preview: boolean } | null {
  const own = darslikTrackForRole(req.userRole) as Track | null;
  if (own) return { track: own, preview: false };
  if (canManageDarsliklar(req.userRole)) return { track: parseTrack(req.query.track) || "stajyor", preview: true };
  res.status(403).json({ error: "Atestatsiya faqat stajyor, farmasevt va mudir uchun" });
  return null;
}

router.get("/atestatsiya/me", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const who = resolveLearner(req, res);
  if (!who) return;
  const exams = await db
    .select()
    .from(attestatsiyaExamsTable)
    .where(
      who.preview
        ? eq(attestatsiyaExamsTable.track, who.track)
        : and(eq(attestatsiyaExamsTable.track, who.track), eq(attestatsiyaExamsTable.published, true)),
    )
    .orderBy(desc(attestatsiyaExamsTable.startsAt))
    .limit(60);
  const examById = new Map(exams.map((e) => [e.id, e]));
  let attempts: Attempt[] = [];
  if (!who.preview && exams.length) {
    attempts = await loadAttempts(
      and(
        eq(attestatsiyaAttemptsTable.userId, req.userId!),
        inArray(
          attestatsiyaAttemptsTable.examId,
          exams.map((e) => e.id),
        ),
      ),
    );
    attempts = await finalizeExpired(attempts, examById);
  }
  const branch = who.preview ? null : (await resolveUserBranches([req.userId!])).get(req.userId!) ?? null;
  const rank = { open: 0, upcoming: 1, closed: 2 } as const;

  const items = exams
    .map((e) => {
      const mine = attempts.filter((a) => a.examId === e.id);
      const latest = latestOf(mine);
      const policy = who.preview
        ? (e.questionsJson || []).length
          ? { canStart: true, canResume: false, reason: null as string | null }
          : { canStart: false, canResume: false, reason: "Testda savollar yo‘q" }
        : startPolicy(e, mine);
      return {
        id: e.id,
        title: e.title,
        description: e.description,
        durationMinutes: e.durationMinutes,
        passScore: e.passScore,
        questionCount: (e.questionsJson || []).length,
        locationMode: e.locationMode,
        locationTarget:
          e.locationMode === "office" ? "Asosiy ofis" : branch?.label || "O‘z filialingiz",
        startsAt: e.startsAt.toISOString(),
        endsAt: e.endsAt.toISOString(),
        window: windowState(e),
        published: e.published,
        attempt: latest ? learnerAttempt(latest, e, false) : null,
        attemptsCount: mine.length,
        ...policy,
      };
    })
    .sort((a, b) => rank[a.window] - rank[b.window] || (a.window === "closed" ? b.startsAt.localeCompare(a.startsAt) : a.startsAt.localeCompare(b.startsAt)));

  res.json({
    track: who.track,
    trackLabel: TRACK_LABEL[who.track],
    preview: who.preview,
    serverNow: new Date().toISOString(),
    branch: branch ? { label: branch.label, hasGps: branch.lat != null } : null,
    exams: items,
  });
});

type GeoOk = { ok: true; label: string; branchId: number | null; distanceM: number };
type GeoFail = { ok: false; error: string; code: string; distanceM?: number; allowedM?: number };

async function checkLocation(exam: Exam, userId: number, body: Record<string, unknown>): Promise<GeoOk | GeoFail> {
  const lat = Number(body.latitude);
  const lng = Number(body.longitude);
  const acc = Number(body.accuracy);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return { ok: false, code: "no_gps", error: "Joylashuv aniqlanmadi. Telefon GPS’ini yoqib, brauzerga ruxsat bering." };
  }
  if (Number.isFinite(acc) && acc > MAX_ACCURACY_M) {
    return {
      ok: false,
      code: "low_accuracy",
      error: `GPS aniqligi past (${Math.round(acc)} m). Ochiq joyga chiqib, qayta urinib ko‘ring.`,
    };
  }
  if (exam.locationMode === "office") {
    const d = Math.round(haversineMeters(lat, lng, DAVOMAT_SITE_LAT, DAVOMAT_SITE_LNG));
    if (d > DAVOMAT_OFFICE_GEOFENCE_METERS + GEO_SLACK_M) {
      return {
        ok: false,
        code: "outside_office",
        error: `Test faqat asosiy ofisda ochiladi. Siz ofisdan ${d} m uzoqdasiz (ruxsat ${DAVOMAT_OFFICE_GEOFENCE_METERS} m).`,
        distanceM: d,
        allowedM: DAVOMAT_OFFICE_GEOFENCE_METERS,
      };
    }
    return { ok: true, label: "Asosiy ofis", branchId: null, distanceM: d };
  }
  const br = (await resolveUserBranches([userId])).get(userId);
  if (!br?.branchId) {
    return { ok: false, code: "no_branch", error: "Sizga filial biriktirilmagan. Admin yoki trener bilan bog‘laning." };
  }
  if (br.lat == null || br.lng == null) {
    return {
      ok: false,
      code: "branch_no_gps",
      error: `«${br.label || "Filial"}» filialining GPS nuqtasi kiritilmagan. Admin bilan bog‘laning.`,
    };
  }
  const d = Math.round(haversineMeters(lat, lng, br.lat, br.lng));
  if (d > DAVOMAT_GEOFENCE_METERS + GEO_SLACK_M) {
    return {
      ok: false,
      code: "outside_branch",
      error: `Test faqat o‘z filialingiz «${br.label || "Filial"}» ichida ochiladi. Siz ${d} m uzoqdasiz (ruxsat ${DAVOMAT_GEOFENCE_METERS} m).`,
      distanceM: d,
      allowedM: DAVOMAT_GEOFENCE_METERS,
    };
  }
  return { ok: true, label: br.label || "Filial", branchId: br.branchId, distanceM: d };
}

router.post("/atestatsiya/me/exams/:id/start", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const track = darslikTrackForRole(req.userRole) as Track | null;
  if (!track) {
    res.status(403).json({ error: "Atestatsiya faqat stajyor, farmasevt va mudir uchun" });
    return;
  }
  const examId = Number(req.params.id);
  const [exam] = await db.select().from(attestatsiyaExamsTable).where(eq(attestatsiyaExamsTable.id, examId)).limit(1);
  if (!exam || !exam.published || exam.track !== track) {
    res.status(404).json({ error: "Test topilmadi" });
    return;
  }
  const examById = new Map([[exam.id, exam]]);
  const mine = await finalizeExpired(
    await loadAttempts(and(eq(attestatsiyaAttemptsTable.examId, examId), eq(attestatsiyaAttemptsTable.userId, req.userId!))),
    examById,
  );
  const policy = startPolicy(exam, mine);
  if (!policy.canStart && !policy.canResume) {
    res.status(409).json({ error: policy.reason || "Testni boshlab bo‘lmaydi" });
    return;
  }
  if (!(exam.questionsJson || []).length) {
    res.status(409).json({ error: "Testda savollar yo‘q" });
    return;
  }

  const geo = await checkLocation(exam, req.userId!, (req.body || {}) as Record<string, unknown>);
  if (!geo.ok) {
    res.status(403).json(geo);
    return;
  }

  if (policy.canResume) {
    const current = latestOf(mine)!;
    res.json({ attempt: learnerAttempt(current, exam, true), serverNow: new Date().toISOString(), resumed: true });
    return;
  }

  const now = new Date();
  const deadline = new Date(Math.min(now.getTime() + exam.durationMinutes * 60_000, exam.endsAt.getTime()));
  const ids = (exam.questionsJson || []).map((q) => q.id);
  const body = (req.body || {}) as Record<string, unknown>;
  const [created] = await db
    .insert(attestatsiyaAttemptsTable)
    .values({
      examId,
      userId: req.userId!,
      attemptNo: (latestOf(mine)?.attemptNo ?? 0) + 1,
      status: "in_progress",
      questionOrder: exam.shuffleQuestions ? shuffled(ids) : ids,
      answersJson: {},
      startedAt: now,
      deadlineAt: deadline,
      total: ids.length,
      locationMode: exam.locationMode,
      locationLabel: geo.label,
      branchId: geo.branchId,
      distanceM: geo.distanceM,
      latitude: Number(body.latitude),
      longitude: Number(body.longitude),
      accuracyM: Number.isFinite(Number(body.accuracy)) ? Math.round(Number(body.accuracy)) : null,
      userAgent: String(req.headers["user-agent"] || "").slice(0, 300),
    })
    .onConflictDoNothing()
    .returning();

  const attempt =
    created ??
    (
      await db
        .select()
        .from(attestatsiyaAttemptsTable)
        .where(
          and(
            eq(attestatsiyaAttemptsTable.examId, examId),
            eq(attestatsiyaAttemptsTable.userId, req.userId!),
            eq(attestatsiyaAttemptsTable.status, "in_progress"),
          ),
        )
        .limit(1)
    )[0];
  if (!attempt) {
    res.status(500).json({ error: "Urinish yaratilmadi, qayta urinib ko‘ring" });
    return;
  }
  res.json({ attempt: learnerAttempt(attempt, exam, true), serverNow: new Date().toISOString(), resumed: !created });
});

function practiceAttempt(exam: Exam, withQuestions: boolean, order: string[]) {
  const now = new Date();
  const deadline = new Date(now.getTime() + exam.durationMinutes * 60_000);
  const byId = new Map((exam.questionsJson || []).map((q) => [q.id, q]));
  return {
    id: 0,
    attemptNo: 0,
    status: "in_progress" as const,
    startedAt: now.toISOString(),
    deadlineAt: deadline.toISOString(),
    submittedAt: null,
    answeredCount: 0,
    total: order.length,
    score: null,
    correct: null,
    passed: null,
    resultHidden: false,
    locationLabel: "Ko‘rish rejimi",
    retakeAllowed: false,
    annulReason: null,
    questions: withQuestions
      ? order
          .map((id) => byId.get(id))
          .filter((q): q is NonNullable<typeof q> => Boolean(q))
          .map((q) => ({ id: q.id, text: q.text, options: q.options }))
      : undefined,
    answers: {} as Record<string, number>,
  };
}

/** Trener / admin sinovi — urinish yozilmaydi, GPS va oyna tekshirilmaydi */
router.post("/atestatsiya/preview/exams/:id/start", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!requireManager(req, res)) return;
  const examId = Number(req.params.id);
  const [exam] = await db.select().from(attestatsiyaExamsTable).where(eq(attestatsiyaExamsTable.id, examId)).limit(1);
  if (!exam) {
    res.status(404).json({ error: "Test topilmadi" });
    return;
  }
  const ids = (exam.questionsJson || []).map((q) => q.id);
  if (!ids.length) {
    res.status(409).json({ error: "Testda savollar yo‘q" });
    return;
  }
  const order = exam.shuffleQuestions ? shuffled(ids) : ids;
  res.json({
    attempt: practiceAttempt(exam, true, order),
    serverNow: new Date().toISOString(),
    practice: true,
  });
});

router.post("/atestatsiya/preview/exams/:id/score", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!requireManager(req, res)) return;
  const examId = Number(req.params.id);
  const [exam] = await db.select().from(attestatsiyaExamsTable).where(eq(attestatsiyaExamsTable.id, examId)).limit(1);
  if (!exam) {
    res.status(404).json({ error: "Test topilmadi" });
    return;
  }
  const answers = sanitizeAnswers(exam, req.body?.answers);
  const g = grade(exam, answers);
  const now = new Date().toISOString();
  res.json({
    attempt: {
      id: 0,
      attemptNo: 0,
      status: "submitted",
      startedAt: now,
      deadlineAt: now,
      submittedAt: now,
      answeredCount: Object.keys(answers).length,
      total: g.total,
      score: g.score,
      correct: g.correct,
      passed: g.passed,
      resultHidden: false,
      locationLabel: "Ko‘rish rejimi",
      retakeAllowed: false,
      annulReason: null,
    },
    serverNow: now,
  });
});

async function loadOwnAttempt(req: AuthRequest, res: Response) {
  const id = Number(req.params.id);
  const [a] = await db.select().from(attestatsiyaAttemptsTable).where(eq(attestatsiyaAttemptsTable.id, id)).limit(1);
  if (!a || a.userId !== req.userId) {
    res.status(404).json({ error: "Urinish topilmadi" });
    return null;
  }
  const [exam] = await db.select().from(attestatsiyaExamsTable).where(eq(attestatsiyaExamsTable.id, a.examId)).limit(1);
  if (!exam) {
    res.status(404).json({ error: "Test topilmadi" });
    return null;
  }
  return { a, exam };
}

function focusValue(raw: unknown, prev: number) {
  const n = Math.round(Number(raw));
  return Number.isFinite(n) ? Math.min(999, Math.max(prev, n)) : prev;
}

router.post("/atestatsiya/me/attempts/:id/progress", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const got = await loadOwnAttempt(req, res);
  if (!got) return;
  const { a, exam } = got;
  if (a.status !== "in_progress" || Date.now() > a.deadlineAt.getTime() + SUBMIT_GRACE_MS) {
    res.status(409).json({ error: "Vaqt tugagan", code: "closed" });
    return;
  }
  const answers = { ...(a.answersJson || {}), ...sanitizeAnswers(exam, req.body?.answers) };
  await db
    .update(attestatsiyaAttemptsTable)
    .set({ answersJson: answers, focusLost: focusValue(req.body?.focusLost, a.focusLost), updatedAt: new Date() })
    .where(and(eq(attestatsiyaAttemptsTable.id, a.id), eq(attestatsiyaAttemptsTable.status, "in_progress")));
  res.json({ ok: true, answeredCount: Object.keys(answers).length, serverNow: new Date().toISOString() });
});

router.post("/atestatsiya/me/attempts/:id/submit", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const got = await loadOwnAttempt(req, res);
  if (!got) return;
  const { a, exam } = got;
  if (a.status !== "in_progress") {
    res.json({ attempt: learnerAttempt(a, exam, false), serverNow: new Date().toISOString() });
    return;
  }
  const late = Date.now() > a.deadlineAt.getTime() + SUBMIT_GRACE_MS;
  const answers = late ? a.answersJson || {} : { ...(a.answersJson || {}), ...sanitizeAnswers(exam, req.body?.answers) };
  const g = grade(exam, answers);
  const [upd] = await db
    .update(attestatsiyaAttemptsTable)
    .set({
      status: late ? "expired" : "submitted",
      answersJson: answers,
      submittedAt: late ? a.deadlineAt : new Date(),
      score: g.score,
      correct: g.correct,
      total: g.total,
      passed: g.passed,
      focusLost: focusValue(req.body?.focusLost, a.focusLost),
      updatedAt: new Date(),
    })
    .where(and(eq(attestatsiyaAttemptsTable.id, a.id), eq(attestatsiyaAttemptsTable.status, "in_progress")))
    .returning();
  const final =
    upd ?? (await db.select().from(attestatsiyaAttemptsTable).where(eq(attestatsiyaAttemptsTable.id, a.id)).limit(1))[0]!;
  res.json({ attempt: learnerAttempt(final, exam, false), serverNow: new Date().toISOString() });
});

/* -------------------------------- Boshqaruv -------------------------------- */

type ExamInput = {
  title: string;
  description: string;
  questionsJson: AttestatsiyaQuestionRow[];
  passScore: number;
  durationMinutes: number;
  locationMode: "branch" | "office";
  startsAt: Date;
  endsAt: Date;
  shuffleQuestions: boolean;
  showResult: boolean;
  published: boolean;
};

function parseExamBody(body: Record<string, unknown> | undefined): ExamInput | { error: string } {
  const title = String(body?.title ?? "").trim().slice(0, 200);
  if (!title) return { error: "Atestatsiya nomini yozing" };
  const description = String(body?.description ?? "").trim().slice(0, 3000);

  const rawQs = body?.questions;
  if (!Array.isArray(rawQs) || rawQs.length === 0) return { error: "Kamida 1 ta savol qo‘shing" };
  const questionsJson: AttestatsiyaQuestionRow[] = [];
  for (let i = 0; i < rawQs.length; i++) {
    const q = rawQs[i] as Record<string, unknown>;
    const text = String(q?.text ?? "").trim();
    const options = Array.isArray(q?.options) ? q.options.map((o) => String(o ?? "").trim()).filter(Boolean) : [];
    const correctIndex = Number(q?.correctIndex);
    if (!text) return { error: `${i + 1}-savol matnini yozing` };
    if (options.length < 2) return { error: `${i + 1}-savolda kamida 2 ta variant bo‘lsin` };
    if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex >= options.length) {
      return { error: `${i + 1}-savolda to‘g‘ri javobni belgilang` };
    }
    const id = String(q?.id ?? "").trim() || `q-${i + 1}-${Date.now()}`;
    questionsJson.push({ id, text, options, correctIndex });
  }

  const passScore = Math.round(Number(body?.passScore ?? 50));
  if (!Number.isFinite(passScore) || passScore < 1 || passScore > 100) return { error: "O‘tish bali 1–100 oralig‘ida bo‘lsin" };
  const durationMinutes = Math.round(Number(body?.durationMinutes ?? 30));
  if (!Number.isFinite(durationMinutes) || durationMinutes < 1 || durationMinutes > 600) {
    return { error: "Test davomiyligi 1–600 daqiqa bo‘lsin" };
  }
  const locationMode = body?.locationMode === "office" ? "office" : body?.locationMode === "branch" ? "branch" : null;
  if (!locationMode) return { error: "Joyni tanlang: filial yoki ofis" };

  const startsAt = new Date(String(body?.startsAt ?? ""));
  const endsAt = new Date(String(body?.endsAt ?? ""));
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) return { error: "Boshlanish va tugash vaqtini kiriting" };
  if (endsAt.getTime() <= startsAt.getTime()) return { error: "Tugash vaqti boshlanishdan keyin bo‘lsin" };
  if (durationMinutes * 60_000 > endsAt.getTime() - startsAt.getTime()) {
    return { error: "Test davomiyligi ochiq vaqt oralig‘idan uzun bo‘lmasin" };
  }

  return {
    title,
    description,
    questionsJson,
    passScore,
    durationMinutes,
    locationMode,
    startsAt,
    endsAt,
    shuffleQuestions: body?.shuffleQuestions !== false,
    showResult: body?.showResult !== false,
    published: body?.published !== false,
  };
}

function manageExam(e: Exam) {
  return {
    id: e.id,
    track: e.track,
    title: e.title,
    description: e.description,
    questions: e.questionsJson || [],
    passScore: e.passScore,
    durationMinutes: e.durationMinutes,
    locationMode: e.locationMode,
    startsAt: e.startsAt.toISOString(),
    endsAt: e.endsAt.toISOString(),
    shuffleQuestions: e.shuffleQuestions,
    showResult: e.showResult,
    published: e.published,
    window: windowState(e),
    updatedAt: e.updatedAt.toISOString(),
  };
}

async function notifyPublished(e: Exam) {
  const where = e.locationMode === "office" ? "asosiy ofisda" : "o‘z filialingizda";
  await notifyByRoles({
    roles: [e.track],
    title: "Atestatsiya",
    text: `«${e.title}» atestatsiyasi: ${fmtDt(e.startsAt)} – ${fmtDt(e.endsAt)}. Test faqat ${where} ochiladi, davomiyligi ${e.durationMinutes} daqiqa.`,
    type: "atestatsiya",
    linkUrl: "/atestatsiya",
  }).catch(() => undefined);
}

async function activeLearners(track: Track) {
  return db
    .select({ id: usersTable.id, fullName: usersTable.fullName, phone: usersTable.phone })
    .from(usersTable)
    .where(and(eq(usersTable.role, track), inArray(usersTable.status, ["active", "on_leave"])))
    .orderBy(asc(usersTable.fullName));
}

router.get("/atestatsiya/manage", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!requireManager(req, res)) return;
  const track = parseTrack(req.query.track) || "stajyor";
  const all = await db.select().from(attestatsiyaExamsTable).orderBy(desc(attestatsiyaExamsTable.startsAt));
  const exams = all.filter((e) => e.track === track);
  const examById = new Map(exams.map((e) => [e.id, e]));
  const attempts = exams.length
    ? await finalizeExpired(
        await loadAttempts(
          inArray(
            attestatsiyaAttemptsTable.examId,
            exams.map((e) => e.id),
          ),
        ),
        examById,
      )
    : [];
  const targets = (await activeLearners(track)).length;

  res.json({
    track,
    trackLabel: TRACK_LABEL[track],
    targets,
    tracks: TRACKS.map((t) => ({
      key: t,
      label: TRACK_LABEL[t],
      total: all.filter((e) => e.track === t).length,
      open: all.filter((e) => e.track === t && e.published && windowState(e) === "open").length,
    })),
    exams: exams.map((e) => {
      const latestByUser = new Map<number, Attempt>();
      for (const a of attempts) if (a.examId === e.id) latestByUser.set(a.userId, a);
      const latest = [...latestByUser.values()];
      const finished = latest.filter(isFinished);
      return {
        ...manageExam(e),
        stats: {
          started: latest.length,
          inProgress: latest.filter((a) => a.status === "in_progress").length,
          finished: finished.length,
          passed: finished.filter((a) => a.passed).length,
          annulled: latest.filter((a) => a.status === "annulled").length,
          hasAttempts: attempts.some((a) => a.examId === e.id),
        },
      };
    }),
  });
});

router.get("/atestatsiya/manage/results", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!requireManager(req, res)) return;
  const track = parseTrack(req.query.track) || "stajyor";
  const exams = await db
    .select()
    .from(attestatsiyaExamsTable)
    .where(eq(attestatsiyaExamsTable.track, track))
    .orderBy(desc(attestatsiyaExamsTable.startsAt));
  const examById = new Map(exams.map((e) => [e.id, e]));
  const attempts = exams.length
    ? await finalizeExpired(
        await loadAttempts(
          inArray(
            attestatsiyaAttemptsTable.examId,
            exams.map((e) => e.id),
          ),
        ),
        examById,
      )
    : [];
  const learners = await activeLearners(track);
  const known = new Set(learners.map((u) => u.id));
  const extraIds = [...new Set(attempts.map((a) => a.userId))].filter((id) => !known.has(id));
  const extra = extraIds.length
    ? await db
        .select({ id: usersTable.id, fullName: usersTable.fullName, phone: usersTable.phone })
        .from(usersTable)
        .where(inArray(usersTable.id, extraIds))
    : [];
  const people = [...learners, ...extra];
  const branches = await resolveUserBranches(people.map((p) => p.id));
  const byExamUser = new Map<string, Attempt[]>();
  for (const a of attempts) {
    const key = `${a.examId}:${a.userId}`;
    const list = byExamUser.get(key) || [];
    list.push(a);
    byExamUser.set(key, list);
  }

  const rows = exams.flatMap((exam) =>
    people.map((p) => {
      const list = byExamUser.get(`${exam.id}:${p.id}`) || [];
      const a = latestOf(list);
      const br = branches.get(p.id);
      return {
        examId: exam.id,
        examTitle: exam.title,
        passScore: exam.passScore,
        locationMode: exam.locationMode,
        durationMinutes: exam.durationMinutes,
        windowStart: exam.startsAt.toISOString(),
        windowEnd: exam.endsAt.toISOString(),
        userId: p.id,
        fullName: p.fullName,
        phone: p.phone || null,
        branchLabel: br?.label || null,
        status: a ? a.status : "not_started",
        score: a?.score ?? null,
        correct: a?.correct ?? null,
        total: a?.total || (exam.questionsJson || []).length,
        passed: a?.passed ?? null,
        attemptNo: a?.attemptNo ?? 0,
        attemptsCount: list.length,
        startedAt: a ? a.startedAt.toISOString() : null,
        submittedAt: a?.submittedAt ? a.submittedAt.toISOString() : null,
        durationSec:
          a?.submittedAt && isFinished(a)
            ? Math.max(0, Math.round((a.submittedAt.getTime() - a.startedAt.getTime()) / 1000))
            : null,
        locationLabel: a?.locationLabel ?? null,
        distanceM: a?.distanceM ?? null,
        accuracyM: a?.accuracyM ?? null,
        focusLost: a?.focusLost ?? 0,
        retakeAllowed: Boolean(a?.retakeAllowed),
        annulReason: a?.annulReason ?? null,
      };
    }),
  );

  const finished = rows.filter((r) => r.status === "submitted" || r.status === "expired");
  const scores = finished.map((r) => r.score ?? 0);
  const passed = finished.filter((r) => r.passed).length;
  res.json({
    track,
    trackLabel: TRACK_LABEL[track],
    exams: exams.map((e) => ({ id: e.id, title: e.title })),
    stats: {
      people: people.length,
      exams: exams.length,
      rows: rows.length,
      notStarted: rows.filter((r) => r.status === "not_started").length,
      inProgress: rows.filter((r) => r.status === "in_progress").length,
      finished: finished.length,
      passed,
      failed: finished.length - passed,
      annulled: rows.filter((r) => r.status === "annulled").length,
      passRate: finished.length ? Math.round((passed / finished.length) * 100) : null,
      avgScore: scores.length ? Math.round(scores.reduce((s, v) => s + v, 0) / scores.length) : null,
    },
    rows,
  });
});

router.post("/atestatsiya/manage", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!requireManager(req, res)) return;
  const track = parseTrack(req.body?.track);
  if (!track) {
    res.status(400).json({ error: "Yo‘nalish noto‘g‘ri" });
    return;
  }
  const input = parseExamBody(req.body);
  if ("error" in input) {
    res.status(400).json(input);
    return;
  }
  const [created] = await db
    .insert(attestatsiyaExamsTable)
    .values({ ...input, track, createdById: req.userId!, updatedById: req.userId! })
    .returning();
  if (created!.published) void notifyPublished(created!);
  res.json({ exam: manageExam(created!) });
});

router.put("/atestatsiya/manage/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!requireManager(req, res)) return;
  const id = Number(req.params.id);
  const [existing] = await db.select().from(attestatsiyaExamsTable).where(eq(attestatsiyaExamsTable.id, id)).limit(1);
  if (!existing) {
    res.status(404).json({ error: "Atestatsiya topilmadi" });
    return;
  }
  const input = parseExamBody(req.body);
  if ("error" in input) {
    res.status(400).json(input);
    return;
  }
  const [hasAttempt] = await db
    .select({ id: attestatsiyaAttemptsTable.id })
    .from(attestatsiyaAttemptsTable)
    .where(eq(attestatsiyaAttemptsTable.examId, id))
    .limit(1);
  if (hasAttempt && JSON.stringify(existing.questionsJson) !== JSON.stringify(input.questionsJson)) {
    res.status(409).json({
      error: "Xodimlar testni boshlagan — savollarni o‘zgartirib bo‘lmaydi. Vaqt, joy va sozlamalarni o‘zgartirish mumkin.",
    });
    return;
  }
  const [updated] = await db
    .update(attestatsiyaExamsTable)
    .set({ ...input, updatedById: req.userId!, updatedAt: new Date() })
    .where(eq(attestatsiyaExamsTable.id, id))
    .returning();
  if (!existing.published && updated!.published) void notifyPublished(updated!);
  res.json({ exam: manageExam(updated!) });
});

router.patch("/atestatsiya/manage/:id/publish", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!requireManager(req, res)) return;
  const id = Number(req.params.id);
  const published = Boolean(req.body?.published);
  const [before] = await db.select().from(attestatsiyaExamsTable).where(eq(attestatsiyaExamsTable.id, id)).limit(1);
  if (!before) {
    res.status(404).json({ error: "Atestatsiya topilmadi" });
    return;
  }
  const [updated] = await db
    .update(attestatsiyaExamsTable)
    .set({ published, updatedById: req.userId!, updatedAt: new Date() })
    .where(eq(attestatsiyaExamsTable.id, id))
    .returning();
  if (!before.published && published) void notifyPublished(updated!);
  res.json({ exam: manageExam(updated!) });
});

router.delete("/atestatsiya/manage/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!requireManager(req, res)) return;
  const id = Number(req.params.id);
  await db.delete(attestatsiyaAttemptsTable).where(eq(attestatsiyaAttemptsTable.examId, id));
  const [deleted] = await db.delete(attestatsiyaExamsTable).where(eq(attestatsiyaExamsTable.id, id)).returning();
  if (!deleted) {
    res.status(404).json({ error: "Atestatsiya topilmadi" });
    return;
  }
  res.json({ ok: true });
});

router.get("/atestatsiya/manage/:id/monitor", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!requireManager(req, res)) return;
  const id = Number(req.params.id);
  const [exam] = await db.select().from(attestatsiyaExamsTable).where(eq(attestatsiyaExamsTable.id, id)).limit(1);
  if (!exam) {
    res.status(404).json({ error: "Atestatsiya topilmadi" });
    return;
  }
  const track = (parseTrack(exam.track) || "stajyor") as Track;
  const attempts = await finalizeExpired(
    await loadAttempts(eq(attestatsiyaAttemptsTable.examId, id)),
    new Map([[exam.id, exam]]),
  );
  const learners = await activeLearners(track);
  const knownIds = new Set(learners.map((u) => u.id));
  const extraIds = [...new Set(attempts.map((a) => a.userId))].filter((uid) => !knownIds.has(uid));
  const extra = extraIds.length
    ? await db
        .select({ id: usersTable.id, fullName: usersTable.fullName, phone: usersTable.phone })
        .from(usersTable)
        .where(inArray(usersTable.id, extraIds))
    : [];
  const people = [...learners, ...extra];
  const branches = await resolveUserBranches(people.map((p) => p.id));
  const now = Date.now();

  const byUser = new Map<number, Attempt[]>();
  for (const a of attempts) {
    const list = byUser.get(a.userId) || [];
    list.push(a);
    byUser.set(a.userId, list);
  }

  const rows = people.map((p) => {
    const list = byUser.get(p.id) || [];
    const a = latestOf(list);
    const br = branches.get(p.id);
    const status = a ? a.status : "not_started";
    return {
      userId: p.id,
      fullName: p.fullName,
      phone: p.phone || null,
      branchLabel: br?.label || null,
      inTrack: knownIds.has(p.id),
      status,
      attemptId: a?.id ?? null,
      attemptNo: a?.attemptNo ?? 0,
      attemptsCount: list.length,
      startedAt: a ? a.startedAt.toISOString() : null,
      deadlineAt: a ? a.deadlineAt.toISOString() : null,
      submittedAt: a?.submittedAt ? a.submittedAt.toISOString() : null,
      remainingSec: a?.status === "in_progress" ? Math.max(0, Math.round((a.deadlineAt.getTime() - now) / 1000)) : null,
      durationSec:
        a?.submittedAt && isFinished(a) ? Math.max(0, Math.round((a.submittedAt.getTime() - a.startedAt.getTime()) / 1000)) : null,
      answeredCount: a ? answeredCount(a) : 0,
      total: a?.total || (exam.questionsJson || []).length,
      score: a?.score ?? null,
      correct: a?.correct ?? null,
      passed: a?.passed ?? null,
      locationLabel: a?.locationLabel ?? null,
      distanceM: a?.distanceM ?? null,
      accuracyM: a?.accuracyM ?? null,
      focusLost: a?.focusLost ?? 0,
      retakeAllowed: a?.retakeAllowed ?? false,
      annulReason: a?.annulReason ?? null,
      annulledAt: a?.annulledAt ? a.annulledAt.toISOString() : null,
      history: list.map((h) => ({
        attemptNo: h.attemptNo,
        status: h.status,
        score: h.score,
        passed: h.passed,
        startedAt: h.startedAt.toISOString(),
        submittedAt: h.submittedAt ? h.submittedAt.toISOString() : null,
      })),
    };
  });

  const latest = [...byUser.values()].map((l) => latestOf(l)!).filter(Boolean);
  const finished = latest.filter(isFinished);
  const scores = finished.map((a) => a.score ?? 0);
  const durations = finished
    .filter((a) => a.submittedAt)
    .map((a) => (a.submittedAt!.getTime() - a.startedAt.getTime()) / 60_000);
  const passed = finished.filter((a) => a.passed).length;
  const buckets = [
    { label: "0–29", min: 0, max: 29 },
    { label: "30–49", min: 30, max: 49 },
    { label: "50–69", min: 50, max: 69 },
    { label: "70–89", min: 70, max: 89 },
    { label: "90–100", min: 90, max: 100 },
  ].map((b) => ({ label: b.label, count: scores.filter((s) => s >= b.min && s <= b.max).length }));

  const questionStats = (exam.questionsJson || []).map((q, i) => {
    let answered = 0;
    let correct = 0;
    for (const a of finished) {
      const v = (a.answersJson || {})[q.id];
      if (v === undefined) continue;
      answered += 1;
      if (v === q.correctIndex) correct += 1;
    }
    return {
      number: i + 1,
      id: q.id,
      text: q.text,
      answered,
      correct,
      percent: finished.length ? Math.round((correct / finished.length) * 100) : null,
    };
  });

  const branchMap = new Map<string, { label: string; total: number; finished: number; passed: number; sum: number }>();
  for (const r of rows) {
    const key = r.branchLabel || (exam.locationMode === "office" ? "Filial ko‘rsatilmagan" : "Filialsiz");
    const b = branchMap.get(key) || { label: key, total: 0, finished: 0, passed: 0, sum: 0 };
    b.total += 1;
    if (r.status === "submitted" || r.status === "expired") {
      b.finished += 1;
      b.sum += r.score ?? 0;
      if (r.passed) b.passed += 1;
    }
    branchMap.set(key, b);
  }

  res.json({
    exam: manageExam(exam),
    trackLabel: TRACK_LABEL[track],
    serverNow: new Date(now).toISOString(),
    stats: {
      targets: rows.length,
      notStarted: rows.filter((r) => r.status === "not_started").length,
      inProgress: latest.filter((a) => a.status === "in_progress").length,
      finished: finished.length,
      expired: finished.filter((a) => a.status === "expired").length,
      passed,
      failed: finished.length - passed,
      annulled: latest.filter((a) => a.status === "annulled").length,
      passRate: finished.length ? Math.round((passed / finished.length) * 100) : null,
      avgScore: scores.length ? Math.round(scores.reduce((s, v) => s + v, 0) / scores.length) : null,
      maxScore: scores.length ? Math.max(...scores) : null,
      minScore: scores.length ? Math.min(...scores) : null,
      avgDurationMin: durations.length ? Math.round((durations.reduce((s, v) => s + v, 0) / durations.length) * 10) / 10 : null,
      focusLostPeople: latest.filter((a) => a.focusLost > 0).length,
      buckets,
    },
    questionStats,
    branches: [...branchMap.values()]
      .map((b) => ({
        label: b.label,
        total: b.total,
        finished: b.finished,
        passed: b.passed,
        avgScore: b.finished ? Math.round(b.sum / b.finished) : null,
      }))
      .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label)),
    rows,
  });
});

async function loadAttemptForManager(req: AuthRequest, res: Response) {
  const id = Number(req.params.id);
  const [a] = await db.select().from(attestatsiyaAttemptsTable).where(eq(attestatsiyaAttemptsTable.id, id)).limit(1);
  if (!a) {
    res.status(404).json({ error: "Urinish topilmadi" });
    return null;
  }
  const [exam] = await db.select().from(attestatsiyaExamsTable).where(eq(attestatsiyaExamsTable.id, a.examId)).limit(1);
  if (!exam) {
    res.status(404).json({ error: "Atestatsiya topilmadi" });
    return null;
  }
  return { a, exam };
}

router.post("/atestatsiya/manage/attempts/:id/annul", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!requireManager(req, res)) return;
  const got = await loadAttemptForManager(req, res);
  if (!got) return;
  const { a, exam } = got;
  if (a.status === "annulled") {
    res.status(409).json({ error: "Natija allaqachon bekor qilingan" });
    return;
  }
  const reason = String(req.body?.reason ?? "").trim().slice(0, 400) || null;
  let base = a;
  if (a.status === "in_progress") {
    const g = grade(exam, a.answersJson || {});
    base = { ...a, score: g.score, correct: g.correct, total: g.total, passed: g.passed, submittedAt: new Date() };
  }
  await db
    .update(attestatsiyaAttemptsTable)
    .set({
      status: "annulled",
      score: base.score,
      correct: base.correct,
      total: base.total,
      passed: base.passed,
      submittedAt: base.submittedAt,
      retakeAllowed: false,
      annulledById: req.userId!,
      annulledAt: new Date(),
      annulReason: reason,
      updatedAt: new Date(),
    })
    .where(eq(attestatsiyaAttemptsTable.id, a.id));
  void notifyUser({
    userId: a.userId,
    title: "Atestatsiya",
    text: `«${exam.title}» atestatsiyasidagi natijangiz bekor qilindi.${reason ? ` Sabab: ${reason}` : ""}`,
    type: "atestatsiya",
    linkUrl: "/atestatsiya",
  }).catch(() => undefined);
  res.json({ ok: true });
});

router.post("/atestatsiya/manage/attempts/:id/restore", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!requireManager(req, res)) return;
  const got = await loadAttemptForManager(req, res);
  if (!got) return;
  const { a } = got;
  if (a.status !== "annulled") {
    res.status(409).json({ error: "Faqat bekor qilingan natijani tiklash mumkin" });
    return;
  }
  await db
    .update(attestatsiyaAttemptsTable)
    .set({ status: "submitted", annulledById: null, annulledAt: null, annulReason: null, updatedAt: new Date() })
    .where(eq(attestatsiyaAttemptsTable.id, a.id));
  res.json({ ok: true });
});

router.post("/atestatsiya/manage/attempts/:id/finish", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!requireManager(req, res)) return;
  const got = await loadAttemptForManager(req, res);
  if (!got) return;
  const { a, exam } = got;
  if (a.status !== "in_progress") {
    res.status(409).json({ error: "Urinish allaqachon yakunlangan" });
    return;
  }
  const g = grade(exam, a.answersJson || {});
  await db
    .update(attestatsiyaAttemptsTable)
    .set({
      status: "submitted",
      submittedAt: new Date(),
      score: g.score,
      correct: g.correct,
      total: g.total,
      passed: g.passed,
      finishedById: req.userId!,
      updatedAt: new Date(),
    })
    .where(and(eq(attestatsiyaAttemptsTable.id, a.id), eq(attestatsiyaAttemptsTable.status, "in_progress")));
  res.json({ ok: true });
});

router.post("/atestatsiya/manage/:id/users/:userId/retake", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!requireManager(req, res)) return;
  const examId = Number(req.params.id);
  const userId = Number(req.params.userId);
  const [exam] = await db.select().from(attestatsiyaExamsTable).where(eq(attestatsiyaExamsTable.id, examId)).limit(1);
  if (!exam) {
    res.status(404).json({ error: "Atestatsiya topilmadi" });
    return;
  }
  const list = await loadAttempts(and(eq(attestatsiyaAttemptsTable.examId, examId), eq(attestatsiyaAttemptsTable.userId, userId)));
  const latest = latestOf(list);
  if (!latest) {
    res.status(409).json({ error: "Xodim hali testni boshlamagan — qayta topshirish shart emas" });
    return;
  }
  if (latest.status === "in_progress") {
    res.status(409).json({ error: "Xodim hozir test ishlayapti — avval yakunlang yoki bekor qiling" });
    return;
  }
  await db
    .update(attestatsiyaAttemptsTable)
    .set({ retakeAllowed: true, retakeGrantedById: req.userId!, retakeGrantedAt: new Date(), updatedAt: new Date() })
    .where(eq(attestatsiyaAttemptsTable.id, latest.id));
  const closed = windowState(exam) !== "open";
  void notifyUser({
    userId,
    title: "Atestatsiya",
    text: `«${exam.title}» atestatsiyasini qayta topshirishga ruxsat berildi.${closed ? ` Test vaqti: ${fmtDt(exam.startsAt)} – ${fmtDt(exam.endsAt)}.` : ""}`,
    type: "atestatsiya",
    linkUrl: "/atestatsiya",
  }).catch(() => undefined);
  res.json({ ok: true, windowOpen: !closed });
});

export default router;
