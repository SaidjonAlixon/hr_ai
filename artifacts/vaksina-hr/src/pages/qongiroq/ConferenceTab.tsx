import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CalendarPlus, Clock, Copy, Crown, MoreHorizontal, Pencil, Radio, Trash2, Users, Video } from "lucide-react";
import { Link } from "wouter";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { conferenceApi, conferenceLink, copyText, formatWhen, type ConferenceListItem } from "@/lib/conference/api";
import { ConferenceFormDialog } from "./ConferenceForm";

function DateBadge({ iso, live }: { iso: string; live: boolean }) {
  const d = new Date(iso);
  return (
    <div
      className={cn(
        "flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-2xl text-center",
        live ? "bg-red-500 text-white shadow-md shadow-red-500/30" : "bg-primary/10 text-primary",
      )}
    >
      {live ? (
        <>
          <Radio className="h-5 w-5 animate-pulse" />
          <span className="mt-0.5 text-[10px] font-bold uppercase">Jonli</span>
        </>
      ) : (
        <>
          <span className="text-lg font-bold leading-none">{d.getDate()}</span>
          <span className="mt-0.5 text-[10px] font-semibold uppercase">{d.toLocaleDateString("uz-UZ", { month: "short" })}</span>
        </>
      )}
    </div>
  );
}

function statusLabel(c: ConferenceListItem) {
  if (c.status === "live") return { text: c.liveCount ? `${c.liveCount} kishi ichkarida` : "Boshlangan", cls: "bg-red-500/10 text-red-600" };
  if (c.status === "cancelled") return { text: "Bekor qilingan", cls: "bg-muted text-muted-foreground" };
  if (c.status === "ended") return { text: "Yakunlangan", cls: "bg-muted text-muted-foreground" };
  const mins = Math.round((new Date(c.scheduledAt).getTime() - Date.now()) / 60_000);
  if (mins <= 10) return { text: "Kirish ochiq", cls: "bg-emerald-500/10 text-emerald-600" };
  if (mins < 60) return { text: `${mins} daqiqadan so‘ng`, cls: "bg-amber-500/10 text-amber-600" };
  return { text: "Rejalashtirilgan", cls: "bg-sky-500/10 text-sky-600" };
}

function ConferenceCard({
  c,
  onEdit,
  onCancel,
}: {
  c: ConferenceListItem;
  onEdit: (code: string) => void;
  onCancel: (c: ConferenceListItem) => void;
}) {
  const { toast } = useToast();
  const live = c.status === "live";
  const active = c.status === "live" || c.status === "scheduled";
  const manage = c.myRole === "host" || c.myRole === "cohost";
  const st = statusLabel(c);
  const end = new Date(new Date(c.scheduledAt).getTime() + c.durationMin * 60_000);
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-2xl border bg-card p-3 shadow-sm transition hover:shadow-md sm:p-4",
        live ? "border-red-300/70 dark:border-red-500/40" : "border-border/60",
        !active && "opacity-75",
      )}
    >
      <DateBadge iso={c.scheduledAt} live={live} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-semibold sm:text-base">{c.title}</p>
          {c.myRole === "host" ? <Crown className="h-3.5 w-3.5 shrink-0 text-amber-500" aria-label="Siz tashkilotchisiz" /> : null}
        </div>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Clock className="h-3.5 w-3.5" />
            {formatWhen(c.scheduledAt)} – {end.toLocaleTimeString("uz-UZ", { hour: "2-digit", minute: "2-digit" })}
          </span>
          <span className="inline-flex items-center gap-1">
            <Users className="h-3.5 w-3.5" /> {c.invitedCount} taklif
          </span>
          <span className="truncate">Tashkilotchi: {c.host.fullName}</span>
        </p>
        <span className={cn("mt-1.5 inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold", st.cls)}>{st.text}</span>
      </div>
      {active ? (
        <Link
          href={`/konferensiya/${c.code}`}
          className={cn(
            "inline-flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold text-white shadow-md transition active:scale-95 sm:px-4 sm:text-sm",
            live ? "bg-red-500 shadow-red-500/25 hover:bg-red-600" : "bg-emerald-600 shadow-emerald-600/20 hover:bg-emerald-700",
          )}
        >
          <Video className="h-4 w-4" />
          <span className="hidden sm:inline">{live ? "Qo‘shilish" : "Kirish"}</span>
        </Link>
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground"
            aria-label="Amallar"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem
            onClick={async () => {
              if (await copyText(conferenceLink(c.code))) toast({ title: "Havola nusxalandi", description: conferenceLink(c.code) });
            }}
          >
            <Copy className="mr-2 h-4 w-4" /> Havolani nusxalash
          </DropdownMenuItem>
          {manage && active ? (
            <>
              <DropdownMenuItem onClick={() => onEdit(c.code)}>
                <Pencil className="mr-2 h-4 w-4" /> Tahrirlash va taklif
              </DropdownMenuItem>
              {c.myRole === "host" ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => onCancel(c)} className="text-red-600 focus:text-red-600">
                    <Trash2 className="mr-2 h-4 w-4" /> {live ? "Yakunlash" : "Bekor qilish"}
                  </DropdownMenuItem>
                </>
              ) : null}
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function Group({ title, items, render }: { title: string; items: ConferenceListItem[]; render: (c: ConferenceListItem) => ReactNode }) {
  if (!items.length) return null;
  return (
    <div className="space-y-2">
      <p className="px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title} · {items.length}
      </p>
      {items.map(render)}
    </div>
  );
}

export function ConferenceTab({ isPlatformAdmin }: { isPlatformAdmin: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [formOpen, setFormOpen] = useState(false);
  const [editCode, setEditCode] = useState<string | null>(null);
  const list = useQuery({
    queryKey: ["conferences"],
    queryFn: conferenceApi.list,
    refetchInterval: 20_000,
    staleTime: 5_000,
  });
  const refresh = () => void qc.invalidateQueries({ queryKey: ["conferences"] });
  const items = list.data?.items ?? [];
  const live = items.filter((c) => c.status === "live");
  const upcoming = items.filter((c) => c.status === "scheduled");
  const past = items.filter((c) => c.status === "ended" || c.status === "cancelled");
  const canCreate = list.data?.canCreate ?? isPlatformAdmin;

  const onCancel = async (c: ConferenceListItem) => {
    const what = c.status === "live" ? "yakunlansinmi? Hamma chiqarib yuboriladi." : "bekor qilinsinmi? Taklif qilinganlarga xabar boradi.";
    if (!window.confirm(`«${c.title}» ${what}`)) return;
    try {
      await conferenceApi.cancel(c.code);
      toast({ title: c.status === "live" ? "Yakunlandi" : "Bekor qilindi" });
      refresh();
    } catch (e) {
      toast({ title: "Xatolik", description: (e as Error).message, variant: "destructive" });
    }
  };

  const render = (c: ConferenceListItem) => (
    <ConferenceCard
      key={c.code}
      c={c}
      onEdit={(code) => {
        setEditCode(code);
        setFormOpen(true);
      }}
      onCancel={onCancel}
    />
  );

  return (
    <div className="space-y-4">
      {canCreate ? (
        <div className="flex flex-col gap-3 rounded-2xl border border-border/60 bg-gradient-to-r from-sky-50 to-emerald-50 p-4 dark:from-sky-500/10 dark:to-emerald-500/10 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">Guruh bo‘lib video uchrashuv</p>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
              Vaqtni belgilang, ishtirokchilarni tanlang — ularga bot orqali kirish havolasi boradi. Ichkarida kim gapirishini, asosiy ekranni
              va chatni siz boshqarasiz.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setEditCode(null);
              setFormOpen(true);
            }}
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-md transition hover:opacity-90 active:scale-95"
          >
            <CalendarPlus className="h-4 w-4" /> Yangi konferensiya
          </button>
        </div>
      ) : null}

      {canCreate && list.data && !list.data.serverReady ? (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <div className="text-sm">
            <p className="font-semibold">Konferensiya media-serveri hali ulanmagan</p>
            <p className="mt-0.5 text-xs leading-relaxed opacity-80">
              Rejalashtirish va taklif yuborish ishlaydi, lekin kirish uchun serverda LiveKit o‘rnatilishi kerak (deploy/livekit yo‘riqnomasi).
            </p>
          </div>
        </div>
      ) : null}

      {list.isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-[88px] w-full rounded-2xl" />
          ))}
        </div>
      ) : list.isError ? (
        <p className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">{(list.error as Error).message}</p>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center rounded-2xl border border-dashed border-border bg-muted/30 px-6 py-10 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-background text-muted-foreground shadow-sm">
            <Video className="h-6 w-6" />
          </div>
          <p className="mt-3 text-sm font-semibold">Konferensiyalar yo‘q</p>
          <p className="mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">
            {canCreate
              ? "«Yangi konferensiya» tugmasi orqali birinchi uchrashuvni rejalashtiring."
              : "Sizni konferensiyaga taklif qilishsa, shu yerda va bot orqali xabar keladi."}
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          <Group title="Hozir davom etmoqda" items={live} render={render} />
          <Group title="Rejalashtirilgan" items={upcoming} render={render} />
          <Group title="O‘tganlar" items={past} render={render} />
        </div>
      )}

      <ConferenceFormDialog open={formOpen} onOpenChange={setFormOpen} editCode={editCode} onSaved={refresh} />
    </div>
  );
}
