/**
 * Atestatsiya — stajyor / farmasevt / mudir uchun vaqt va joy bilan cheklangan test.
 *  - Test faqat belgilangan oynada (startsAt … endsAt) ochiladi.
 *  - branch: filial GPS; office: ofis GPS; anywhere: istalgan joy (GPS shart emas).
 *  - Boshlangach taymer: min(boshlangan + davomiylik, oyna tugashi). Vaqt tugasa saqlangan javoblar bilan yakunlanadi.
 *  - Admin / direktor / trener: kiritadi, jonli kuzatadi, natijani bekor qiladi yoki qayta topshirishga ruxsat beradi.
 */
import { Router, type IRouter, type Response } from "express";
import { and, asc, desc, eq, inArray, or, sql, type SQL } from "drizzle-orm";
import {
  db,
  attestatsiyaAttemptsTable,
  attestatsiyaBanksTable,
  attestatsiyaExamsTable,
  usersTable,
  type AttestatsiyaQuestionRow,
} from "@workspace/db";
import { requireAuth, type AuthRequest } from "../middlewares/auth";
import { canManageDarsliklar, darslikTrackForRole } from "../lib/roles";
import { resolveUserBranches } from "../lib/employee-branch";
import { haversineMeters } from "../lib/mobile-attendance";
import { notifyByRoles, notifyUser } from "../lib/notify";
import { DAVOMAT_OFFICE_GEOFENCE_METERS, DAVOMAT_SITE_LAT, DAVOMAT_SITE_LNG } from "./davomat";

const router: IRouter = Router();

/** Atestatsiya testi filial ichida ochiladi (davomat radiusidan alohida) */
const ATESTATSIYA_BRANCH_METERS = 70;

const TRACKS = ["stajyor", "farmasevt", "mudir"] as const;
type Track = (typeof TRACKS)[number];
const TRACK_LABEL: Record<Track, string> = { stajyor: "Stajyor", farmasevt: "Farmasevt", mudir: "Mudir" };

/** GPS xatoligi uchun zona chetiga qo‘shimcha */
const GEO_SLACK_M = 15;
/** Bundan past aniqlikdagi GPS qabul qilinmaydi */
const MAX_ACCURACY_M = 150;
/** Tarmoq kechikishi uchun: taymer tugagach shuncha vaqt ichida yuborilgan javob qabul qilinadi */
const SUBMIT_GRACE_MS = 30_000;
/** Admin startsAt/endsAt/davomiylikni o‘zgartirganda ishlayotganlarga ko‘rsatiladi */
const WINDOW_REFRESH_REASON = "Test vaqti yangilandi — qayta yangilang va boshidan boshlang";

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

function normalizePoolTracks(exam: Pick<Exam, "track" | "poolTracks">): Track[] {
  const raw = Array.isArray(exam.poolTracks) ? exam.poolTracks : [];
  const parsed = [...new Set(raw.map((t) => parseTrack(t)).filter((t): t is Track => Boolean(t)))];
  if (parsed.length) return parsed;
  const own = parseTrack(exam.track);
  return own ? [own] : ["stajyor"];
}

/** Kim testni ko‘radi / topshiradi */
function normalizeTargetTracks(exam: Pick<Exam, "track" | "targetTracks">): Track[] {
  const raw = Array.isArray(exam.targetTracks) ? exam.targetTracks : [];
  const parsed = [...new Set(raw.map((t) => parseTrack(t)).filter((t): t is Track => Boolean(t)))];
  if (parsed.length) return parsed;
  const own = parseTrack(exam.track);
  return own ? [own] : ["stajyor"];
}

function examVisibleTo(exam: Pick<Exam, "track" | "targetTracks">, role: Track): boolean {
  return normalizeTargetTracks(exam).includes(role);
}

type Bank = typeof attestatsiyaBanksTable.$inferSelect;

const BANK_TITLE: Record<Track, string> = {
  stajyor: "Stajyor savol bazasi",
  farmasevt: "Farmasevt savol bazasi",
  mudir: "Mudir savol bazasi",
};

/** Eski testlardagi savollarni bankka ko‘chirish (bank bo‘sh bo‘lsa) */
async function ensureBanksSeeded(): Promise<void> {
  for (const track of TRACKS) {
    const [existing] = await db
      .select()
      .from(attestatsiyaBanksTable)
      .where(eq(attestatsiyaBanksTable.track, track))
      .limit(1);
    if (existing && (existing.questionsJson || []).some((q) => q.text?.trim())) continue;

    const exams = await db
      .select({ id: attestatsiyaExamsTable.id, questionsJson: attestatsiyaExamsTable.questionsJson })
      .from(attestatsiyaExamsTable)
      .where(eq(attestatsiyaExamsTable.track, track))
      .orderBy(asc(attestatsiyaExamsTable.id));
    const out: AttestatsiyaQuestionRow[] = [];
    const seen = new Set<string>();
    for (const e of exams) {
      for (const q of e.questionsJson || []) {
        const text = String(q.text || "").trim();
        if (!text) continue;
        const key = text.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          id: String(q.id || "").trim() || `q-${track}-${out.length + 1}`,
          text: q.text,
          options: [...(q.options || [])],
          correctIndex: q.correctIndex,
        });
      }
    }
    if (existing) {
      if (out.length) {
        await db
          .update(attestatsiyaBanksTable)
          .set({ questionsJson: out, title: existing.title || BANK_TITLE[track], updatedAt: new Date() })
          .where(eq(attestatsiyaBanksTable.id, existing.id));
      }
    } else {
      await db.insert(attestatsiyaBanksTable).values({
        track,
        title: BANK_TITLE[track],
        questionsJson: out,
      });
    }
  }
}

async function loadBankCounts(): Promise<Record<Track, number>> {
  await ensureBanksSeeded();
  const rows = await db.select().from(attestatsiyaBanksTable);
  const counts: Record<Track, number> = { stajyor: 0, farmasevt: 0, mudir: 0 };
  for (const b of rows) {
    const t = parseTrack(b.track);
    if (!t) continue;
    counts[t] = (b.questionsJson || []).filter((q) => q.text?.trim()).length;
  }
  return counts;
}

/** Belgilangan lavozim bazalaridan birlashtirilgan savol pooli (matn bo‘yicha dedupe) */
async function resolveQuestionPool(exam: Exam): Promise<AttestatsiyaQuestionRow[]> {
  await ensureBanksSeeded();
  const tracks = normalizePoolTracks(exam);
  const banks = await db
    .select()
    .from(attestatsiyaBanksTable)
    .where(inArray(attestatsiyaBanksTable.track, tracks));

  const out: AttestatsiyaQuestionRow[] = [];
  const seenText = new Set<string>();
  for (const bank of banks) {
    const t = parseTrack(bank.track);
    if (!t || !tracks.includes(t)) continue;
    for (const q of bank.questionsJson || []) {
      const text = String(q.text || "").trim();
      if (!text) continue;
      const key = text.toLowerCase();
      if (seenText.has(key)) continue;
      seenText.add(key);
      out.push({
        id: `b${bank.id}__${q.id}`,
        text: q.text,
        options: [...(q.options || [])],
        correctIndex: q.correctIndex,
      });
    }
  }
  // Legacy: exam ichidagi savollar (eski yozuvlar) — bankda yo‘q bo‘lsa qo‘shiladi
  for (const q of exam.questionsJson || []) {
    const text = String(q.text || "").trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (seenText.has(key)) continue;
    seenText.add(key);
    out.push({
      id: q.id,
      text: q.text,
      options: [...(q.options || [])],
      correctIndex: q.correctIndex,
    });
  }
  return out;
}

function attemptQuestions(a: Attempt | null | undefined, exam: Exam, fallbackPool?: AttestatsiyaQuestionRow[]) {
  if (a?.questionsSnapshot?.length) return a.questionsSnapshot;
  if (fallbackPool?.length) return fallbackPool;
  return exam.questionsJson || [];
}

function grade(
  exam: Exam,
  answers: Record<string, number>,
  questionIds?: string[] | null,
  pool?: AttestatsiyaQuestionRow[] | null,
) {
  const questions = pool?.length ? pool : exam.questionsJson || [];
  const byId = new Map(questions.map((q) => [q.id, q]));
  const ids =
    questionIds && questionIds.length
      ? questionIds.filter((id) => byId.has(id))
      : questions.map((q) => q.id);
  const total = ids.length;
  let correct = 0;
  for (const id of ids) {
    const q = byId.get(id)!;
    if (answers[id] === q.correctIndex) correct += 1;
  }
  const score = total ? Math.round((correct / total) * 100) : 0;
  return { total, correct, score, passed: score >= (exam.passScore || 50) };
}

/** Client ko‘rsatilgan (aralashtirilgan) indeks yuboradi → asl indeksga o‘tkazamiz */
function sanitizeAnswers(
  questions: AttestatsiyaQuestionRow[],
  raw: unknown,
  optionOrders?: Record<string, number[]> | null,
): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw || typeof raw !== "object") return out;
  const byId = new Map(questions.map((q) => [q.id, q]));
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const q = byId.get(k);
    if (!q) continue;
    const n = Number(v);
    const perm = optionOrders?.[k];
    const max = perm?.length || q.options.length;
    if (!Number.isInteger(n) || n < 0 || n >= max) continue;
    out[k] = perm ? (perm[n] ?? n) : n;
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

/** Pool dan N ta tasodifiy savol + (ixtiyoriy) variant aralashtirish */
function buildAttemptPaper(
  exam: Exam,
  pool: AttestatsiyaQuestionRow[],
): { order: string[]; optionOrders: Record<string, number[]>; questions: AttestatsiyaQuestionRow[] } {
  const all = pool.map((q) => q.id);
  const want = Math.round(Number(exam.questionsPerAttempt) || 0);
  const take = want > 0 && want < all.length ? want : all.length;
  const shuffledIds = exam.shuffleQuestions !== false || take < all.length ? shuffled(all) : [...all];
  const order = shuffledIds.slice(0, take);
  const byId = new Map(pool.map((q) => [q.id, q]));
  const optionOrders: Record<string, number[]> = {};
  const shuffleOpts = exam.shuffleOptions !== false;
  const questions: AttestatsiyaQuestionRow[] = [];
  for (const id of order) {
    const q = byId.get(id);
    if (!q) continue;
    questions.push(q);
    const idxs = q.options.map((_, i) => i);
    optionOrders[id] = shuffleOpts ? shuffled(idxs) : idxs;
  }
  return { order, optionOrders, questions };
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
    const g = grade(exam, a.answersJson || {}, a.questionOrder, attemptQuestions(a, exam));
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

function learnerAttempt(a: Attempt, exam: Exam, withQuestions: boolean, poolFallback?: AttestatsiyaQuestionRow[]) {
  const reveal = exam.showResult && isFinished(a);
  const questions = attemptQuestions(a, exam, poolFallback);
  const byId = new Map(questions.map((q) => [q.id, q]));
  const order = (a.questionOrder?.length ? a.questionOrder : questions.map((q) => q.id)).filter((id) => byId.has(id));
  const review = reveal
    ? order.map((id, i) => {
        const q = byId.get(id)!;
        const chosen = (a.answersJson || {})[id];
        const ok = chosen === q.correctIndex;
        return {
          number: i + 1,
          questionId: q.id,
          question: q.text,
          options: [...(q.options || [])],
          chosenIndex: chosen ?? null,
          chosenText: chosen != null && q.options[chosen] != null ? q.options[chosen]! : "Javob bermagan",
          correctIndex: q.correctIndex,
          correctText: q.options[q.correctIndex] ?? "—",
          ok,
        };
      })
    : undefined;
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
    examTitle: exam.title,
    review,
    questions: withQuestions
      ? order.map((id) => {
          const q = byId.get(id)!;
          const perm = (a.optionOrders || {})[id];
          const options = perm?.length ? perm.map((i) => q.options[i]!).filter((x) => x != null) : q.options;
          return { id: q.id, text: q.text, options };
        })
      : undefined,
    /** Javoblar asl indeksda saqlanadi — UI uchun ko‘rsatilgan indeksga qayta map */
    answers: withQuestions
      ? (() => {
          const raw = a.answersJson || {};
          const mapped: Record<string, number> = {};
          for (const [qid, orig] of Object.entries(raw)) {
            const perm = (a.optionOrders || {})[qid];
            if (!perm?.length) {
              mapped[qid] = orig;
              continue;
            }
            const display = perm.indexOf(orig);
            if (display >= 0) mapped[qid] = display;
          }
          return mapped;
        })()
      : undefined,
  };
}

function startPolicy(exam: Exam, attempts: Attempt[]) {
  const latest = latestOf(attempts);
  const state = windowState(exam);
  const allowFailRetake = exam.retakeIfFailed !== false;
  if (latest?.status === "in_progress") {
    return { canStart: false, canResume: true, reason: null as string | null, hide: false };
  }
  if (state === "upcoming") {
    return { canStart: false, canResume: false, reason: `Test ${fmtDt(exam.startsAt)} da ochiladi`, hide: false };
  }
  if (state === "closed") return { canStart: false, canResume: false, reason: "Test vaqti tugagan", hide: false };
  if (!latest) return { canStart: true, canResume: false, reason: null as string | null, hide: false };
  if (latest.retakeAllowed) return { canStart: true, canResume: false, reason: null as string | null, hide: false };
  /** O‘tganlar ham kartochkada qoladi — natijasi («O‘tdingiz») shu yerda ko‘rinadi */
  if (isFinished(latest) && latest.passed === true) {
    return { canStart: false, canResume: false, reason: "Siz o‘tdingiz", hide: false };
  }
  /** O‘tmaganlar — qayta ishlashi mumkin */
  if (allowFailRetake && isFinished(latest) && latest.passed === false) {
    return { canStart: true, canResume: false, reason: null as string | null, hide: false };
  }
  if (latest.status === "annulled") {
    return allowFailRetake
      ? { canStart: true, canResume: false, reason: null as string | null, hide: false }
      : { canStart: false, canResume: false, reason: "Natijangiz bekor qilingan", hide: false };
  }
  return { canStart: false, canResume: false, reason: "Siz bu testni topshirgansiz", hide: false };
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
  const roleJson = JSON.stringify([who.track]);
  const forRole = or(
    and(
      sql`COALESCE(jsonb_array_length(${attestatsiyaExamsTable.targetTracks}), 0) = 0`,
      eq(attestatsiyaExamsTable.track, who.track),
    ),
    sql`${attestatsiyaExamsTable.targetTracks} @> ${roleJson}::jsonb`,
    eq(attestatsiyaExamsTable.track, who.track),
  );
  const exams = await db
    .select()
    .from(attestatsiyaExamsTable)
    .where(who.preview ? forRole : and(forRole, eq(attestatsiyaExamsTable.published, true)))
    .orderBy(desc(attestatsiyaExamsTable.startsAt))
    .limit(80);
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
        ? (e.questionsJson || []).length || normalizePoolTracks(e).some((t) => t !== e.track)
          ? { canStart: true, canResume: false, reason: null as string | null, hide: false }
          : { canStart: false, canResume: false, reason: "Testda savollar yo‘q", hide: false }
        : startPolicy(e, mine);
      return {
        id: e.id,
        title: e.title,
        description: e.description,
        durationMinutes: e.durationMinutes,
        passScore: e.passScore,
        questionCount: (() => {
          const pool = (e.questionsJson || []).length;
          const n = Math.round(Number(e.questionsPerAttempt) || 0);
          return n > 0 && n < pool ? n : pool;
        })(),
        poolCount: (e.questionsJson || []).length,
        poolTracks: normalizePoolTracks(e),
        retakeIfFailed: e.retakeIfFailed !== false,
        locationMode: e.locationMode,
        locationTarget:
          e.locationMode === "anywhere"
            ? "Istalgan joy"
            : e.locationMode === "office"
              ? "Asosiy ofis"
              : branch?.label || "O‘z filialingiz",
        startsAt: e.startsAt.toISOString(),
        endsAt: e.endsAt.toISOString(),
        window: windowState(e),
        published: e.published,
        attempt: latest ? learnerAttempt(latest, e, false) : null,
        attemptsCount: mine.length,
        ...policy,
      };
    })
    .filter((row) => who.preview || !row.hide)
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
  if (exam.locationMode === "anywhere") {
    return { ok: true, label: "Istalgan joy", branchId: null, distanceM: 0 };
  }
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
  if (d > ATESTATSIYA_BRANCH_METERS + GEO_SLACK_M) {
    return {
      ok: false,
      code: "outside_branch",
      error: `Test faqat o‘z filialingiz «${br.label || "Filial"}» ichida ochiladi. Siz ${d} m uzoqdasiz (ruxsat ${ATESTATSIYA_BRANCH_METERS} m).`,
      distanceM: d,
      allowedM: ATESTATSIYA_BRANCH_METERS,
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
  if (!exam || !exam.published || !examVisibleTo(exam, track)) {
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
  const pool = await resolveQuestionPool(exam);
  if (!pool.length) {
    res.status(409).json({ error: "Testda savollar yo‘q (bazalar bo‘sh)" });
    return;
  }

  const geo = await checkLocation(exam, req.userId!, (req.body || {}) as Record<string, unknown>);
  if (!geo.ok) {
    res.status(403).json(geo);
    return;
  }

  if (policy.canResume) {
    const current = latestOf(mine)!;
    res.json({ attempt: learnerAttempt(current, exam, true, pool), serverNow: new Date().toISOString(), resumed: true });
    return;
  }

  const now = new Date();
  const deadline = new Date(Math.min(now.getTime() + exam.durationMinutes * 60_000, exam.endsAt.getTime()));
  const paper = buildAttemptPaper(exam, pool);
  const body = (req.body || {}) as Record<string, unknown>;
  const [created] = await db
    .insert(attestatsiyaAttemptsTable)
    .values({
      examId,
      userId: req.userId!,
      attemptNo: (latestOf(mine)?.attemptNo ?? 0) + 1,
      status: "in_progress",
      questionOrder: paper.order,
      optionOrders: paper.optionOrders,
      questionsSnapshot: paper.questions,
      answersJson: {},
      startedAt: now,
      deadlineAt: deadline,
      total: paper.order.length,
      locationMode: exam.locationMode,
      locationLabel: geo.label,
      branchId: geo.branchId,
      distanceM: geo.distanceM,
      latitude: Number.isFinite(Number(body.latitude)) ? Number(body.latitude) : null,
      longitude: Number.isFinite(Number(body.longitude)) ? Number(body.longitude) : null,
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
  res.json({ attempt: learnerAttempt(attempt, exam, true, pool), serverNow: new Date().toISOString(), resumed: !created });
});

function practiceAttempt(
  exam: Exam,
  withQuestions: boolean,
  order: string[],
  optionOrders: Record<string, number[]>,
  pool: AttestatsiyaQuestionRow[],
) {
  const now = new Date();
  const deadline = new Date(now.getTime() + exam.durationMinutes * 60_000);
  const byId = new Map(pool.map((q) => [q.id, q]));
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
          .map((q) => {
            const perm = optionOrders[q.id];
            const options = perm?.length ? perm.map((i) => q.options[i]!).filter((x) => x != null) : q.options;
            return { id: q.id, text: q.text, options };
          })
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
  const pool = await resolveQuestionPool(exam);
  if (!pool.length) {
    res.status(409).json({ error: "Testda savollar yo‘q (bazalar bo‘sh)" });
    return;
  }
  const paper = buildAttemptPaper(exam, pool);
  res.json({
    attempt: practiceAttempt(exam, true, paper.order, paper.optionOrders, paper.questions),
    optionOrders: paper.optionOrders,
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
  const optionOrders =
    req.body?.optionOrders && typeof req.body.optionOrders === "object"
      ? (req.body.optionOrders as Record<string, number[]>)
      : {};
  const pool = await resolveQuestionPool(exam);
  const order = Array.isArray(req.body?.questionOrder)
    ? (req.body.questionOrder as string[]).filter((id) => typeof id === "string")
    : pool.map((q) => q.id);
  const paperQs = order.map((id) => pool.find((q) => q.id === id)).filter((q): q is AttestatsiyaQuestionRow => Boolean(q));
  const answers = sanitizeAnswers(paperQs.length ? paperQs : pool, req.body?.answers, optionOrders);
  const g = grade(exam, answers, order, paperQs.length ? paperQs : pool);
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
  if (a.status === "annulled") {
    res.status(409).json({
      error: a.annulReason || WINDOW_REFRESH_REASON,
      code: "window_updated",
    });
    return;
  }
  if (a.status !== "in_progress" || Date.now() > a.deadlineAt.getTime() + SUBMIT_GRACE_MS) {
    res.status(409).json({ error: "Vaqt tugagan", code: "closed" });
    return;
  }
  const qs = attemptQuestions(a, exam);
  const answers = {
    ...(a.answersJson || {}),
    ...sanitizeAnswers(qs, req.body?.answers, a.optionOrders),
  };
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
  if (a.status === "annulled") {
    res.status(409).json({
      error: a.annulReason || WINDOW_REFRESH_REASON,
      code: "window_updated",
    });
    return;
  }
  if (a.status !== "in_progress") {
    res.json({ attempt: learnerAttempt(a, exam, false), serverNow: new Date().toISOString() });
    return;
  }
  const qs = attemptQuestions(a, exam);
  const late = Date.now() > a.deadlineAt.getTime() + SUBMIT_GRACE_MS;
  const answers = late
    ? a.answersJson || {}
    : { ...(a.answersJson || {}), ...sanitizeAnswers(qs, req.body?.answers, a.optionOrders) };
  const g = grade(exam, answers, a.questionOrder, qs);
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
  questionsPerAttempt: number | null;
  poolTracks: Track[];
  targetTracks: Track[];
  locationMode: "branch" | "office" | "anywhere";
  startsAt: Date;
  endsAt: Date;
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
  showResult: boolean;
  retakeIfFailed: boolean;
  published: boolean;
};

function parseExamBody(body: Record<string, unknown> | undefined, examTrack: Track): ExamInput | { error: string } {
  const title = String(body?.title ?? "").trim().slice(0, 200);
  if (!title) return { error: "Atestatsiya nomini yozing" };
  const description = String(body?.description ?? "").trim().slice(0, 3000);

  const rawPool = Array.isArray(body?.poolTracks) ? body!.poolTracks : null;
  let poolTracks: Track[] = rawPool
    ? [...new Set(rawPool.map((t) => parseTrack(t)).filter((t): t is Track => Boolean(t)))]
    : [examTrack];
  if (!poolTracks.length) poolTracks = [examTrack];

  const rawTargets = Array.isArray(body?.targetTracks) ? body!.targetTracks : null;
  let targetTracks: Track[] = rawTargets
    ? [...new Set(rawTargets.map((t) => parseTrack(t)).filter((t): t is Track => Boolean(t)))]
    : [examTrack];
  if (!targetTracks.length) targetTracks = [examTrack];

  // Yangi atestatsiyalar savolni bankdan oladi — exam.questions bo‘sh bo‘lishi mumkin
  const rawQs = Array.isArray(body?.questions) ? body!.questions : [];
  const questionsJson: AttestatsiyaQuestionRow[] = [];
  for (let i = 0; i < rawQs.length; i++) {
    const q = rawQs[i] as Record<string, unknown>;
    const text = String(q?.text ?? "").trim();
    const options = Array.isArray(q?.options) ? q.options.map((o) => String(o ?? "").trim()).filter(Boolean) : [];
    const correctIndex = Number(q?.correctIndex);
    if (!text && !options.length) continue;
    if (!text) return { error: `${i + 1}-savol matnini yozing` };
    if (options.length < 2) return { error: `${i + 1}-savolda kamida 2 ta variant bo‘lsin` };
    if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex >= options.length) {
      return { error: `${i + 1}-savolda to‘g‘ri javobni belgilang` };
    }
    const id = String(q?.id ?? "").trim() || `q-${i + 1}-${Date.now()}`;
    questionsJson.push({ id, text, options, correctIndex });
  }
  if (!poolTracks.length) {
    return { error: "Kamida bitta savol bazasini tanlang" };
  }

  const passScore = Math.round(Number(body?.passScore ?? 50));
  if (!Number.isFinite(passScore) || passScore < 1 || passScore > 100) return { error: "O‘tish bali 1–100 oralig‘ida bo‘lsin" };
  const durationMinutes = Math.round(Number(body?.durationMinutes ?? 30));
  if (!Number.isFinite(durationMinutes) || durationMinutes < 1 || durationMinutes > 600) {
    return { error: "Test davomiyligi 1–600 daqiqa bo‘lsin" };
  }
  const rawAsk = body?.questionsPerAttempt;
  let questionsPerAttempt: number | null = null;
  if (rawAsk != null && String(rawAsk).trim() !== "") {
    const n = Math.round(Number(rawAsk));
    if (!Number.isFinite(n) || n < 1) return { error: "Har bir xodimga ko‘rinadigan savol soni 1 dan katta bo‘lsin" };
    questionsPerAttempt = n;
  }
  const locationMode =
    body?.locationMode === "office"
      ? "office"
      : body?.locationMode === "anywhere"
        ? "anywhere"
        : body?.locationMode === "branch"
          ? "branch"
          : null;
  if (!locationMode) return { error: "Joyni tanlang: filial, ofis yoki istalgan joy" };

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
    questionsPerAttempt,
    poolTracks,
    targetTracks,
    locationMode,
    startsAt,
    endsAt,
    shuffleQuestions: body?.shuffleQuestions !== false,
    shuffleOptions: body?.shuffleOptions !== false,
    showResult: body?.showResult !== false,
    retakeIfFailed: body?.retakeIfFailed !== false,
    published: body?.published !== false,
  };
}

function estimatePoolCount(e: Exam, banks: Record<Track, number>): number {
  const tracks = normalizePoolTracks(e);
  let n = tracks.reduce((s, t) => s + (banks[t] || 0), 0);
  // Legacy exam-local savollar (bankda yo‘q deb hisoblab qo‘shamiz emas — faqat bank)
  if (!n) n = (e.questionsJson || []).filter((q) => q.text?.trim()).length;
  return n;
}

function manageExam(e: Exam, banks?: Record<Track, number>) {
  const pool = banks ? estimatePoolCount(e, banks) : (e.questionsJson || []).length;
  const ask = Math.round(Number(e.questionsPerAttempt) || 0);
  const poolTracks = normalizePoolTracks(e);
  return {
    id: e.id,
    track: e.track,
    title: e.title,
    description: e.description,
    questions: e.questionsJson || [],
    passScore: e.passScore,
    durationMinutes: e.durationMinutes,
    questionsPerAttempt: ask > 0 && ask < pool ? ask : null,
    poolTracks,
    targetTracks: normalizeTargetTracks(e),
    poolCount: pool,
    askCount: ask > 0 && ask < pool ? ask : pool,
    locationMode: e.locationMode,
    startsAt: e.startsAt.toISOString(),
    endsAt: e.endsAt.toISOString(),
    shuffleQuestions: e.shuffleQuestions,
    shuffleOptions: e.shuffleOptions !== false,
    showResult: e.showResult,
    retakeIfFailed: e.retakeIfFailed !== false,
    published: e.published,
    window: windowState(e),
    updatedAt: e.updatedAt.toISOString(),
  };
}

async function notifyPublished(e: Exam) {
  const where =
    e.locationMode === "anywhere" ? "istalgan joydan" : e.locationMode === "office" ? "asosiy ofisda" : "o‘z filialingizda";
  const roles = normalizeTargetTracks(e);
  await notifyByRoles({
    roles,
    title: "Atestatsiya",
    text: `«${e.title}» atestatsiyasi: ${fmtDt(e.startsAt)} – ${fmtDt(e.endsAt)}. Test ${where} ochiladi, davomiyligi ${e.durationMinutes} daqiqa.`,
    type: "atestatsiya",
    linkUrl: "/atestatsiya",
  }).catch(() => undefined);
}

function examWindowChanged(
  before: Pick<Exam, "startsAt" | "endsAt" | "durationMinutes">,
  after: Pick<ExamInput, "startsAt" | "endsAt" | "durationMinutes">,
) {
  return (
    before.startsAt.getTime() !== after.startsAt.getTime() ||
    before.endsAt.getTime() !== after.endsAt.getTime() ||
    before.durationMinutes !== after.durationMinutes
  );
}

async function targetLearners(exam: Exam) {
  const roles = normalizeTargetTracks(exam);
  return db
    .select({ id: usersTable.id, fullName: usersTable.fullName, phone: usersTable.phone })
    .from(usersTable)
    .where(and(inArray(usersTable.role, roles), inArray(usersTable.status, ["active", "on_leave"])))
    .orderBy(asc(usersTable.fullName));
}

/**
 * Vaqt/davomiylik o‘zgarganda:
 *  - ishlayotgan urinishlar bekor (qayta boshlash uchun);
 *  - o‘tmaganlarga retake;
 *  - o‘tmagan / ishlamaganlarga bildirishnoma (o‘tganlarga yo‘q).
 */
async function applyWindowChangeEffects(exam: Exam, actorId: number) {
  const now = new Date();
  const inProg = await db
    .select()
    .from(attestatsiyaAttemptsTable)
    .where(and(eq(attestatsiyaAttemptsTable.examId, exam.id), eq(attestatsiyaAttemptsTable.status, "in_progress")));
  for (const a of inProg) {
    await db
      .update(attestatsiyaAttemptsTable)
      .set({
        status: "annulled",
        submittedAt: now,
        passed: false,
        retakeAllowed: true,
        retakeGrantedById: actorId,
        retakeGrantedAt: now,
        annulledById: actorId,
        annulledAt: now,
        annulReason: WINDOW_REFRESH_REASON,
        updatedAt: now,
      })
      .where(and(eq(attestatsiyaAttemptsTable.id, a.id), eq(attestatsiyaAttemptsTable.status, "in_progress")));
  }

  const all = await loadAttempts(eq(attestatsiyaAttemptsTable.examId, exam.id));
  const latestByUser = new Map<number, Attempt>();
  for (const a of all) latestByUser.set(a.userId, a);
  for (const a of latestByUser.values()) {
    if (isFinished(a) && a.passed === true) continue;
    if (a.retakeAllowed) continue;
    await db
      .update(attestatsiyaAttemptsTable)
      .set({
        retakeAllowed: true,
        retakeGrantedById: actorId,
        retakeGrantedAt: now,
        updatedAt: now,
      })
      .where(eq(attestatsiyaAttemptsTable.id, a.id));
  }

  if (!exam.published) return;

  const users = await targetLearners(exam);
  const refreshed = await loadAttempts(eq(attestatsiyaAttemptsTable.examId, exam.id));
  const latestAfter = new Map<number, Attempt>();
  for (const a of refreshed) latestAfter.set(a.userId, a);
  const text = `«${exam.title}» atestatsiyasi vaqti yangilandi: ${fmtDt(exam.startsAt)} – ${fmtDt(exam.endsAt)} (${exam.durationMinutes} daq). Ishlamagan yoki o‘tmaganlar qayta topshirishi mumkin. Agar test ochiq bo‘lsa — sahifani yangilang va boshidan boshlang.`;
  for (const u of users) {
    const latest = latestAfter.get(u.id);
    if (latest && isFinished(latest) && latest.passed === true) continue;
    void notifyUser({
      userId: u.id,
      title: "Atestatsiya",
      text,
      type: "atestatsiya",
      linkUrl: "/atestatsiya",
    }).catch(() => undefined);
  }
}

async function activeLearners(track: Track) {
  return db
    .select({ id: usersTable.id, fullName: usersTable.fullName, phone: usersTable.phone })
    .from(usersTable)
    .where(and(eq(usersTable.role, track), inArray(usersTable.status, ["active", "on_leave"])))
    .orderBy(asc(usersTable.fullName));
}

function parseBankQuestions(raw: unknown): AttestatsiyaQuestionRow[] | { error: string } {
  if (!Array.isArray(raw)) return { error: "Savollar ro‘yxati noto‘g‘ri" };
  const questionsJson: AttestatsiyaQuestionRow[] = [];
  for (let i = 0; i < raw.length; i++) {
    const q = raw[i] as Record<string, unknown>;
    const text = String(q?.text ?? "").trim();
    const options = Array.isArray(q?.options) ? q.options.map((o) => String(o ?? "").trim()).filter(Boolean) : [];
    const correctIndex = Number(q?.correctIndex);
    if (!text && !options.length) continue;
    if (!text) return { error: `${i + 1}-savol matnini yozing` };
    if (options.length < 2) return { error: `${i + 1}-savolda kamida 2 ta variant bo‘lsin` };
    if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex >= options.length) {
      return { error: `${i + 1}-savolda to‘g‘ri javobni belgilang` };
    }
    const id = String(q?.id ?? "").trim() || `q-${i + 1}-${Date.now()}`;
    questionsJson.push({ id, text, options, correctIndex });
  }
  return questionsJson;
}

/** Barcha lavozim bazalari (admin) */
router.get("/atestatsiya/manage/banks", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!requireManager(req, res)) return;
  await ensureBanksSeeded();
  const rows = await db.select().from(attestatsiyaBanksTable);
  const byTrack = new Map(rows.map((b) => [b.track, b]));
  res.json({
    banks: TRACKS.map((t) => {
      const b = byTrack.get(t);
      const questions = (b?.questionsJson || []).filter((q) => q.text?.trim());
      return {
        track: t,
        label: TRACK_LABEL[t],
        title: b?.title || BANK_TITLE[t],
        count: questions.length,
        questions,
        updatedAt: b?.updatedAt?.toISOString() ?? null,
      };
    }),
  });
});

router.get("/atestatsiya/manage/banks/:track", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!requireManager(req, res)) return;
  const track = parseTrack(req.params.track);
  if (!track) {
    res.status(400).json({ error: "Yo‘nalish noto‘g‘ri" });
    return;
  }
  await ensureBanksSeeded();
  const [b] = await db.select().from(attestatsiyaBanksTable).where(eq(attestatsiyaBanksTable.track, track)).limit(1);
  const questions = (b?.questionsJson || []).filter((q) => q.text?.trim());
  res.json({
    bank: {
      track,
      label: TRACK_LABEL[track],
      title: b?.title || BANK_TITLE[track],
      count: questions.length,
      questions,
      updatedAt: b?.updatedAt?.toISOString() ?? null,
    },
  });
});

router.put("/atestatsiya/manage/banks/:track", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!requireManager(req, res)) return;
  const track = parseTrack(req.params.track);
  if (!track) {
    res.status(400).json({ error: "Yo‘nalish noto‘g‘ri" });
    return;
  }
  const parsed = parseBankQuestions(req.body?.questions);
  if ("error" in parsed) {
    res.status(400).json(parsed);
    return;
  }
  const title = String(req.body?.title ?? BANK_TITLE[track]).trim().slice(0, 200) || BANK_TITLE[track];
  await ensureBanksSeeded();
  const [existing] = await db.select().from(attestatsiyaBanksTable).where(eq(attestatsiyaBanksTable.track, track)).limit(1);
  let bank: Bank;
  if (existing) {
    const [upd] = await db
      .update(attestatsiyaBanksTable)
      .set({
        title,
        questionsJson: parsed,
        updatedById: req.userId!,
        updatedAt: new Date(),
      })
      .where(eq(attestatsiyaBanksTable.id, existing.id))
      .returning();
    bank = upd!;
  } else {
    const [ins] = await db
      .insert(attestatsiyaBanksTable)
      .values({
        track,
        title,
        questionsJson: parsed,
        updatedById: req.userId!,
      })
      .returning();
    bank = ins!;
  }
  const questions = (bank.questionsJson || []).filter((q) => q.text?.trim());
  res.json({
    bank: {
      track,
      label: TRACK_LABEL[track],
      title: bank.title || BANK_TITLE[track],
      count: questions.length,
      questions,
      updatedAt: bank.updatedAt.toISOString(),
    },
  });
});

/** Tanlangan bazalardagi savollar preview (atestatsiya formasi uchun) */
router.get("/atestatsiya/manage/bank-questions", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!requireManager(req, res)) return;
  await ensureBanksSeeded();
  const raw = String(req.query.tracks ?? "")
    .split(",")
    .map((s) => parseTrack(s.trim()))
    .filter((t): t is Track => Boolean(t));
  const tracks = [...new Set(raw)];
  if (!tracks.length) {
    res.json({ tracks: [], total: 0 });
    return;
  }
  const banks = await db
    .select()
    .from(attestatsiyaBanksTable)
    .where(inArray(attestatsiyaBanksTable.track, tracks));
  const byTrack = new Map(banks.map((b) => [parseTrack(b.track), b]));
  const groups = tracks.map((t) => {
    const b = byTrack.get(t);
    const questions = (b?.questionsJson || [])
      .filter((q) => q.text?.trim())
      .slice(0, 200)
      .map((q) => ({
        id: q.id,
        text: q.text,
        options: [...(q.options || [])],
        correctIndex: q.correctIndex,
        sourceTitle: b?.title || BANK_TITLE[t],
      }));
    return {
      key: t,
      label: TRACK_LABEL[t],
      count: (b?.questionsJson || []).filter((q) => q.text?.trim()).length,
      questions,
    };
  });
  res.json({
    tracks: groups,
    total: groups.reduce((s, g) => s + g.count, 0),
  });
});

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
  const banks = await loadBankCounts();

  res.json({
    track,
    trackLabel: TRACK_LABEL[track],
    targets,
    bankCounts: banks,
    tracks: TRACKS.map((t) => ({
      key: t,
      label: TRACK_LABEL[t],
      total: all.filter((e) => e.track === t).length,
      open: all.filter((e) => e.track === t && e.published && windowState(e) === "open").length,
      questions: banks[t],
    })),
    exams: exams.map((e) => {
      const latestByUser = new Map<number, Attempt>();
      for (const a of attempts) if (a.examId === e.id) latestByUser.set(a.userId, a);
      const latest = [...latestByUser.values()];
      const finished = latest.filter(isFinished);
      return {
        ...manageExam(e, banks),
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

/**
 * Natijalar — lavozim (auditoriya) bo‘yicha:
 * shu roldagi xodimlar + ularga e’lon qilingan testlar.
 */
router.get("/atestatsiya/manage/results", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!requireManager(req, res)) return;
  const track = parseTrack(req.query.track) || "stajyor";
  const allExams = await db.select().from(attestatsiyaExamsTable).orderBy(desc(attestatsiyaExamsTable.startsAt));
  const exams = allExams.filter((e) => examVisibleTo(e, track));
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
        .select({ id: usersTable.id, fullName: usersTable.fullName, phone: usersTable.phone, role: usersTable.role })
        .from(usersTable)
        .where(inArray(usersTable.id, extraIds))
    : [];
  const people = [
    ...learners.map((p) => ({ ...p, role: track })),
    ...extra.filter((p) => parseTrack(p.role) === track || !parseTrack(p.role)),
  ];
  const branches = await resolveUserBranches(people.map((p) => p.id));
  const byExamUser = new Map<string, Attempt[]>();
  for (const a of attempts) {
    const key = `${a.examId}:${a.userId}`;
    const list = byExamUser.get(key) || [];
    list.push(a);
    byExamUser.set(key, list);
  }

  const now = Date.now();
  const rows = exams.flatMap((exam) =>
    people.map((p) => {
      const list = byExamUser.get(`${exam.id}:${p.id}`) || [];
      const a = latestOf(list);
      const br = branches.get(p.id);
      const status = a ? a.status : "not_started";
      const windowClosed = now >= exam.endsAt.getTime();
      // Kirmagan = umuman boshlamagan (muddat ochiq/yopiq farqi yo‘q)
      const missed = status === "not_started";
      return {
        examId: exam.id,
        examTitle: exam.title,
        passScore: exam.passScore,
        locationMode: exam.locationMode,
        durationMinutes: exam.durationMinutes,
        windowStart: exam.startsAt.toISOString(),
        windowEnd: exam.endsAt.toISOString(),
        windowClosed,
        published: exam.published,
        userId: p.id,
        fullName: p.fullName,
        phone: p.phone || null,
        role: track,
        branchLabel: br?.label || null,
        status,
        missed,
        score: a?.score ?? null,
        correct: a?.correct ?? null,
        answered: a ? answeredCount(a) : 0,
        total: a?.total || exam.questionsPerAttempt || (exam.questionsJson || []).length || 0,
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
  const failed = finished.filter((r) => r.passed === false).length;
  const missed = rows.filter((r) => r.missed || r.status === "not_started").length;
  res.json({
    track,
    trackLabel: TRACK_LABEL[track],
    exams: exams.map((e) => ({
      id: e.id,
      title: e.title,
      published: e.published,
      window: windowState(e),
      startsAt: e.startsAt.toISOString(),
      endsAt: e.endsAt.toISOString(),
    })),
    stats: {
      people: people.length,
      exams: exams.length,
      rows: rows.length,
      notStarted: missed,
      missed,
      inProgress: rows.filter((r) => r.status === "in_progress").length,
      finished: finished.length,
      passed,
      failed,
      annulled: rows.filter((r) => r.status === "annulled").length,
      passRate: finished.length ? Math.round((passed / finished.length) * 100) : null,
      avgScore: scores.length ? Math.round(scores.reduce((s, v) => s + v, 0) / scores.length) : null,
    },
    rows,
  });
});

async function clampAskAgainstPool(input: ExamInput, track: Track, examId?: number | null) {
  const draft = {
    id: examId ?? 0,
    track,
    questionsJson: input.questionsJson,
    poolTracks: input.poolTracks,
    questionsPerAttempt: input.questionsPerAttempt,
  } as Exam;
  const pool = await resolveQuestionPool(draft);
  if (!pool.length) {
    return {
      error: "Tanlangan savol bazasi bo‘sh. Avval «Test bazasi» bo‘limida savol kiriting.",
    } as const;
  }
  let questionsPerAttempt = input.questionsPerAttempt;
  if (questionsPerAttempt != null) {
    if (questionsPerAttempt > pool.length) {
      return { error: `Har biriga ko‘rinadigan savol soni pooldan (${pool.length}) oshmasin` } as const;
    }
    if (questionsPerAttempt === pool.length) questionsPerAttempt = null;
  }
  return { ...input, questionsPerAttempt, poolSize: pool.length } as const;
}

router.post("/atestatsiya/manage", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!requireManager(req, res)) return;
  const track = parseTrack(req.body?.track);
  if (!track) {
    res.status(400).json({ error: "Yo‘nalish noto‘g‘ri" });
    return;
  }
  const parsed = parseExamBody(req.body, track);
  if ("error" in parsed) {
    res.status(400).json(parsed);
    return;
  }
  const input = await clampAskAgainstPool(parsed, track, null);
  if ("error" in input) {
    res.status(400).json(input);
    return;
  }
  const { poolSize: _poolSize, ...values } = input;
  // Yangi atestatsiya: savollar faqat bankdan — exam.questions bo‘sh
  values.questionsJson = [];
  const [created] = await db
    .insert(attestatsiyaExamsTable)
    .values({ ...values, track, createdById: req.userId!, updatedById: req.userId! })
    .returning();
  if (created!.published) void notifyPublished(created!);
  const banks = await loadBankCounts();
  res.json({ exam: manageExam(created!, banks) });
});

router.put("/atestatsiya/manage/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!requireManager(req, res)) return;
  const id = Number(req.params.id);
  const [existing] = await db.select().from(attestatsiyaExamsTable).where(eq(attestatsiyaExamsTable.id, id)).limit(1);
  if (!existing) {
    res.status(404).json({ error: "Atestatsiya topilmadi" });
    return;
  }
  const track = (parseTrack(existing.track) || parseTrack(req.body?.track) || "stajyor") as Track;
  const parsed = parseExamBody(req.body, track);
  if ("error" in parsed) {
    res.status(400).json(parsed);
    return;
  }
  const input = await clampAskAgainstPool(parsed, track, id);
  if ("error" in input) {
    res.status(400).json(input);
    return;
  }
  const [hasAttempt] = await db
    .select({ id: attestatsiyaAttemptsTable.id })
    .from(attestatsiyaAttemptsTable)
    .where(eq(attestatsiyaAttemptsTable.examId, id))
    .limit(1);
  // Savollar endi bankda — exam.questions o‘zgarsa faqat eski yozuvlarda tekshiramiz
  if (
    hasAttempt &&
    (existing.questionsJson || []).length > 0 &&
    JSON.stringify(existing.questionsJson) !== JSON.stringify(input.questionsJson)
  ) {
    res.status(409).json({
      error: "Xodimlar testni boshlagan — eski lokal savollarni o‘zgartirib bo‘lmaydi. Vaqt, joy va sozlamalarni o‘zgartirish mumkin.",
    });
    return;
  }
  const { poolSize: _poolSize, ...values } = input;
  // Yangi oqim: savollar bankda — exam ichida bo‘sh saqlaymiz (eski lokal savollarni saqlab qolamiz agar bor bo‘lsa)
  if (!values.questionsJson.length && (existing.questionsJson || []).length) {
    values.questionsJson = existing.questionsJson || [];
  }
  const windowChanged = examWindowChanged(existing, input);
  const [updated] = await db
    .update(attestatsiyaExamsTable)
    .set({ ...values, updatedById: req.userId!, updatedAt: new Date() })
    .where(eq(attestatsiyaExamsTable.id, id))
    .returning();
  if (windowChanged) {
    await applyWindowChangeEffects(updated!, req.userId!);
  }
  if (!existing.published && updated!.published) void notifyPublished(updated!);
  const banks = await loadBankCounts();
  res.json({
    exam: manageExam(updated!, banks),
    windowChanged,
  });
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
  const targetRoles = normalizeTargetTracks(exam);
  const learnerLists = await Promise.all(targetRoles.map((t) => activeLearners(t)));
  const learnersById = new Map<number, { id: number; fullName: string; phone: string | null }>();
  for (const list of learnerLists) {
    for (const u of list) learnersById.set(u.id, u);
  }
  const learners = [...learnersById.values()];
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

  const statsByKey = new Map<string, { id: string; text: string; answered: number; correct: number }>();
  for (const a of finished) {
    const qs = attemptQuestions(a, exam);
    const byQ = new Map(qs.map((q) => [q.id, q]));
    for (const id of a.questionOrder?.length ? a.questionOrder : qs.map((q) => q.id)) {
      const q = byQ.get(id);
      if (!q) continue;
      const key = q.text.trim().toLowerCase() || q.id;
      const row = statsByKey.get(key) || { id: q.id, text: q.text, answered: 0, correct: 0 };
      const v = (a.answersJson || {})[q.id];
      if (v !== undefined) {
        row.answered += 1;
        if (v === q.correctIndex) row.correct += 1;
      }
      statsByKey.set(key, row);
    }
  }
  const questionStats = [...statsByKey.values()].map((q, i) => ({
    number: i + 1,
    id: q.id,
    text: q.text,
    answered: q.answered,
    correct: q.correct,
    percent: finished.length ? Math.round((q.correct / finished.length) * 100) : null,
  }));

  const nameById = new Map(people.map((p) => [p.id, p.fullName]));
  const answerSheets = finished.map((a) => {
    const qs = attemptQuestions(a, exam);
    const byQ = new Map(qs.map((q) => [q.id, q]));
    const order = (a.questionOrder?.length ? a.questionOrder : qs.map((q) => q.id)).filter((id) => byQ.has(id));
    return {
      userId: a.userId,
      fullName: nameById.get(a.userId) || `ID ${a.userId}`,
      score: a.score,
      correct: a.correct,
      total: a.total || order.length,
      passed: a.passed,
      items: order.map((qid, i) => {
        const q = byQ.get(qid)!;
        const chosen = (a.answersJson || {})[qid];
        const ok = chosen === q.correctIndex;
        return {
          number: i + 1,
          questionId: q.id,
          question: q.text,
          chosenIndex: chosen ?? null,
          chosenText: chosen != null && q.options[chosen] != null ? q.options[chosen]! : "—",
          correctIndex: q.correctIndex,
          correctText: q.options[q.correctIndex] ?? "—",
          ok,
        };
      }),
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

  const banks = await loadBankCounts();
  res.json({
    exam: manageExam(exam, banks),
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
    answerSheets,
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
    const g = grade(exam, a.answersJson || {}, a.questionOrder, attemptQuestions(a, exam));
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
  const g = grade(exam, a.answersJson || {}, a.questionOrder, attemptQuestions(a, exam));
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
