import { Router, type IRouter } from "express";
import { and, desc, eq, inArray, or } from "drizzle-orm";
import {
  db,
  remindersTable,
  reminderEventsTable,
  usersTable,
  type ReminderAttachment,
} from "@workspace/db";
import type { AuthRequest } from "../middlewares/auth";
import { requireAuth } from "../middlewares/auth";
import { notifyUser } from "../lib/notify";

const router: IRouter = Router();

const VALID_INTERVALS = new Set([15, 30, 60, 120, 360, 720, 1440]);
const VALID_CATEGORIES = new Set(["work", "personal", "meeting", "check", "finance", "other"]);
const VALID_PRIORITIES = new Set(["low", "medium", "high", "critical"]);

function canAccessReminder(
  row: typeof remindersTable.$inferSelect,
  userId: number,
) {
  return row.userId === userId || row.createdById === userId;
}

function parseCategory(raw: unknown): string {
  const v = String(raw || "work").toLowerCase();
  return VALID_CATEGORIES.has(v) ? v : "work";
}

function parsePriority(raw: unknown): string {
  const v = String(raw || "medium").toLowerCase();
  return VALID_PRIORITIES.has(v) ? v : "medium";
}

function parseAttachments(raw: unknown): ReminderAttachment[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((a) => a && typeof a === "object" && typeof (a as any).url === "string")
    .map((a: any) => ({
      id: String(a.id || crypto.randomUUID()),
      name: String(a.name || "fayl"),
      mimeType: String(a.mimeType || "application/octet-stream"),
      kind: a.kind === "image" ? "image" : "file",
      url: String(a.url),
      size: typeof a.size === "number" ? a.size : undefined,
    }));
}

async function addEvent(opts: {
  reminderId: number;
  eventType: string;
  note?: string | null;
  fromDueAt?: Date | null;
  toDueAt?: Date | null;
  fromStatus?: string | null;
  toStatus?: string | null;
  createdById?: number | null;
}) {
  await db.insert(reminderEventsTable).values({
    reminderId: opts.reminderId,
    eventType: opts.eventType,
    note: opts.note ?? null,
    fromDueAt: opts.fromDueAt ?? null,
    toDueAt: opts.toDueAt ?? null,
    fromStatus: opts.fromStatus ?? null,
    toStatus: opts.toStatus ?? null,
    createdById: opts.createdById ?? null,
  });
}

async function listEvents(reminderId: number) {
  return db
    .select()
    .from(reminderEventsTable)
    .where(eq(reminderEventsTable.reminderId, reminderId))
    .orderBy(desc(reminderEventsTable.createdAt));
}

function remainingMs(dueAt: Date, now = new Date()) {
  return dueAt.getTime() - now.getTime();
}

async function syncReminderLifecycle(
  row: typeof remindersTable.$inferSelect,
  userId: number,
) {
  const now = new Date();
  let current = row;

  if (current.status === "active" && current.dueAt.getTime() < now.getTime()) {
    const [updated] = await db
      .update(remindersTable)
      .set({ status: "missed", updatedAt: now })
      .where(and(eq(remindersTable.id, current.id), eq(remindersTable.status, "active")))
      .returning();
    if (updated) {
      await addEvent({
        reminderId: current.id,
        eventType: "missed",
        note: "Muddat o‘tdi — Bajarilmadi",
        fromStatus: "active",
        toStatus: "missed",
        fromDueAt: current.dueAt,
        toDueAt: current.dueAt,
        createdById: userId,
      });
      await notifyUser({
        userId,
        text: `Eslatma muddati o‘tdi: ${current.title}`,
        type: "reminder_missed",
        linkUrl: "/eslatmalar",
        telegram: Boolean(current.notifyTelegram),
        system: current.notifySystem !== false,
        webPush: current.notifySystem !== false,
      });
      current = updated;
    }
  }

  if (current.status === "active" && current.notifyAt) {
    const interval = current.remindIntervalMinutes;
    const shouldNotify = (() => {
      if (current.notifyAt!.getTime() > now.getTime()) return false;
      if (!current.lastNotifiedAt) return true;
      if (!interval) return false;
      const next = current.lastNotifiedAt.getTime() + interval * 60_000;
      return next <= now.getTime() && current.dueAt.getTime() > now.getTime();
    })();

    if (shouldNotify) {
      const wantSystem = current.notifySystem !== false;
      const wantTelegram = Boolean(current.notifyTelegram);
      if (wantSystem || wantTelegram) {
        await notifyUser({
          userId,
          text: `Eslatma: ${current.title}`,
          type: "reminder_ping",
          linkUrl: "/eslatmalar",
          telegram: wantTelegram,
          system: wantSystem,
          webPush: wantSystem,
        });
      }
      const [updated] = await db
        .update(remindersTable)
        .set({ lastNotifiedAt: now, updatedAt: now })
        .where(eq(remindersTable.id, current.id))
        .returning();
      await addEvent({
        reminderId: current.id,
        eventType: "notified",
        note: wantTelegram && wantSystem
          ? "Tizim + Telegram"
          : wantTelegram
            ? "Telegram"
            : "Tizim ichida",
        createdById: userId,
      });
      if (updated) current = updated;
    }
  }

  return current;
}

function enrich(row: typeof remindersTable.$inferSelect) {
  const now = new Date();
  const ms = remainingMs(row.dueAt, now);
  return {
    ...row,
    remainingMs: ms,
    remainingLabel:
      row.status === "completed"
        ? "Bajarilgan"
        : row.status === "missed" || ms < 0
          ? "Muddat o‘tgan"
          : formatRemaining(ms),
  };
}

function formatRemaining(ms: number) {
  const totalMin = Math.floor(ms / 60_000);
  const days = Math.floor(totalMin / (60 * 24));
  const hours = Math.floor((totalMin % (60 * 24)) / 60);
  const mins = totalMin % 60;
  if (days > 0) return `${days} kun ${hours} soat`;
  if (hours > 0) return `${hours} soat ${mins} daq`;
  return `${Math.max(mins, 0)} daqiqa`;
}

router.get("/reminders", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const userId = req.userId!;
  const rows = await db
    .select()
    .from(remindersTable)
    .where(
      or(eq(remindersTable.userId, userId), eq(remindersTable.createdById, userId)),
    )
    .orderBy(desc(remindersTable.dueAt));

  const synced = [];
  for (const row of rows) {
    // Lifecycle faqat egasi uchun (bildirishnomalar unga boradi)
    const live =
      row.userId === userId ? await syncReminderLifecycle(row, userId) : row;
    synced.push({
      ...enrich(live),
      forOthers: live.userId !== userId && live.createdById === userId,
      forMe: live.userId === userId,
    });
  }
  res.json(synced);
});

router.get("/reminders/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  const userId = req.userId!;
  const [row] = await db.select().from(remindersTable).where(eq(remindersTable.id, id));
  if (!row || !canAccessReminder(row, userId)) {
    res.status(404).json({ error: "Eslatma topilmadi" });
    return;
  }
  const current =
    row.userId === userId ? await syncReminderLifecycle(row, userId) : row;
  const events = await listEvents(id);
  res.json({
    ...enrich(current),
    events,
    forOthers: current.userId !== userId && current.createdById === userId,
    forMe: current.userId === userId,
  });
});

router.post("/reminders", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const userId = req.userId!;
  const {
    title,
    description,
    dueAt,
    notifyAt,
    remindIntervalMinutes,
    attachments,
    category,
    priority,
    notifySystem,
    notifyTelegram,
    targetUserId,
    targetUserIds,
  } = req.body ?? {};

  if (!title || !String(title).trim()) {
    res.status(400).json({ error: "Sarlavha majburiy" });
    return;
  }
  if (!dueAt) {
    res.status(400).json({ error: "Muddat (qachon bajarish) majburiy" });
    return;
  }

  const due = new Date(dueAt);
  if (Number.isNaN(due.getTime())) {
    res.status(400).json({ error: "Muddat noto‘g‘ri" });
    return;
  }

  let notify: Date | null = null;
  if (notifyAt) {
    notify = new Date(notifyAt);
    if (Number.isNaN(notify.getTime())) {
      res.status(400).json({ error: "Ogohlantirish vaqti noto‘g‘ri" });
      return;
    }
  }

  let interval: number | null = null;
  if (remindIntervalMinutes != null && remindIntervalMinutes !== "") {
    const n = parseInt(String(remindIntervalMinutes), 10);
    if (!VALID_INTERVALS.has(n)) {
      res.status(400).json({ error: "Eslatma oralig‘i noto‘g‘ri" });
      return;
    }
    interval = n;
  }

  const idSet = new Set<number>();
  if (Array.isArray(targetUserIds)) {
    for (const raw of targetUserIds) {
      const n = parseInt(String(raw), 10);
      if (Number.isFinite(n) && n > 0 && n !== userId) idSet.add(n);
    }
  }
  const singleRaw =
    targetUserId != null && targetUserId !== "" ? parseInt(String(targetUserId), 10) : NaN;
  if (Number.isFinite(singleRaw) && singleRaw > 0 && singleRaw !== userId) {
    idSet.add(singleRaw);
  }

  const ownerIds: number[] = [];
  if (idSet.size === 0) {
    ownerIds.push(userId);
  } else {
    const candidates = [...idSet];
    const found = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(inArray(usersTable.id, candidates));
    const foundSet = new Set(found.map((u) => u.id));
    for (const id of candidates) {
      if (!foundSet.has(id)) {
        res.status(400).json({ error: `Xodim topilmadi (#${id})` });
        return;
      }
      ownerIds.push(id);
    }
  }

  if (ownerIds.length > 50) {
    res.status(400).json({ error: "Bir vaqtda 50 tadan ortiq xodimga yuborib bo‘lmaydi" });
    return;
  }

  const baseValues = {
    createdById: userId,
    title: String(title).trim(),
    description: description ? String(description) : null,
    dueAt: due,
    notifyAt: notify,
    remindIntervalMinutes: interval,
    attachments: parseAttachments(attachments),
    category: parseCategory(category),
    priority: parsePriority(priority),
    notifySystem: notifySystem === false || notifySystem === "false" ? false : true,
    notifyTelegram: notifyTelegram === true || notifyTelegram === "true",
    status: "active" as const,
  };

  const createdRows = [];
  for (const ownerId of ownerIds) {
    const [created] = await db
      .insert(remindersTable)
      .values({
        ...baseValues,
        userId: ownerId,
      })
      .returning();

    await addEvent({
      reminderId: created.id,
      eventType: "created",
      note:
        ownerId === userId
          ? "Eslatma yaratildi"
          : `Xodimga biriktirildi (#${ownerId})`,
      toDueAt: due,
      toStatus: "active",
      createdById: userId,
    });

    if (ownerId !== userId) {
      await notifyUser({
        userId: ownerId,
        text: `Sizga yangi eslatma: ${created.title}`,
        type: "reminder_assigned",
        linkUrl: "/eslatmalar",
        telegram: Boolean(created.notifyTelegram),
        system: created.notifySystem !== false,
        webPush: created.notifySystem !== false,
      });
    }
    createdRows.push(created);
  }

  const enriched = createdRows.map((row) => ({
    ...enrich(row),
    forOthers: row.userId !== userId,
    forMe: row.userId === userId,
  }));

  if (enriched.length === 1) {
    res.status(201).json(enriched[0]);
    return;
  }

  res.status(201).json({
    created: enriched.length,
    items: enriched,
    ...enriched[0],
  });
});

router.patch("/reminders/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  const userId = req.userId!;
  const [existing] = await db.select().from(remindersTable).where(eq(remindersTable.id, id));
  if (!existing || !canAccessReminder(existing, userId)) {
    res.status(404).json({ error: "Eslatma topilmadi" });
    return;
  }

  const updates: Partial<typeof remindersTable.$inferInsert> = {};
  const {
    title,
    description,
    notifyAt,
    remindIntervalMinutes,
    attachments,
    category,
    priority,
    notifySystem,
    notifyTelegram,
  } = req.body ?? {};

  if (title != null) updates.title = String(title).trim();
  if (description !== undefined) updates.description = description ? String(description) : null;
  if (attachments !== undefined) updates.attachments = parseAttachments(attachments);
  if (category !== undefined) updates.category = parseCategory(category);
  if (priority !== undefined) updates.priority = parsePriority(priority);
  if (notifySystem !== undefined) {
    updates.notifySystem = !(notifySystem === false || notifySystem === "false");
  }
  if (notifyTelegram !== undefined) {
    updates.notifyTelegram = notifyTelegram === true || notifyTelegram === "true";
  }

  if (notifyAt !== undefined) {
    if (notifyAt === null || notifyAt === "") updates.notifyAt = null;
    else {
      const d = new Date(notifyAt);
      if (Number.isNaN(d.getTime())) {
        res.status(400).json({ error: "Ogohlantirish vaqti noto‘g‘ri" });
        return;
      }
      updates.notifyAt = d;
    }
  }

  if (remindIntervalMinutes !== undefined) {
    if (remindIntervalMinutes === null || remindIntervalMinutes === "") {
      updates.remindIntervalMinutes = null;
    } else {
      const n = parseInt(String(remindIntervalMinutes), 10);
      if (!VALID_INTERVALS.has(n)) {
        res.status(400).json({ error: "Eslatma oralig‘i noto‘g‘ri" });
        return;
      }
      updates.remindIntervalMinutes = n;
    }
  }

  if (!Object.keys(updates).length) {
    res.json(enrich(existing));
    return;
  }

  const [updated] = await db
    .update(remindersTable)
    .set(updates)
    .where(eq(remindersTable.id, id))
    .returning();

  await addEvent({
    reminderId: id,
    eventType: "note",
    note: "Ma’lumot yangilandi",
    createdById: userId,
  });

  res.json(enrich(updated));
});

/** Muddatni ko‘chirish — tarix saqlanadi */
router.post("/reminders/:id/postpone", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  const userId = req.userId!;
  const { dueAt, note } = req.body ?? {};
  if (!dueAt) {
    res.status(400).json({ error: "Yangi muddat majburiy" });
    return;
  }
  const newDue = new Date(dueAt);
  if (Number.isNaN(newDue.getTime())) {
    res.status(400).json({ error: "Muddat noto‘g‘ri" });
    return;
  }

  const [existing] = await db.select().from(remindersTable).where(eq(remindersTable.id, id));
  if (!existing || !canAccessReminder(existing, userId)) {
    res.status(404).json({ error: "Eslatma topilmadi" });
    return;
  }

  const fromStatus = existing.status;
  const toStatus = newDue.getTime() > Date.now() ? "active" : existing.status === "missed" ? "missed" : "active";

  const [updated] = await db
    .update(remindersTable)
    .set({
      dueAt: newDue,
      status: toStatus === "active" ? "active" : existing.status,
      completedAt: toStatus === "active" ? null : existing.completedAt,
      updatedAt: new Date(),
    })
    .where(eq(remindersTable.id, id))
    .returning();

  await addEvent({
    reminderId: id,
    eventType: "due_changed",
    note: note ? String(note) : `Muddat ko‘chirildi`,
    fromDueAt: existing.dueAt,
    toDueAt: newDue,
    fromStatus,
    toStatus: updated.status,
    createdById: userId,
  });

  if (fromStatus === "missed" && updated.status === "active") {
    await addEvent({
      reminderId: id,
      eventType: "reopened",
      note: "Muddat uzaytirildi — qayta faol",
      fromStatus: "missed",
      toStatus: "active",
      createdById: userId,
    });
  }

  res.json(enrich(updated));
});

router.post("/reminders/:id/complete", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  const userId = req.userId!;
  const [existing] = await db.select().from(remindersTable).where(eq(remindersTable.id, id));
  if (!existing || existing.userId !== userId) {
    res.status(404).json({ error: "Eslatma topilmadi" });
    return;
  }

  const now = new Date();
  const [updated] = await db
    .update(remindersTable)
    .set({ status: "completed", completedAt: now, updatedAt: now })
    .where(eq(remindersTable.id, id))
    .returning();

  await addEvent({
    reminderId: id,
    eventType: "completed",
    note: "Bajardim deb belgilandi",
    fromStatus: existing.status,
    toStatus: "completed",
    fromDueAt: existing.dueAt,
    toDueAt: existing.dueAt,
    createdById: userId,
  });

  res.json(enrich(updated));
});

router.delete("/reminders/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  const userId = req.userId!;
  const [existing] = await db.select().from(remindersTable).where(eq(remindersTable.id, id));
  if (!existing || !canAccessReminder(existing, userId)) {
    res.status(404).json({ error: "Eslatma topilmadi" });
    return;
  }
  await db.delete(reminderEventsTable).where(eq(reminderEventsTable.reminderId, id));
  await db.delete(remindersTable).where(eq(remindersTable.id, id));
  res.status(204).end();
});

export default router;
