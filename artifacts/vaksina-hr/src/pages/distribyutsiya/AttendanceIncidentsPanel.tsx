import { useMemo, useState } from "react";
import { AlarmClock, CalendarDays, Clock3, DoorOpen, Loader2, LogOut, MessageSquarePlus, UserX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  STAFF_COMMENT_KIND_LABEL,
  useDistribAttendance,
  type AttendanceIncident,
} from "@/lib/distribyutsiya-api";
import { CommentForm, KIND_TONE, fmtStamp, fmtYmd } from "./StaffActions";

type IncidentType = AttendanceIncident["type"];

const TYPE_META: Record<IncidentType, { label: string; tone: string; icon: typeof AlarmClock }> = {
  late: { label: "Kech keldi", tone: "border-amber-200 bg-amber-50 text-amber-900", icon: AlarmClock },
  early: { label: "Erta ketdi", tone: "border-orange-200 bg-orange-50 text-orange-900", icon: LogOut },
  absent: { label: "Kelmadi", tone: "border-rose-200 bg-rose-50 text-rose-800", icon: UserX },
  incomplete: { label: "Ketdim qilmagan", tone: "border-slate-200 bg-slate-50 text-slate-700", icon: DoorOpen },
};

function todayYmd() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Tashkent" });
}

function addDays(ymd: string, n: number) {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d! + n));
  return dt.toISOString().slice(0, 10);
}

function minutesText(n: number) {
  if (n <= 0) return "";
  const h = Math.floor(n / 60);
  const m = n % 60;
  if (!h) return `${m} daq`;
  return m ? `${h} soat ${m} daq` : `${h} soat`;
}

export function AttendanceIncidentsPanel() {
  const today = todayYmd();
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [filter, setFilter] = useState<IncidentType | "all">("all");
  const q = useDistribAttendance(from, to);
  const data = q.data;

  const presets = [
    { label: "Bugun", from: today, to: today },
    { label: "Kecha", from: addDays(today, -1), to: addDays(today, -1) },
    { label: "7 kun", from: addDays(today, -6), to: today },
    { label: "30 kun", from: addDays(today, -29), to: today },
  ];

  const list = useMemo(
    () => (data?.incidents || []).filter((i) => filter === "all" || i.type === filter),
    [data, filter],
  );
  const singleDay = from === to;

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <Clock3 className="h-4 w-4 text-primary" /> Kech kelish va erta ketish
            </h2>
            <p className="text-xs text-muted-foreground">
              Har kuni avtomatik: Keldim / Ketdim vaqti smena rejasi bilan solishtiriladi. Har biriga izoh yozishingiz mumkin.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {presets.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => {
                  setFrom(p.from);
                  setTo(p.to);
                }}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-xs font-medium transition",
                  from === p.from && to === p.to ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted",
                )}
              >
                {p.label}
              </button>
            ))}
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <CalendarDays className="h-3.5 w-3.5" />
              <Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="h-8 w-[136px] text-xs" />
              –
              <Input type="date" value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)} className="h-8 w-[136px] text-xs" />
            </span>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
          <button
            type="button"
            onClick={() => setFilter("all")}
            className={cn(
              "rounded-xl border p-3 text-left transition",
              filter === "all" ? "border-primary ring-1 ring-primary" : "hover:bg-muted/50",
            )}
          >
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Hammasi</p>
            <p className="text-xl font-bold tabular-nums">{data?.incidents.length ?? "—"}</p>
            <p className="text-[11px] text-muted-foreground">{data ? `${data.staffCount} xodimdan` : ""}</p>
          </button>
          {(Object.keys(TYPE_META) as IncidentType[]).map((t) => {
            const m = TYPE_META[t];
            const Icon = m.icon;
            return (
              <button
                key={t}
                type="button"
                onClick={() => setFilter(t)}
                className={cn(
                  "rounded-xl border p-3 text-left transition",
                  m.tone,
                  filter === t ? "ring-2 ring-current" : "hover:brightness-95",
                )}
              >
                <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide opacity-80">
                  <Icon className="h-3 w-3" /> {m.label}
                </p>
                <p className="text-xl font-bold tabular-nums">{data?.counts[t] ?? "—"}</p>
              </button>
            );
          })}
        </div>
      </section>

      {q.isLoading ? (
        <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Yuklanmoqda…
        </div>
      ) : q.isError ? (
        <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{(q.error as Error).message}</p>
      ) : (
        <div className={cn("grid gap-4", !singleDay && "lg:grid-cols-[minmax(0,1fr)_300px]")}>
          <section className="space-y-2">
            {!list.length ? (
              <p className="rounded-2xl border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
                {filter === "all" ? "Bu davrda kech kelgan yoki erta ketgan xodim yo‘q" : `«${TYPE_META[filter].label}» holati yo‘q`}
              </p>
            ) : (
              list.map((i) => <IncidentCard key={i.key} item={i} canComment={!!data?.canComment} showDate={!singleDay} />)
            )}
          </section>

          {!singleDay && data?.summary.length ? (
            <aside className="h-fit rounded-2xl border bg-card p-4 shadow-sm">
              <h3 className="text-sm font-semibold">Xodimlar bo‘yicha</h3>
              <p className="text-[11px] text-muted-foreground">
                {fmtYmd(data.from)} – {fmtYmd(data.to)}
              </p>
              <ul className="mt-3 divide-y">
                {data.summary.map((s) => (
                  <li key={s.userId} className="py-2">
                    <p className="truncate text-[13px] font-medium">{s.fullName}</p>
                    <p className="mt-0.5 flex flex-wrap gap-x-2.5 text-[11px] text-muted-foreground">
                      {s.late ? (
                        <span className="text-amber-700">
                          Kech: <b>{s.late}</b> marta ({minutesText(s.lateMinutes)})
                        </span>
                      ) : null}
                      {s.early ? (
                        <span className="text-orange-700">
                          Erta: <b>{s.early}</b> ({minutesText(s.earlyMinutes)})
                        </span>
                      ) : null}
                      {s.absent ? (
                        <span className="text-rose-700">
                          Kelmagan: <b>{s.absent}</b>
                        </span>
                      ) : null}
                    </p>
                  </li>
                ))}
              </ul>
            </aside>
          ) : null}
        </div>
      )}
    </div>
  );
}

function IncidentCard({ item, canComment, showDate }: { item: AttendanceIncident; canComment: boolean; showDate: boolean }) {
  const [writing, setWriting] = useState(false);
  const m = TYPE_META[item.type];
  const Icon = m.icon;
  const detail =
    item.type === "late"
      ? `Reja ${item.planStart || "—"}, keldi ${item.checkIn || "—"}`
      : item.type === "early"
        ? `Reja ${item.planEnd || "—"} gacha, ketdi ${item.checkOut || "—"}`
        : item.type === "incomplete"
          ? `Keldi ${item.checkIn || "—"}, Ketdim belgilanmagan`
          : `Reja ${item.planStart || "—"}–${item.planEnd || "—"}, Keldim yo‘q`;

  return (
    <article className="rounded-2xl border bg-card p-3 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border", m.tone)}>
            <Icon className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{item.fullName}</p>
            <p className="text-[11px] text-muted-foreground">
              {item.position || "—"}
              {showDate ? ` · ${fmtYmd(item.date)}` : ""}
            </p>
          </div>
        </div>
        <div className="text-right">
          <span className={cn("rounded-full border px-2 py-0.5 text-[11px] font-semibold", m.tone)}>
            {m.label}
            {item.minutes ? ` · ${minutesText(item.minutes)}` : ""}
          </span>
          {item.excused ? (
            <p className="mt-1 text-[10px] font-semibold text-emerald-700">Sababli{item.excuseNote ? `: ${item.excuseNote}` : ""}</p>
          ) : null}
        </div>
      </div>
      <p className="mt-2 text-xs text-foreground/80">{detail}</p>

      {item.comments.length ? (
        <ul className="mt-2 space-y-1.5">
          {item.comments.map((c) => (
            <li key={c.id} className="rounded-lg bg-muted/50 px-2.5 py-1.5 text-xs">
              <span className={cn("mr-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold", KIND_TONE[c.kind] || KIND_TONE.note)}>
                {STAFF_COMMENT_KIND_LABEL[c.kind] || c.kind}
              </span>
              {c.text}
              <span className="ml-1.5 text-[10px] text-muted-foreground">
                — {c.authorName || "—"}, {fmtStamp(c.createdAt)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {canComment ? (
        writing ? (
          <div className="mt-2">
            <CommentForm
              userId={item.userId}
              defaultKind={item.type === "early" ? "early" : item.type === "late" ? "late" : "note"}
              defaultDate={item.date}
              onDone={() => setWriting(false)}
            />
          </div>
        ) : (
          <Button size="sm" variant="outline" className="mt-2 h-8 gap-1.5 rounded-lg" onClick={() => setWriting(true)}>
            <MessageSquarePlus className="h-3.5 w-3.5" /> Izoh yozish
          </Button>
        )
      ) : null}
    </article>
  );
}
