import { Router, type IRouter } from "express";
import { asc, eq, inArray } from "drizzle-orm";
import { db, pool, usersTable, kirishProgressTable } from "@workspace/db";
import type { AuthRequest } from "../middlewares/auth";
import { requireAuth } from "../middlewares/auth";
import { canManageStudents, STUDENT_ROLE } from "../lib/roles";
import { KIRISH_PASS_SCORE } from "../lib/kirish-content";
import { loadStageDefs, progressSummary } from "../lib/kirish-stages";
import { purgeUserCompletely } from "../lib/dismiss-user";
import { newCredWorkbook, paintCredSheet, sendWorkbook } from "../lib/cred-excel";
import { formatPersonName } from "../lib/person-name";

const router: IRouter = Router();

const STATUS_LABEL: Record<string, string> = {
  not_started: "Boshlamagan",
  in_progress: "O‘qimoqda",
  completed: "Yakunlagan",
  ready_for_hire: "Yakunlagan",
  hired: "Yakunlagan",
};

function guard(req: AuthRequest, res: import("express").Response): boolean {
  if (!canManageStudents(req.userRole)) {
    res.status(403).json({ error: "O‘quvchilar bo‘limi faqat trenerlar uchun" });
    return false;
  }
  return true;
}

function latinSlug(input: string): string {
  const map: Record<string, string> = {
    а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo", ж: "j", з: "z",
    и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
    с: "s", т: "t", у: "u", ф: "f", х: "x", ц: "ts", ч: "ch", ш: "sh", щ: "sh",
    ъ: "", ы: "i", ь: "", э: "e", ю: "yu", я: "ya",
    ў: "o", қ: "q", ғ: "g", ҳ: "h",
  };
  let s = input.trim().toLowerCase();
  s = s.replace(/o['ʻ’`]/g, "o").replace(/g['ʻ’`]/g, "g");
  let out = "";
  for (const ch of s) out += map[ch] ?? ch;
  out = out.replace(/[^a-z0-9]+/g, "").slice(0, 14);
  return out || "user";
}

function randomPassword(len = 8): string {
  const chars = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let pwd = "";
  for (let i = 0; i < len; i++) pwd += chars[Math.floor(Math.random() * chars.length)];
  return pwd;
}

async function loginTaken(login: string, exceptId?: number): Promise<boolean> {
  const [row] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.login, login)).limit(1);
  return Boolean(row && row.id !== exceptId);
}

async function uniqueLogin(fullName: string): Promise<string> {
  const base = `oquvchi_${latinSlug(fullName)}`;
  let candidate = base;
  for (let i = 0; i < 50; i++) {
    if (!(await loginTaken(candidate))) return candidate;
    candidate = `${base}${i + 2}`;
  }
  return `${base}_${Date.now().toString(36).slice(-4)}`;
}

function cleanLogin(raw: unknown): string {
  return String(raw ?? "").trim().toLowerCase().replace(/\s+/g, "");
}

type ProfileRow = { user_id: number; group_name: string | null; note: string | null; created_by_id: number | null };

async function profilesFor(ids: number[]): Promise<Map<number, ProfileRow>> {
  if (!ids.length) return new Map();
  const { rows } = await pool.query<ProfileRow>(
    "SELECT user_id, group_name, note, created_by_id FROM oquvchi_profiles WHERE user_id = ANY($1::int[])",
    [ids],
  );
  return new Map(rows.map((r) => [Number(r.user_id), r]));
}

async function upsertProfile(userId: number, groupName: string | null, note: string | null, createdById?: number | null) {
  await pool.query(
    `INSERT INTO oquvchi_profiles (user_id, group_name, note, created_by_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id) DO UPDATE SET group_name = EXCLUDED.group_name, note = EXCLUDED.note`,
    [userId, groupName, note, createdById ?? null],
  );
  await rememberGroup(groupName, createdById ?? undefined);
}

async function loadStudent(id: number) {
  const [u] = await db.select().from(usersTable).where(eq(usersTable.id, id)).limit(1);
  return u && u.role === STUDENT_ROLE ? u : null;
}

async function buildRoster(groupFilter?: string) {
  const users = await db
    .select({
      id: usersTable.id,
      fullName: usersTable.fullName,
      login: usersTable.login,
      password: usersTable.password,
      phone: usersTable.phone,
      status: usersTable.status,
      createdAt: usersTable.createdAt,
    })
    .from(usersTable)
    .where(eq(usersTable.role, STUDENT_ROLE))
    .orderBy(asc(usersTable.fullName));
  const ids = users.map((u) => u.id);
  const [profiles, progressRows, defs] = await Promise.all([
    profilesFor(ids),
    ids.length ? db.select().from(kirishProgressTable).where(inArray(kirishProgressTable.userId, ids)) : Promise.resolve([]),
    loadStageDefs(),
  ]);
  const progressByUser = new Map(progressRows.map((p) => [p.userId, p]));
  const creatorIds = [...new Set([...profiles.values()].map((p) => p.created_by_id).filter((x): x is number => x != null))];
  const creators = creatorIds.length
    ? await db.select({ id: usersTable.id, fullName: usersTable.fullName }).from(usersTable).where(inArray(usersTable.id, creatorIds))
    : [];
  const creatorName = new Map(creators.map((c) => [c.id, c.fullName]));

  let items = users.map((u) => {
    const prof = profiles.get(u.id);
    const kirish = progressSummary(progressByUser.get(u.id) ?? null, defs);
    const done = kirish.status === "completed" || kirish.status === "ready_for_hire" || kirish.status === "hired";
    return {
      id: u.id,
      fullName: u.fullName,
      login: u.login,
      password: u.password,
      phone: u.phone,
      status: u.status,
      groupName: prof?.group_name ?? null,
      note: prof?.note ?? null,
      createdAt: u.createdAt.toISOString(),
      createdByName: prof?.created_by_id != null ? creatorName.get(prof.created_by_id) ?? null : null,
      kirish: { ...kirish, status: done ? "completed" : kirish.status },
    };
  });
  const { rows: groupRows } = await pool.query<{ name: string }>("SELECT name FROM oquvchi_groups");
  const groups = [
    ...new Set([...groupRows.map((g) => g.name), ...items.map((i) => i.groupName)].filter((g): g is string => Boolean(g))),
  ].sort((a, b) => a.localeCompare(b, "uz"));
  const groupCounts = groups.map((name) => ({ name, count: items.filter((i) => i.groupName === name).length }));
  if (groupFilter) items = items.filter((i) => (i.groupName ?? "") === groupFilter);

  const withScore = items.filter((i) => i.kirish.avgScore != null);
  const summary = {
    total: items.length,
    active: items.filter((i) => i.status === "active").length,
    blocked: items.filter((i) => i.status !== "active").length,
    notStarted: items.filter((i) => i.kirish.status === "not_started").length,
    inProgress: items.filter((i) => i.kirish.status === "in_progress").length,
    completed: items.filter((i) => i.kirish.status === "completed").length,
    avgProgress: items.length ? Math.round(items.reduce((s, i) => s + i.kirish.progressPct, 0) / items.length) : 0,
    avgScore: withScore.length
      ? Math.round(withScore.reduce((s, i) => s + (i.kirish.avgScore ?? 0), 0) / withScore.length)
      : null,
  };
  const stages = defs.map((d) => {
    const passed = items.filter((i) => i.kirish.stages.find((s) => s.stage === d.stage)?.passed).length;
    const scores = items
      .map((i) => i.kirish.stages.find((s) => s.stage === d.stage)?.score)
      .filter((s): s is number => s != null);
    return {
      stage: d.stage,
      title: d.title,
      passed,
      avgScore: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
    };
  });
  return { summary, items, groups, groupCounts, stages, stageCount: defs.length, passScore: KIRISH_PASS_SCORE };
}

function cleanGroupName(raw: unknown): string {
  return String(raw ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
}

async function rememberGroup(name: string | null, actorId?: number) {
  if (!name) return;
  await pool.query("INSERT INTO oquvchi_groups (name, created_by_id) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING", [
    name,
    actorId ?? null,
  ]);
}

router.post("/oquvchilar/groups", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!guard(req, res)) return;
  const name = cleanGroupName(req.body?.name);
  if (name.length < 2) {
    res.status(400).json({ error: "Guruh nomini yozing" });
    return;
  }
  try {
    await rememberGroup(name, req.userId);
    res.status(201).json({ name });
  } catch (err) {
    console.error("POST /oquvchilar/groups error:", err);
    res.status(500).json({ error: "Guruh yaratilmadi" });
  }
});

/** Guruhni o‘chirish: o‘quvchilar o‘chmaydi, faqat guruhsiz qoladi */
router.delete("/oquvchilar/groups/:name", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!guard(req, res)) return;
  const name = cleanGroupName(req.params.name);
  try {
    await pool.query("DELETE FROM oquvchi_groups WHERE name = $1", [name]);
    await pool.query("UPDATE oquvchi_profiles SET group_name = NULL WHERE group_name = $1", [name]);
    res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /oquvchilar/groups error:", err);
    res.status(500).json({ error: "Guruh o‘chirilmadi" });
  }
});

router.get("/oquvchilar", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!guard(req, res)) return;
  try {
    res.json(await buildRoster(String(req.query.group ?? "").trim() || undefined));
  } catch (err) {
    console.error("GET /oquvchilar error:", err);
    res.status(503).json({ error: "O‘quvchilar ro‘yxati yuklanmadi" });
  }
});

type NewStudent = { fullName: string; phone?: string | null; login?: string; password?: string };

async function createStudent(input: NewStudent, groupName: string | null, note: string | null, actorId?: number) {
  const fullName = formatPersonName(String(input.fullName ?? "").replace(/\s+/g, " ").trim()).slice(0, 120);
  if (fullName.length < 3) throw new Error("Ism-familiyani to‘liq yozing");
  let login = cleanLogin(input.login);
  if (login) {
    if (!/^[a-z0-9_.-]{3,40}$/.test(login)) throw new Error("Login faqat lotin harf, raqam, _ . - (3–40 belgi)");
    if (await loginTaken(login)) throw new Error(`«${login}» logini band`);
  } else {
    login = await uniqueLogin(fullName);
  }
  const password = String(input.password ?? "").trim() || randomPassword();
  if (password.length < 4) throw new Error("Parol kamida 4 belgi bo‘lsin");
  const [created] = await db
    .insert(usersTable)
    .values({
      fullName,
      role: STUDENT_ROLE,
      login,
      password,
      phone: String(input.phone ?? "").trim() || null,
      status: "active",
      departmentId: null,
    })
    .returning({ id: usersTable.id });
  await upsertProfile(created!.id, groupName, note, actorId);
  return { id: created!.id, fullName, login, password };
}

router.post("/oquvchilar", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!guard(req, res)) return;
  try {
    const groupName = String(req.body?.groupName ?? "").trim().slice(0, 80) || null;
    const note = String(req.body?.note ?? "").trim().slice(0, 500) || null;
    const created = await createStudent(
      { fullName: req.body?.fullName, phone: req.body?.phone, login: req.body?.login, password: req.body?.password },
      groupName,
      note,
      req.userId,
    );
    res.status(201).json({ student: created });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Qo‘shilmadi" });
  }
});

/** Ko‘p o‘quvchi: har qatorda «Ism Familiya» yoki «Ism Familiya; telefon» */
router.post("/oquvchilar/bulk", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!guard(req, res)) return;
  const groupName = String(req.body?.groupName ?? "").trim().slice(0, 80) || null;
  const lines = String(req.body?.text ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 300);
  if (!lines.length) {
    res.status(400).json({ error: "Kamida bitta ism yozing" });
    return;
  }
  const created: Array<{ id: number; fullName: string; login: string; password: string }> = [];
  const errors: Array<{ line: string; error: string }> = [];
  for (const line of lines) {
    const [name, phone] = line.split(/[;\t,]/).map((p) => p.trim());
    try {
      created.push(await createStudent({ fullName: name ?? "", phone: phone || null }, groupName, null, req.userId));
    } catch (err) {
      errors.push({ line, error: err instanceof Error ? err.message : "Xato" });
    }
  }
  res.status(created.length ? 201 : 400).json({ created, errors });
});

router.patch("/oquvchilar/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!guard(req, res)) return;
  const id = Number(req.params.id);
  const student = Number.isInteger(id) ? await loadStudent(id) : null;
  if (!student) {
    res.status(404).json({ error: "O‘quvchi topilmadi" });
    return;
  }
  const body = req.body ?? {};
  const updates: Partial<typeof usersTable.$inferInsert> = {};
  if (body.fullName != null) {
    const fullName = formatPersonName(String(body.fullName).replace(/\s+/g, " ").trim()).slice(0, 120);
    if (fullName.length < 3) {
      res.status(400).json({ error: "Ism-familiyani to‘liq yozing" });
      return;
    }
    updates.fullName = fullName;
  }
  if (body.phone !== undefined) updates.phone = String(body.phone ?? "").trim() || null;
  if (body.login != null) {
    const login = cleanLogin(body.login);
    if (!/^[a-z0-9_.-]{3,40}$/.test(login)) {
      res.status(400).json({ error: "Login faqat lotin harf, raqam, _ . - (3–40 belgi)" });
      return;
    }
    if (await loginTaken(login, id)) {
      res.status(400).json({ error: `«${login}» logini band` });
      return;
    }
    updates.login = login;
  }
  if (body.password != null && String(body.password).trim()) {
    const password = String(body.password).trim();
    if (password.length < 4) {
      res.status(400).json({ error: "Parol kamida 4 belgi bo‘lsin" });
      return;
    }
    updates.password = password;
  }
  if (body.status != null) {
    const status = String(body.status);
    if (status !== "active" && status !== "blocked") {
      res.status(400).json({ error: "Holat noto‘g‘ri" });
      return;
    }
    updates.status = status;
  }
  if (Object.keys(updates).length) {
    await db.update(usersTable).set(updates).where(eq(usersTable.id, id));
  }
  if (body.status === "blocked" || updates.password) {
    await pool.query("DELETE FROM user_sessions WHERE user_id = $1", [id]).catch(() => undefined);
  }
  if (body.groupName !== undefined || body.note !== undefined) {
    const prof = (await profilesFor([id])).get(id);
    await upsertProfile(
      id,
      body.groupName !== undefined ? String(body.groupName ?? "").trim().slice(0, 80) || null : prof?.group_name ?? null,
      body.note !== undefined ? String(body.note ?? "").trim().slice(0, 500) || null : prof?.note ?? null,
      prof?.created_by_id ?? req.userId,
    );
  }
  res.json({ ok: true });
});

router.post("/oquvchilar/:id/reset-password", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!guard(req, res)) return;
  const id = Number(req.params.id);
  const student = Number.isInteger(id) ? await loadStudent(id) : null;
  if (!student) {
    res.status(404).json({ error: "O‘quvchi topilmadi" });
    return;
  }
  const password = randomPassword();
  await db.update(usersTable).set({ password }).where(eq(usersTable.id, id));
  await pool.query("DELETE FROM user_sessions WHERE user_id = $1", [id]).catch(() => undefined);
  res.json({ login: student.login, password });
});

router.post("/oquvchilar/:id/reset-progress", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!guard(req, res)) return;
  const id = Number(req.params.id);
  const student = Number.isInteger(id) ? await loadStudent(id) : null;
  if (!student) {
    res.status(404).json({ error: "O‘quvchi topilmadi" });
    return;
  }
  await db.delete(kirishProgressTable).where(eq(kirishProgressTable.userId, id));
  res.json({ ok: true });
});

router.delete("/oquvchilar/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!guard(req, res)) return;
  const id = Number(req.params.id);
  const student = Number.isInteger(id) ? await loadStudent(id) : null;
  if (!student) {
    res.status(404).json({ error: "O‘quvchi topilmadi" });
    return;
  }
  try {
    await db.delete(kirishProgressTable).where(eq(kirishProgressTable.userId, id));
    await pool.query("DELETE FROM oquvchi_profiles WHERE user_id = $1", [id]);
    await purgeUserCompletely(id);
    res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /oquvchilar error:", err);
    res.status(500).json({ error: "O‘chirilmadi" });
  }
});

/** Login/parol + natijalar Excel */
router.get("/oquvchilar/export", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!guard(req, res)) return;
  const group = String(req.query.group ?? "").trim() || undefined;
  const roster = await buildRoster(group);
  const wb = newCredWorkbook();
  const dateStr = new Date().toLocaleDateString("uz-UZ", { timeZone: "Asia/Tashkent" });

  paintCredSheet(wb, {
    name: "Login-parollar",
    title: `O‘quvchilar — login va parollar${group ? ` (${group})` : ""} · ${dateStr}`,
    headers: ["F.I.Sh", "Login", "Parol", "Telefon", "Guruh", "Holat", "Progress"],
    widths: [34, 26, 16, 18, 20, 14, 12],
    rows: roster.items.map((i) => [
      i.fullName,
      i.login,
      i.password,
      i.phone ?? "",
      i.groupName ?? "",
      i.status === "active" ? "Faol" : "Bloklangan",
      `${i.kirish.progressPct}%`,
    ]),
    monoCols: [2, 3],
  });

  const stageHeaders = roster.stages.map((s) => `${s.stage}-dars`);
  paintCredSheet(wb, {
    name: "Natijalar",
    title: `O‘quvchilar natijalari — o‘tish bali ${roster.passScore}% · ${dateStr}`,
    headers: ["F.I.Sh", "Guruh", "Holat", "O‘tilgan", "O‘rtacha ball", "Urinishlar", ...stageHeaders],
    widths: [34, 18, 14, 12, 14, 12, ...stageHeaders.map(() => 10)],
    rows: roster.items.map((i) => [
      i.fullName,
      i.groupName ?? "",
      STATUS_LABEL[i.kirish.status] ?? i.kirish.status,
      `${i.kirish.passed}/${i.kirish.stageCount}`,
      i.kirish.avgScore != null ? `${i.kirish.avgScore}%` : "—",
      i.kirish.attempts,
      ...i.kirish.stages.map((s) => (s.score != null ? `${s.score}%${s.passed ? " ✓" : ""}` : "—")),
    ]),
    monoCols: [],
  });

  await sendWorkbook(res, wb, `oquvchilar_${new Date().toISOString().slice(0, 10)}.xlsx`);
});

export default router;
