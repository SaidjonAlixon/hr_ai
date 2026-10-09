import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  History,
  Lock,
  Phone,
  PhoneIncoming,
  PhoneMissed,
  PhoneOutgoing,
  Pin,
  PinOff,
  Search,
  ShieldCheck,
  ShieldOff,
  Users,
  Video,
  Presentation,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { hasFullPlatformAccess } from "@/lib/roles";
import { ConferenceTab } from "./ConferenceTab";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { callEngine, useCall, type CallPeer } from "@/lib/calls/engine";
import { CallAvatar, formatDuration } from "@/components/calls/CallLayer";

type Contact = {
  id: number;
  fullName: string;
  role: string;
  position: string | null;
  branch: string | null;
  canCall: boolean;
  online: boolean;
  pinnedAt: string | null;
};

type ContactsData = { items: Contact[]; onlineTotal?: number };

function sortContacts(items: Contact[]) {
  return [...items].sort(
    (a, b) =>
      Number(Boolean(b.pinnedAt)) - Number(Boolean(a.pinnedAt)) ||
      (b.pinnedAt ?? "").localeCompare(a.pinnedAt ?? "") ||
      Number(b.online) - Number(a.online) ||
      a.fullName.localeCompare(b.fullName, "uz"),
  );
}

type HistoryItem = {
  id: string;
  outgoing: boolean;
  video: boolean;
  status: string;
  createdAt: string;
  durationSec: number;
  peer: CallPeer;
};

type PermissionItem = {
  userId: number;
  fullName: string;
  role: string;
  grantedByName: string | null;
  grantedAt: string;
  online: boolean;
};

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "include" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || "Yuklanmadi");
  return data as T;
}

function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

const STATUS_TEXT: Record<string, string> = {
  answered: "Gaplashildi",
  ended: "Gaplashildi",
  missed: "Javobsiz",
  declined: "Rad etilgan",
  cancelled: "Bekor qilingan",
  busy: "Band edi",
  failed: "Uzilgan",
  ringing: "Jiringlagan",
};

function whenText(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const yest = new Date(Date.now() - 86_400_000);
  const time = d.toLocaleTimeString("uz-UZ", { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === today.toDateString()) return `Bugun, ${time}`;
  if (d.toDateString() === yest.toDateString()) return `Kecha, ${time}`;
  return `${d.toLocaleDateString("uz-UZ", { day: "2-digit", month: "2-digit", year: "numeric" })}, ${time}`;
}

function roleText(c: { role: string; position?: string | null; branch?: string | null }) {
  if (c.role === "admin") return "Administrator";
  return [c.position, c.branch].filter(Boolean).join(" · ") || "Xodim";
}

function CallButtons({ peer, disabled }: { peer: CallPeer; disabled?: boolean }) {
  const s = useCall();
  const busy = s.phase !== "idle" && s.phase !== "ended";
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <button
        type="button"
        disabled={disabled || busy}
        onClick={() => void callEngine.call(peer, false)}
        className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500 text-white shadow-md shadow-emerald-500/25 transition hover:bg-emerald-600 active:scale-90 disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none dark:disabled:bg-white/10"
        aria-label="Ovozli qo‘ng‘iroq"
        title="Ovozli qo‘ng‘iroq"
      >
        <Phone className="h-[18px] w-[18px]" />
      </button>
      <button
        type="button"
        disabled={disabled || busy}
        onClick={() => void callEngine.call(peer, true)}
        className="flex h-10 w-10 items-center justify-center rounded-full bg-sky-600 text-white shadow-md shadow-sky-600/25 transition hover:bg-sky-700 active:scale-90 disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none dark:disabled:bg-white/10"
        aria-label="Video qo‘ng‘iroq"
        title="Video qo‘ng‘iroq"
      >
        <Video className="h-[18px] w-[18px]" />
      </button>
    </div>
  );
}

function ContactRow({
  c,
  isAdmin,
  canCall,
  onPermission,
  permPending,
  onPin,
}: {
  c: Contact;
  isAdmin: boolean;
  canCall: boolean;
  onPermission: (c: Contact, allowed: boolean) => void;
  permPending: boolean;
  onPin: (c: Contact) => void;
}) {
  const pinned = Boolean(c.pinnedAt);
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-2xl border bg-card p-3 shadow-sm transition hover:shadow-md sm:gap-3",
        pinned ? "border-amber-300/80 bg-amber-50/40 dark:border-amber-500/40 dark:bg-amber-500/5" : "border-border/60 hover:border-border",
      )}
    >
      <div className="relative">
        <CallAvatar id={c.id} name={c.fullName} className="h-12 w-12 text-base" />
        <span
          className={cn(
            "absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full ring-2 ring-card",
            c.online ? "bg-emerald-500" : "bg-slate-300 dark:bg-slate-600",
          )}
          title={c.online ? "Onlayn" : "Oflayn"}
        />
      </div>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-sm font-semibold">
          <span className="truncate">{c.fullName}</span>
          {pinned ? <Pin className="h-3.5 w-3.5 shrink-0 fill-amber-400 text-amber-500" aria-label="Qadalgan" /> : null}
        </p>
        <p className="truncate text-xs text-muted-foreground">{roleText(c)}</p>
        <p className={cn("mt-0.5 text-[11px] font-medium", c.online ? "text-emerald-600" : "text-muted-foreground/70")}>
          {c.online ? "Onlayn — qo‘ng‘iroq qilish mumkin" : "Oflayn — platformada emas"}
        </p>
      </div>
      <button
        type="button"
        onClick={() => onPin(c)}
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition active:scale-90",
          pinned
            ? "bg-amber-100 text-amber-600 hover:bg-amber-200 dark:bg-amber-500/15 dark:text-amber-300"
            : "text-muted-foreground hover:bg-muted hover:text-foreground",
        )}
        aria-label={pinned ? "Qadashni olib tashlash" : "Tepaga qadash"}
        title={pinned ? "Qadashni olib tashlash" : "Tepaga qadash"}
      >
        {pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
      </button>
      {isAdmin && c.role !== "admin" ? (
        <label className="mr-1 hidden flex-col items-center gap-1 text-[10px] font-medium text-muted-foreground sm:flex">
          <Switch checked={c.canCall} disabled={permPending} onCheckedChange={(v) => onPermission(c, v)} />
          Ruxsat
        </label>
      ) : null}
      <CallButtons peer={{ id: c.id, fullName: c.fullName, role: c.role }} disabled={!canCall || !c.online} />
      {isAdmin && c.role !== "admin" ? (
        <div className="sm:hidden">
          <Switch checked={c.canCall} disabled={permPending} onCheckedChange={(v) => onPermission(c, v)} aria-label="Ruxsat" />
        </div>
      ) : null}
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-2">
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className="h-[76px] w-full rounded-2xl" />
      ))}
    </div>
  );
}

function EmptyState({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-border bg-muted/30 px-6 py-10 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-background text-muted-foreground shadow-sm">{icon}</div>
      <p className="mt-3 text-sm font-semibold">{title}</p>
      <p className="mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">{text}</p>
    </div>
  );
}

export default function QongiroqPage() {
  const s = useCall();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  const isAdmin = Boolean(s.me?.isAdmin);
  const canCall = Boolean(s.me?.canCall || isAdmin);
  const [tab, setTab] = useState(() =>
    new URLSearchParams(window.location.search).get("tab") === "konferensiya" ? "conference" : "contacts",
  );
  const [q, setQ] = useState("");
  const [scope, setScope] = useState<"online" | "all">("online");
  const dq = useDebounced(q.trim());
  const onlineOnly = isAdmin && scope === "online";

  const contacts = useQuery({
    queryKey: ["calls", "contacts", dq, onlineOnly],
    queryFn: () =>
      getJson<ContactsData>(
        `/api/calls/contacts?q=${encodeURIComponent(dq)}${onlineOnly ? "&online=1" : ""}`,
      ),
    refetchInterval: onlineOnly ? 10_000 : 20_000,
    staleTime: 5_000,
  });
  const history = useQuery({
    queryKey: ["calls", "history"],
    queryFn: () => getJson<{ items: HistoryItem[] }>("/api/calls/history"),
    enabled: tab === "history",
  });
  const permissions = useQuery({
    queryKey: ["calls", "permissions"],
    queryFn: () => getJson<{ items: PermissionItem[] }>("/api/calls/permissions"),
    enabled: isAdmin && tab === "permissions",
  });

  useEffect(() => {
    if (s.phase === "ended") void qc.invalidateQueries({ queryKey: ["calls", "history"] });
  }, [s.phase, qc]);

  const setPerm = useMutation({
    mutationFn: async ({ userId, allowed }: { userId: number; allowed: boolean; name: string }) => {
      const res = await fetch(`/api/calls/permissions/${userId}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allowed }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error || "Saqlanmadi");
    },
    onSuccess: (_d, v) => {
      toast({ title: v.allowed ? "Ruxsat berildi" : "Ruxsat olib tashlandi", description: v.name });
      void qc.invalidateQueries({ queryKey: ["calls"] });
    },
    onError: (e: Error) => toast({ title: "Xatolik", description: e.message, variant: "destructive" }),
  });

  const setPin = useMutation({
    mutationFn: async ({ userId, pinned }: { userId: number; pinned: boolean }) => {
      const res = await fetch(`/api/calls/pins/${userId}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pinned }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error || "Saqlanmadi");
    },
    onMutate: async ({ userId, pinned }) => {
      await qc.cancelQueries({ queryKey: ["calls", "contacts"] });
      const prev = qc.getQueriesData<ContactsData>({ queryKey: ["calls", "contacts"] });
      const at = new Date().toISOString();
      qc.setQueriesData<ContactsData>({ queryKey: ["calls", "contacts"] }, (old) =>
        old
          ? {
              ...old,
              items: sortContacts(old.items.map((c) => (c.id === userId ? { ...c, pinnedAt: pinned ? at : null } : c))),
            }
          : old,
      );
      return { prev };
    },
    onError: (e: Error, _v, ctx) => {
      for (const [key, data] of ctx?.prev ?? []) qc.setQueryData(key, data);
      toast({ title: "Xatolik", description: e.message, variant: "destructive" });
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: ["calls", "contacts"] }),
  });

  const items = contacts.data?.items ?? [];
  const pinnedItems = useMemo(() => items.filter((c) => c.pinnedAt), [items]);
  const otherItems = useMemo(() => items.filter((c) => !c.pinnedAt), [items]);
  const listOnline = useMemo(() => items.filter((c) => c.online).length, [items]);
  const onlineCount = contacts.data?.onlineTotal ?? listOnline;
  const onPermission = (c: Contact, allowed: boolean) => setPerm.mutate({ userId: c.id, allowed, name: c.fullName });
  const onPin = (c: Contact) => setPin.mutate({ userId: c.id, pinned: !c.pinnedAt });
  const renderRow = (c: Contact) => (
    <ContactRow
      key={c.id}
      c={c}
      isAdmin={isAdmin}
      canCall={canCall}
      onPermission={onPermission}
      permPending={setPerm.isPending}
      onPin={onPin}
    />
  );

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-3 pb-24 sm:p-5 sm:pb-8">
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#062e2a] via-[#0b4d5c] to-[#0b5fff] p-5 text-white shadow-lg sm:p-7">
        <div className="pointer-events-none absolute -right-10 -top-16 h-56 w-56 rounded-full bg-emerald-400/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-20 left-10 h-56 w-56 rounded-full bg-sky-400/20 blur-3xl" />
        <div className="relative z-10 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-white/90 ring-1 ring-white/15">
              <Phone className="h-3.5 w-3.5" /> Qo‘ng‘iroq
            </div>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Qo‘ng‘iroqlar</h1>
            <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-white/80">
              {isAdmin
                ? "Istalgan xodimga ovozli yoki video qo‘ng‘iroq qiling, ekranini ko‘ring va ruxsati bilan qurilmasini boshqaring."
                : "Administrator bilan ovozli yoki video aloqa. Ekraningizni ulashishingiz va yordam olishingiz mumkin."}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/12 px-3 py-1.5 text-xs font-semibold ring-1 ring-white/15">
              <span className={cn("h-2 w-2 rounded-full", s.online ? "bg-emerald-400" : "bg-amber-400 animate-pulse")} />
              {s.online ? "Ulangan" : "Ulanmoqda…"}
            </span>
            {!isAdmin ? (
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ring-1",
                  canCall ? "bg-emerald-500/20 ring-emerald-300/30" : "bg-white/10 ring-white/15",
                )}
              >
                {canCall ? <ShieldCheck className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
                {canCall ? "Ruxsat bor" : "Ruxsat yo‘q"}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/12 px-3 py-1.5 text-xs font-semibold ring-1 ring-white/15">
                <Users className="h-3.5 w-3.5" /> {onlineCount} onlayn
              </span>
            )}
          </div>
        </div>
      </div>

      {!isAdmin && !canCall && s.me ? (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          <Lock className="mt-0.5 h-5 w-5 shrink-0" />
          <div className="text-sm">
            <p className="font-semibold">Qo‘ng‘iroq qilish uchun admin ruxsati kerak</p>
            <p className="mt-0.5 text-xs leading-relaxed opacity-80">
              Admin sizga ruxsat bergach, shu yerdan qo‘ng‘iroq qila olasiz. Admin o‘zi qo‘ng‘iroq qilsa, uni har doim qabul qilishingiz
              mumkin.
            </p>
          </div>
        </div>
      ) : null}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className={cn("grid w-full", isAdmin ? "grid-cols-4" : "grid-cols-3")}>
          <TabsTrigger value="contacts" className="gap-1.5">
            <Users className="h-4 w-4" /> <span className="hidden sm:inline">{isAdmin ? "Xodimlar" : "Adminlar"}</span>
          </TabsTrigger>
          <TabsTrigger value="conference" className="gap-1.5">
            <Presentation className="h-4 w-4" /> <span className="hidden sm:inline">Konferensiya</span>
          </TabsTrigger>
          <TabsTrigger value="history" className="gap-1.5">
            <History className="h-4 w-4" /> <span className="hidden sm:inline">Tarix</span>
          </TabsTrigger>
          {isAdmin ? (
            <TabsTrigger value="permissions" className="gap-1.5">
              <ShieldCheck className="h-4 w-4" /> <span className="hidden sm:inline">Ruxsatlar</span>
            </TabsTrigger>
          ) : null}
        </TabsList>

        <TabsContent value="contacts" className="mt-3 space-y-3">
          {isAdmin ? (
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Ism, telefon yoki filial bo‘yicha qidirish…"
                  className="h-11 rounded-2xl pl-9"
                />
              </div>
              <div className="grid h-11 shrink-0 grid-cols-2 rounded-2xl bg-muted p-1 text-xs font-semibold">
                {(
                  [
                    ["online", `Onlayn · ${onlineCount}`],
                    ["all", "Hammasi"],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setScope(key)}
                    className={cn(
                      "flex items-center justify-center gap-1.5 rounded-xl px-4 transition",
                      scope === key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {key === "online" ? <span className="h-2 w-2 rounded-full bg-emerald-500" /> : null}
                    {label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {isAdmin && scope === "all" ? (
            <p className="px-1 text-xs text-muted-foreground">
              Bu yerda ruxsat berish uchun barcha xodimlar ko‘rinadi. Qo‘ng‘iroq faqat onlayn turganlarga qilinadi.
            </p>
          ) : null}
          {contacts.isLoading ? (
            <ListSkeleton />
          ) : contacts.isError ? (
            <EmptyState icon={<Users className="h-6 w-6" />} title="Ro‘yxat yuklanmadi" text={(contacts.error as Error).message} />
          ) : items.length === 0 ? (
            <EmptyState
              icon={<Users className="h-6 w-6" />}
              title={onlineOnly ? "Hozir hech kim onlayn emas" : isAdmin ? "Hech kim topilmadi" : "Adminlar topilmadi"}
              text={
                onlineOnly
                  ? "Platformaga kirgan xodimlar shu yerda avtomatik paydo bo‘ladi."
                  : isAdmin
                    ? "Qidiruv so‘zini o‘zgartirib ko‘ring."
                    : "Hozircha qo‘ng‘iroq qilish mumkin bo‘lgan admin yo‘q."
              }
            />
          ) : (
            <div className="space-y-2">
              {pinnedItems.length ? (
                <>
                  <p className="flex items-center gap-1.5 px-1 text-[11px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-300">
                    <Pin className="h-3 w-3" /> Qadalganlar · {pinnedItems.length}
                  </p>
                  {pinnedItems.map(renderRow)}
                  {otherItems.length ? (
                    <p className="px-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Boshqalar</p>
                  ) : null}
                </>
              ) : null}
              {otherItems.map(renderRow)}
            </div>
          )}
        </TabsContent>

        <TabsContent value="conference" className="mt-3">
          <ConferenceTab isPlatformAdmin={hasFullPlatformAccess(user?.role)} />
        </TabsContent>

        <TabsContent value="history" className="mt-3">
          {history.isLoading ? (
            <ListSkeleton />
          ) : (history.data?.items ?? []).length === 0 ? (
            <EmptyState icon={<History className="h-6 w-6" />} title="Tarix bo‘sh" text="Qilingan va kelgan qo‘ng‘iroqlar shu yerda ko‘rinadi." />
          ) : (
            <div className="max-h-[min(55vh,26rem)] divide-y divide-border/60 overflow-y-auto overscroll-contain rounded-2xl border border-border/60 bg-card shadow-sm [scrollbar-width:thin]">
              {history.data!.items.map((h) => {
                const missed = !h.outgoing && (h.status === "missed" || h.status === "cancelled");
                const Icon = missed ? PhoneMissed : h.outgoing ? PhoneOutgoing : PhoneIncoming;
                const talked = h.durationSec > 0;
                const peerCallable = isAdmin || (canCall && h.peer.role === "admin");
                return (
                  <div key={h.id} className="flex items-center gap-3 p-3">
                    <CallAvatar id={h.peer.id} name={h.peer.fullName} className="h-10 w-10 text-sm" />
                    <div className="min-w-0 flex-1">
                      <p className={cn("truncate text-sm font-semibold", missed && "text-red-600")}>{h.peer.fullName}</p>
                      <p className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                        <Icon className={cn("h-3.5 w-3.5 shrink-0", missed ? "text-red-500" : h.outgoing ? "text-sky-600" : "text-emerald-600")} />
                        {h.video ? <Video className="h-3.5 w-3.5 shrink-0" /> : null}
                        {talked ? formatDuration(h.durationSec) : STATUS_TEXT[h.status] ?? h.status} · {whenText(h.createdAt)}
                      </p>
                    </div>
                    <CallButtons peer={h.peer} disabled={!peerCallable} />
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>

        {isAdmin ? (
          <TabsContent value="permissions" className="mt-3 space-y-3">
            <div className="rounded-2xl border border-sky-200 bg-sky-50 p-3 text-xs leading-relaxed text-sky-900 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-200">
              Ruxsat berilgan xodimlar adminlarga qo‘ng‘iroq qila oladi. Boshqa xodimlarga qo‘ng‘iroq qilish hech kimga mumkin emas.
              Yangi ruxsat «Xodimlar» bo‘limidagi «Ruxsat» tugmasi orqali beriladi.
            </div>
            {permissions.isLoading ? (
              <ListSkeleton />
            ) : (permissions.data?.items ?? []).length === 0 ? (
              <EmptyState icon={<ShieldOff className="h-6 w-6" />} title="Hali hech kimga ruxsat berilmagan" text="Xodimlar ro‘yxatidan kerakli xodimni tanlab, ruxsatni yoqing." />
            ) : (
              <div className="space-y-2">
                {permissions.data!.items.map((p) => (
                  <div key={p.userId} className="flex items-center gap-3 rounded-2xl border border-border/60 bg-card p-3 shadow-sm">
                    <div className="relative">
                      <CallAvatar id={p.userId} name={p.fullName} className="h-11 w-11 text-sm" />
                      <span
                        className={cn(
                          "absolute bottom-0 right-0 h-3 w-3 rounded-full ring-2 ring-card",
                          p.online ? "bg-emerald-500" : "bg-slate-300 dark:bg-slate-600",
                        )}
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{p.fullName}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {p.grantedByName ? `${p.grantedByName} · ` : ""}
                        {whenText(p.grantedAt)}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={setPerm.isPending}
                      onClick={() => setPerm.mutate({ userId: p.userId, allowed: false, name: p.fullName })}
                      className="rounded-xl bg-red-50 px-3 py-2 text-xs font-semibold text-red-600 transition hover:bg-red-100 active:scale-95 disabled:opacity-50 dark:bg-red-500/10"
                    >
                      Olib tashlash
                    </button>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>
        ) : null}
      </Tabs>
    </div>
  );
}
