import { Router, type IRouter, type Response } from "express";
import { eq } from "drizzle-orm";
import { db, employeesTable, pool } from "@workspace/db";
import type { AuthRequest } from "../middlewares/auth";
import { requireAuth } from "../middlewares/auth";
import { canAccessBoglanish } from "../lib/roles";

const router: IRouter = Router();

type BranchRow = {
  id: number;
  fullName: string;
  location: string | null;
};

type ContactRow = {
  branch_employee_id: number;
  primary_phone: string;
  extra_phones: unknown;
  telegram_nick: string | null;
  contact_from_hm: string | null;
  contact_to_hm: string | null;
  updated_at: Date;
};

function branchLabel(location: string | null | undefined, fullName: string): string {
  const loc = (location || "").trim();
  if (!loc) return fullName;
  const generic = /^(filial|apteka|branch|dorixona)\s*\d*$/i.test(loc);
  return generic ? fullName : loc;
}

function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

function parseUzPhoneDigits(raw: string): string {
  let digits = digitsOnly(raw);
  if (!digits) return "";
  if (digits.startsWith("00")) digits = digits.slice(2);
  const idx = digits.indexOf("998");
  if (idx >= 0) return digits.slice(idx, idx + 12);
  if (digits.startsWith("8") && digits.length >= 10) {
    return (`998${digits.slice(1)}`).slice(0, 12);
  }
  if (digits.length <= 9) return (`998${digits}`).slice(0, 12);
  return (`998${digits}`).slice(0, 12);
}

function normalizeUzPhone(value: unknown): string {
  const d = parseUzPhoneDigits(String(value || ""));
  if (!d || d === "998" || d.length !== 12) return "";
  return `+${d}`;
}

function isCompleteUzPhone(value: string): boolean {
  const d = parseUzPhoneDigits(value);
  return d.length === 12 && d.startsWith("998");
}

function normalizeTelegramNick(raw: unknown): string | null {
  let v = String(raw || "").trim();
  if (!v) return null;
  v = v.replace(/^https?:\/\/(t\.me|telegram\.me)\//i, "");
  v = v.replace(/^@+/, "");
  v = v.replace(/[^a-zA-Z0-9_]/g, "");
  if (v.length < 3 || v.length > 32) return null;
  return `@${v}`;
}

function parseHm(raw: unknown): string | null {
  const v = String(raw || "").trim();
  if (!v) return null;
  if (!/^\d{2}:\d{2}$/.test(v)) return null;
  const [h, m] = v.split(":").map(Number);
  if (h! < 0 || h! > 23 || m! < 0 || m! > 59) return null;
  return v;
}

function parseExtraPhones(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw.slice(0, 5)) {
    const phone = normalizeUzPhone(item);
    if (!phone || !isCompleteUzPhone(phone)) continue;
    if (seen.has(phone)) continue;
    seen.add(phone);
    out.push(phone);
  }
  return out;
}

function extrasFromDb(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map((x) => String(x || "")).filter(Boolean);
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.map((x) => String(x || "")).filter(Boolean) : [];
    } catch {
      return [];
    }
  }
  return [];
}

async function actorEmployee(userId: number, orgRole: "coordinator" | "manager") {
  const rows = await db
    .select({
      id: employeesTable.id,
      orgRole: employeesTable.orgRole,
      fullName: employeesTable.fullName,
      location: employeesTable.location,
      employmentStatus: employeesTable.employmentStatus,
    })
    .from(employeesTable)
    .where(eq(employeesTable.userId, userId));
  const preferred = rows.find((r) => r.orgRole === orgRole);
  const row = preferred ?? rows[0] ?? null;
  if (!row || row.employmentStatus === "dismissed") return null;
  return row;
}

async function loadScopedBranches(userId: number, role: string): Promise<BranchRow[]> {
  if (role === "mudir") {
    const actor = await actorEmployee(userId, "manager");
    if (!actor) return [];
    return [{ id: actor.id, fullName: actor.fullName, location: actor.location }];
  }

  const actor = await actorEmployee(userId, "coordinator");
  if (!actor) return [];

  const managers = await db
    .select({
      id: employeesTable.id,
      fullName: employeesTable.fullName,
      location: employeesTable.location,
      reportsToId: employeesTable.reportsToId,
      employmentStatus: employeesTable.employmentStatus,
    })
    .from(employeesTable)
    .where(eq(employeesTable.orgRole, "manager"));

  return managers
    .filter((m) => m.reportsToId === actor.id && m.employmentStatus !== "dismissed")
    .map((m) => ({ id: m.id, fullName: m.fullName, location: m.location }))
    .sort((a, b) =>
      branchLabel(a.location, a.fullName).localeCompare(branchLabel(b.location, b.fullName), "uz"),
    );
}

async function loadContacts(branchIds: number[]): Promise<Map<number, ContactRow>> {
  const map = new Map<number, ContactRow>();
  if (!branchIds.length) return map;
  const { rows } = await pool.query<ContactRow>(
    `SELECT branch_employee_id, primary_phone, extra_phones, telegram_nick,
            contact_from_hm, contact_to_hm, updated_at
     FROM branch_contacts
     WHERE branch_employee_id = ANY($1::int[])`,
    [branchIds],
  );
  for (const row of rows) map.set(row.branch_employee_id, row);
  return map;
}

function contactPayload(branch: BranchRow, contact: ContactRow | undefined, required: boolean) {
  const primaryPhone = contact?.primary_phone || "";
  const complete = isCompleteUzPhone(primaryPhone);
  return {
    branchEmployeeId: branch.id,
    branchName: branchLabel(branch.location, branch.fullName),
    mudirName: branch.fullName,
    primaryPhone,
    extraPhones: extrasFromDb(contact?.extra_phones),
    telegramNick: contact?.telegram_nick || "",
    contactFromHm: contact?.contact_from_hm || "",
    contactToHm: contact?.contact_to_hm || "",
    required,
    complete,
    updatedAt: contact?.updated_at ? new Date(contact.updated_at).toISOString() : null,
  };
}

function deny(res: Response) {
  return res.status(403).json({ error: "Faqat mudir va koordinator uchun" });
}

router.get("/boglanish/me", requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const role = req.userRole || "";
    if (!canAccessBoglanish(role)) {
      deny(res);
      return;
    }

    const branches = await loadScopedBranches(req.userId!, role);
    const contacts = await loadContacts(branches.map((b) => b.id));
    const required = role === "mudir";
    const items = branches.map((b) => contactPayload(b, contacts.get(b.id), required));
    const incomplete = items.filter((i) => i.required && !i.complete);

    res.json({
      role,
      required,
      complete: incomplete.length === 0,
      missingCount: incomplete.length,
      missingBranchNames: incomplete.map((i) => i.branchName),
      branches: items,
    });
  } catch (err) {
    console.error("[boglanish/me]", err);
    res.status(500).json({ error: "Bog‘lanish ma’lumotini yuklab bo‘lmadi" });
  }
});

router.get("/boglanish/status", requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const role = req.userRole || "";
    if (!canAccessBoglanish(role)) {
      res.json({ show: false, required: false, complete: true, missingBranchNames: [] });
      return;
    }

    const branches = await loadScopedBranches(req.userId!, role);
    if (role !== "mudir") {
      res.json({
        show: false,
        required: false,
        complete: true,
        missingBranchNames: [],
        branchCount: branches.length,
      });
      return;
    }

    const contacts = await loadContacts(branches.map((b) => b.id));
    const missing = branches.filter((b) => !isCompleteUzPhone(contacts.get(b.id)?.primary_phone || ""));
    res.json({
      show: missing.length > 0,
      required: true,
      complete: missing.length === 0,
      missingBranchNames: missing.map((b) => branchLabel(b.location, b.fullName)),
      branchCount: branches.length,
    });
  } catch (err) {
    console.error("[boglanish/status]", err);
    res.status(500).json({ error: "Status yuklanmadi" });
  }
});

router.put("/boglanish/branch/:branchEmployeeId", requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const role = req.userRole || "";
    if (!canAccessBoglanish(role)) {
      deny(res);
      return;
    }

    const branchEmployeeId = Number(req.params.branchEmployeeId);
    if (!Number.isFinite(branchEmployeeId) || branchEmployeeId <= 0) {
      res.status(400).json({ error: "Filial noto‘g‘ri" });
      return;
    }

    const branches = await loadScopedBranches(req.userId!, role);
    const branch = branches.find((b) => b.id === branchEmployeeId);
    if (!branch) {
      res.status(403).json({ error: "Bu filial sizning doirangizda emas" });
      return;
    }

    const primaryPhone = normalizeUzPhone(req.body?.primaryPhone);
    const required = role === "mudir";
    if (required && !primaryPhone) {
      res.status(400).json({ error: "Filial raqami majburiy" });
      return;
    }
    if (primaryPhone && !isCompleteUzPhone(primaryPhone)) {
      res.status(400).json({ error: "Filial raqami to‘liq emas (+998 XX XXX XX XX)" });
      return;
    }

    let extraPhones = parseExtraPhones(req.body?.extraPhones);
    if (primaryPhone) {
      extraPhones = extraPhones.filter((p) => p !== primaryPhone);
    }

    const telegramNick = normalizeTelegramNick(req.body?.telegramNick);
    const contactFromHm = parseHm(req.body?.contactFromHm);
    const contactToHm = parseHm(req.body?.contactToHm);

    if ((contactFromHm && !contactToHm) || (!contactFromHm && contactToHm)) {
      res.status(400).json({ error: "Bog‘lanish vaqtini to‘liq kiriting (dan–gacha)" });
      return;
    }

    await pool.query(
      `INSERT INTO branch_contacts (
         branch_employee_id, primary_phone, extra_phones, telegram_nick,
         contact_from_hm, contact_to_hm, updated_by_user_id, updated_at
       ) VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, NOW())
       ON CONFLICT (branch_employee_id) DO UPDATE SET
         primary_phone = EXCLUDED.primary_phone,
         extra_phones = EXCLUDED.extra_phones,
         telegram_nick = EXCLUDED.telegram_nick,
         contact_from_hm = EXCLUDED.contact_from_hm,
         contact_to_hm = EXCLUDED.contact_to_hm,
         updated_by_user_id = EXCLUDED.updated_by_user_id,
         updated_at = NOW()`,
      [
        branchEmployeeId,
        primaryPhone,
        JSON.stringify(extraPhones),
        telegramNick,
        contactFromHm,
        contactToHm,
        req.userId!,
      ],
    );

    const contacts = await loadContacts([branchEmployeeId]);
    res.json({
      ok: true,
      branch: contactPayload(branch, contacts.get(branchEmployeeId), required),
    });
  } catch (err) {
    console.error("[boglanish/put]", err);
    res.status(500).json({ error: "Saqlab bo‘lmadi" });
  }
});

export default router;
