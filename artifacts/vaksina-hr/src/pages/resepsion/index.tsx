import { useEffect, useMemo, useState } from "react";
import {
  Bell,
  BriefcaseBusiness,
  CheckCircle2,
  Clock3,
  ConciergeBell,
  Download,
  FileText,
  Loader2,
  LogOut,
  Package,
  Phone,
  Plus,
  QrCode,
  Building2,
  ChevronDown,
  PhoneCall,
  Search,
  Send,
  Store,
  Trash2,
  UserRound,
  Users,
  UserPlus,
  Video,
  X,
} from "lucide-react";
import { callEngine, useCall } from "@/lib/calls/engine";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  formatVisitTime,
  fromLocalInputValue,
  initialsOf,
  toLocalInputValue,
  useReceptionHosts,
  useReceptionLogs,
  useReceptionMeta,
  useReceptionMutations,
  type ReceptionHost,
  type ReceptionLog,
  type ReceptionVisitType,
} from "@/lib/resepsion-api";
import { isPharmacyDeviceStaff, userRoleLabel } from "@/lib/roles";

function isPharmacyHost(role?: string | null) {
  return isPharmacyDeviceStaff(role);
}

const TYPE_TABS: {
  value: ReceptionVisitType;
  label: string;
  icon: typeof UserRound;
  color: string;
}[] = [
  { value: "guest", label: "Mehmon", icon: UserRound, color: "bg-sky-500" },
  { value: "staff", label: "Xodim", icon: Users, color: "bg-emerald-500" },
  { value: "candidate", label: "Nomzod", icon: UserPlus, color: "bg-violet-500" },
  { value: "request", label: "Murojaat", icon: FileText, color: "bg-amber-500" },
  { value: "package", label: "Posilka", icon: Package, color: "bg-rose-500" },
];

const TYPE_BADGE: Record<string, string> = {
  guest: "bg-sky-100 text-sky-800",
  staff: "bg-emerald-100 text-emerald-800",
  candidate: "bg-violet-100 text-violet-800",
  request: "bg-amber-100 text-amber-900",
  package: "bg-rose-100 text-rose-800",
  interview: "bg-violet-100 text-violet-800",
  office_visit: "bg-sky-100 text-sky-800",
  other: "bg-amber-100 text-amber-900",
};

const STATUS_BADGE: Record<string, string> = {
  waiting: "bg-amber-100 text-amber-900",
  in_progress: "bg-emerald-100 text-emerald-800",
  done: "bg-slate-100 text-slate-700",
  cancelled: "bg-muted text-muted-foreground",
  no_show: "bg-rose-100 text-rose-800",
};

function statusLabel(s: string) {
  if (s === "waiting") return "Kutilmoqda";
  if (s === "in_progress") return "Ofisda";
  if (s === "done") return "Chiqdi";
  if (s === "cancelled") return "Bekor";
  if (s === "no_show") return "Kelmadi";
  return s;
}

function typeLabel(t: string) {
  return TYPE_TABS.find((x) => x.value === t)?.label || t;
}

/** Sukutda +998 — foydalanuvchi qolgan raqamlarni yozadi */
function formatVisitorPhone(raw: string): string {
  let digits = raw.replace(/\D/g, "");
  if (!digits.startsWith("998")) {
    digits = `998${digits}`;
  }
  digits = digits.slice(0, 12); // 998 + 9 ta raqam
  const rest = digits.slice(3);
  const a = rest.slice(0, 2);
  const b = rest.slice(2, 5);
  const c = rest.slice(5, 7);
  const d = rest.slice(7, 9);
  let out = "+998";
  if (a) out += ` ${a}`;
  if (b) out += ` ${b}`;
  if (c) out += ` ${c}`;
  if (d) out += ` ${d}`;
  return out;
}

const PHONE_DEFAULT = "+998";

function phoneForSubmit(formatted: string): string | null {
  const digits = formatted.replace(/\D/g, "");
  if (digits.length <= 3) return null; // faqat +998
  if (digits.length < 12) return `+${digits}`;
  return `+${digits.slice(0, 12)}`;
}

const PURPOSE_BY_TYPE: Record<ReceptionVisitType, string[]> = {
  guest: [
    "Uchrashuv",
    "Hujjat topshirish",
    "Shartnoma / imzo",
    "Konsultatsiya",
    "Yetkazib berish",
    "Shikoyat",
  ],
  staff: ["Ish / vazifa", "Hujjat", "Suhbat", "Texnik yordam", "Topshiriq"],
  candidate: ["Ish suhbat", "HR uchrashuv", "Hujjat topshirish", "Sinov / staj"],
  request: ["Murojaat", "Shikoyat", "Taklif", "Ma’lumot so‘rash", "Ariza"],
  package: ["Posilka", "Kuryer", "Hujjat", "Qaytarish", "Ombor"],
};

function AvatarBubble({
  name,
  tone = "primary",
  size = "md",
  photoUrl,
  onOpen,
}: {
  name: string;
  tone?: "primary" | "soft" | "violet" | "emerald";
  size?: "sm" | "md" | "lg" | "xl";
  photoUrl?: string | null;
  onOpen?: () => void;
}) {
  const sz =
    size === "xl"
      ? "h-24 w-24 text-2xl"
      : size === "lg"
        ? "h-14 w-14 text-base"
        : size === "sm"
          ? "h-8 w-8 text-[10px]"
          : "h-10 w-10 text-xs";
  const bg =
    tone === "violet"
      ? "bg-violet-500/15 text-violet-700"
      : tone === "emerald"
        ? "bg-emerald-500/15 text-emerald-700"
        : tone === "soft"
          ? "bg-slate-100 text-slate-600"
          : "bg-primary/15 text-primary";
  if (photoUrl) {
    const img = (
      <img src={photoUrl} alt={name} className="h-full w-full object-cover" />
    );
    const shell = cn(
      "inline-flex shrink-0 overflow-hidden rounded-full ring-2 ring-primary/15 ring-offset-2 ring-offset-card",
      sz,
    );
    if (onOpen) {
      return (
        <button
          type="button"
          onClick={onOpen}
          title="Rasmni kattalashtirish"
          className={cn(
            shell,
            "cursor-zoom-in transition hover:ring-primary/40 focus-visible:outline-none focus-visible:ring-primary/50",
          )}
        >
          {img}
        </button>
      );
    }
    return <span className={shell}>{img}</span>;
  }
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-bold",
        sz,
        bg,
      )}
    >
      {initialsOf(name)}
    </span>
  );
}

function presenceBadgeClass(status?: string) {
  if (status === "in_office") return "bg-emerald-100 text-emerald-800 ring-1 ring-emerald-200";
  if (status === "left") return "bg-slate-100 text-slate-700 ring-1 ring-slate-200";
  if (status === "leave") return "bg-amber-100 text-amber-900 ring-1 ring-amber-200";
  return "bg-rose-100 text-rose-800 ring-1 ring-rose-200";
}

function liveClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const time = now.toLocaleTimeString("uz-UZ", {
    timeZone: "Asia/Tashkent",
    hour: "2-digit",
    minute: "2-digit",
  });
  const date = now.toLocaleDateString("uz-UZ", {
    timeZone: "Asia/Tashkent",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  return { time, date };
}

export default function ResepsionPage() {
  const { toast } = useToast();
  const clock = liveClock();
  const callSnap = useCall();
  const metaQ = useReceptionMeta();
  const hostsQ = useReceptionHosts();
  const mut = useReceptionMutations();
  const callBusy = callSnap.phase !== "idle" && callSnap.phase !== "ended";

  const [dayScope, setDayScope] = useState<"today" | "all">("today");
  const [q, setQ] = useState("");
  const [hostSearch, setHostSearch] = useState("");
  const [hostPickerOpen, setHostPickerOpen] = useState(false);

  const range = useMemo(() => {
    if (dayScope !== "today") return {};
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    return { from: start.toISOString(), to: end.toISOString() };
  }, [dayScope]);

  const logsQ = useReceptionLogs({
    q: q.trim() || undefined,
    ...range,
  });

  const canWrite = metaQ.data?.canWrite ?? logsQ.data?.canWrite ?? false;
  const stats = logsQ.data?.stats;
  const items = logsQ.data?.items ?? [];

  const [visitType, setVisitType] = useState<ReceptionVisitType>("guest");
  const [visitorFullName, setVisitorFullName] = useState("");
  const [visitorPhone, setVisitorPhone] = useState(PHONE_DEFAULT);
  const [purpose, setPurpose] = useState("");
  const [notes, setNotes] = useState("");
  const purposeOptions = PURPOSE_BY_TYPE[visitType] || PURPOSE_BY_TYPE.guest;
  const [visitAt, setVisitAt] = useState(() => toLocalInputValue(new Date()));
  const [leftAt, setLeftAt] = useState("");
  const [hostUserId, setHostUserId] = useState("");
  const [hostName, setHostName] = useState("");
  /** Sukutda ofis yoqilgan, dorixona o‘chiq */
  const [showOfisHosts, setShowOfisHosts] = useState(true);
  const [showPharmacyHosts, setShowPharmacyHosts] = useState(false);
  const [photoPreview, setPhotoPreview] = useState<{ url: string; name: string } | null>(null);

  const selectedHost: ReceptionHost | null = useMemo(() => {
    if (!hostUserId) return null;
    return hostsQ.data?.items.find((h) => String(h.id) === hostUserId) || null;
  }, [hostUserId, hostsQ.data?.items]);

  const filteredHosts = useMemo(() => {
    const list = hostsQ.data?.items || [];
    const s = hostSearch.trim().toLowerCase();
    return list
      .filter((h) => {
        const pharm = isPharmacyHost(h.role);
        if (pharm && !showPharmacyHosts) return false;
        if (!pharm && !showOfisHosts) return false;
        if (!s) return true;
        return (
          h.fullName.toLowerCase().includes(s) ||
          String(h.role || "").toLowerCase().includes(s) ||
          String(h.phone || "").includes(s) ||
          userRoleLabel(h.role).toLowerCase().includes(s)
        );
      })
      .slice(0, 60);
  }, [hostsQ.data?.items, hostSearch, showOfisHosts, showPharmacyHosts]);

  const hostCounts = useMemo(() => {
    const list = hostsQ.data?.items || [];
    let ofis = 0;
    let pharmacy = 0;
    for (const h of list) {
      if (isPharmacyHost(h.role)) pharmacy += 1;
      else ofis += 1;
    }
    return { ofis, pharmacy };
  }, [hostsQ.data?.items]);

  const telegramPreview = useMemo(() => {
    const name = visitorFullName.trim() || "Mehmon";
    const phone = phoneForSubmit(visitorPhone) || "—";
    const sabab = purpose.trim() || "—";
    const tur = typeLabel(String(visitType));
    let text = `Qabulxoona: sizning oldingizga keldi — ${name} (${phone}). Sabab: ${sabab}. Tur: ${tur}.`;
    const note = notes.trim();
    if (note) text += ` Izoh: ${note.slice(0, 300)}`;
    return text;
  }, [visitorFullName, visitorPhone, purpose, visitType, notes]);

  function resetForm() {
    setVisitorFullName("");
    setVisitorPhone(PHONE_DEFAULT);
    setPurpose("");
    setNotes("");
    setVisitAt(toLocalInputValue(new Date()));
    setLeftAt("");
    setHostUserId("");
    setHostName("");
    setHostSearch("");
  }

  function selectVisitType(next: ReceptionVisitType) {
    setVisitType(next);
    const prevPresets = PURPOSE_BY_TYPE[visitType] || [];
    if (!purpose.trim() || prevPresets.includes(purpose)) {
      setPurpose("");
    }
  }

  function pickHost(h: ReceptionHost) {
    setHostUserId(String(h.id));
    setHostName(h.fullName);
    setHostPickerOpen(false);
    setHostSearch("");
  }

  async function onSubmit() {
    if (visitorFullName.trim().length < 2) {
      toast({ title: "Ism familiya yozing", variant: "destructive" });
      return;
    }
    try {
      await mut.create.mutateAsync({
        visitType,
        visitorFullName: visitorFullName.trim(),
        visitorPhone: phoneForSubmit(visitorPhone),
        purpose: purpose.trim() || null,
        notes: notes.trim() || null,
        hostName: hostName.trim() || selectedHost?.fullName || null,
        hostUserId: hostUserId ? Number(hostUserId) : null,
        visitAt: fromLocalInputValue(visitAt),
        leftAt: fromLocalInputValue(leftAt),
        status: "in_progress",
      });
      toast({
        title: "Qayd etildi",
        description: selectedHost
          ? `${selectedHost.fullName} ga xabarnoma yuborildi`
          : "Tashrif jurnalga yozildi",
      });
      resetForm();
    } catch (e) {
      toast({
        title: "Saqlanmadi",
        description: e instanceof Error ? e.message : "Xato",
        variant: "destructive",
      });
    }
  }

  async function markDone(row: ReceptionLog) {
    try {
      await mut.update.mutateAsync({
        id: row.id,
        body: { status: "done", leftAt: new Date().toISOString() },
      });
    } catch (e) {
      toast({
        title: "Yangilanmadi",
        description: e instanceof Error ? e.message : "Xato",
        variant: "destructive",
      });
    }
  }

  async function onDelete(row: ReceptionLog) {
    if (!confirm(`«${row.visitorFullName}» ni o‘chirasizmi?`)) return;
    try {
      await mut.remove.mutateAsync(row.id);
      toast({ title: "O‘chirildi" });
    } catch (e) {
      toast({
        title: "O‘chirilmadi",
        description: e instanceof Error ? e.message : "Xato",
        variant: "destructive",
      });
    }
  }

  function scrollToForm() {
    document.getElementById("resepsion-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="w-full space-y-4 pb-28">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
              <ConciergeBell className="h-5 w-5" />
            </span>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">Qabulxoona</h1>
              <p className="text-sm text-muted-foreground">
                Ofisga keluvchi barcha mehmonlar, xodimlar, nomzodlar va murojaatlar yagona joyda
              </p>
            </div>
          </div>
        </div>
        <div className="rounded-2xl border border-border/70 bg-card px-4 py-2.5 text-right shadow-sm">
          <p className="text-[11px] font-medium capitalize text-muted-foreground">{clock.date}</p>
          <p className="text-2xl font-semibold tabular-nums tracking-tight text-foreground">
            {clock.time}
          </p>
        </div>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <button
          type="button"
          onClick={scrollToForm}
          className="flex items-center gap-3 rounded-2xl bg-primary px-4 py-3 text-left text-primary-foreground shadow-md transition hover:brightness-105"
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15">
            <Plus className="h-5 w-5" />
          </span>
          <span>
            <span className="block text-sm font-semibold">Yangi qayd</span>
            <span className="block text-[11px] opacity-80">Mehmon / Xodim / Nomzod</span>
          </span>
        </button>
        {[
          { label: "Kelayotganlar", value: stats?.waiting ?? 0, hint: "Bugun", tone: "amber" },
          { label: "Ofisda hozir", value: stats?.inProgress ?? 0, hint: "Hozir", tone: "emerald" },
          { label: "Chiqqanlar", value: stats?.done ?? 0, hint: "Bugun", tone: "slate" },
          { label: "Barcha tashriflar", value: stats?.today ?? 0, hint: "Bugun", tone: "sky" },
        ].map((s) => (
          <div
            key={s.label}
            className="rounded-2xl border border-border/70 bg-card px-4 py-3 shadow-sm"
          >
            <p className="text-[11px] font-medium text-muted-foreground">{s.label}</p>
            <p className="mt-0.5 text-2xl font-semibold tabular-nums">{s.value}</p>
            <p className="text-[10px] text-muted-foreground">{s.hint}</p>
          </div>
        ))}
      </div>

      {/* Main workspace */}
      <div className="grid gap-4 xl:grid-cols-12">
        {/* Form */}
        <section
          id="resepsion-form"
          className="rounded-3xl border border-border/70 bg-card p-4 shadow-sm sm:p-5 xl:col-span-5"
        >
          <div className="mb-4 flex items-center justify-between gap-2">
            <h2 className="text-base font-semibold">Yangi tashrif qayd etish</h2>
            <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-[10px] font-semibold text-primary">
              Live
            </span>
          </div>

          <div className="mb-4 grid grid-cols-5 gap-1.5">
            {TYPE_TABS.map((tab) => {
              const Icon = tab.icon;
              const active = visitType === tab.value;
              return (
                <button
                  key={tab.value}
                  type="button"
                  onClick={() => selectVisitType(tab.value)}
                  className={cn(
                    "flex flex-col items-center gap-1 rounded-2xl border px-1 py-2.5 text-center transition",
                    active
                      ? "border-primary/40 bg-primary/10 text-primary shadow-sm"
                      : "border-border/60 bg-muted/30 text-muted-foreground hover:bg-muted/50",
                  )}
                >
                  <span
                    className={cn(
                      "flex h-8 w-8 items-center justify-center rounded-xl text-white",
                      active ? tab.color : "bg-slate-300",
                    )}
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="text-[10px] font-semibold leading-tight">{tab.label}</span>
                </button>
              );
            })}
          </div>

          <div className="space-y-3.5">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Ism familiya *
                </label>
                <Input
                  value={visitorFullName}
                  onChange={(e) => setVisitorFullName(e.target.value)}
                  placeholder="Aliyev Rustam"
                  className="h-11 rounded-2xl border-border/80 bg-background shadow-sm"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Telefon
                </label>
                <div className="relative">
                  <Phone className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={visitorPhone}
                    onChange={(e) => setVisitorPhone(formatVisitorPhone(e.target.value))}
                    onFocus={(e) => {
                      if (!e.target.value.trim()) setVisitorPhone(PHONE_DEFAULT);
                    }}
                    onBlur={() => {
                      if (visitorPhone.replace(/\D/g, "").length <= 3) {
                        setVisitorPhone(PHONE_DEFAULT);
                      }
                    }}
                    inputMode="tel"
                    autoComplete="tel"
                    placeholder="+998 90 111 22 33"
                    className="h-11 rounded-2xl border-border/80 bg-background pl-9 font-medium tabular-nums shadow-sm tracking-wide"
                  />
                </div>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  Prefiks tayyor — faqat qolgan raqamlarni yozing
                </p>
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Sabab / maqsad
              </label>
              <div className="mb-2 flex flex-wrap gap-1.5">
                {purposeOptions.map((opt) => {
                  const active = purpose === opt;
                  return (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => setPurpose(active ? "" : opt)}
                      className={cn(
                        "rounded-xl border px-2.5 py-1.5 text-[11px] font-semibold transition",
                        active
                          ? "border-primary/40 bg-primary text-primary-foreground shadow-sm"
                          : "border-border/70 bg-muted/40 text-foreground hover:border-primary/30 hover:bg-primary/5",
                      )}
                    >
                      {opt}
                    </button>
                  );
                })}
              </div>
              <Input
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                placeholder="Yoki o‘zingiz yozing: qisqa sabab…"
                className="h-11 rounded-2xl border-border/80 bg-background shadow-sm"
              />
              <p className="mt-1 text-[10px] text-muted-foreground">
                Tezkor tugmadan tanlang yoki qisqa yozing — batafsil izohga
              </p>
            </div>

            <div>
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Izoh (batafsil)
              </label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Batafsil: kim bilan, nima haqida, qancha vaqt, maxsus eslatma…"
                className="min-h-[88px] rounded-2xl border-border/80 bg-background shadow-sm"
              />
            </div>

            <div className="relative">
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Kimning oldiga keldi?
              </label>

              {selectedHost ? (
                <div className="mb-2 flex items-center gap-3 rounded-2xl border border-primary/25 bg-gradient-to-r from-primary/10 via-card to-card p-2.5 shadow-sm">
                  <AvatarBubble
                    name={selectedHost.fullName}
                    size="md"
                    photoUrl={selectedHost.photoUrl}
                    onOpen={
                      selectedHost.photoUrl
                        ? () =>
                            setPhotoPreview({
                              url: selectedHost.photoUrl!,
                              name: selectedHost.fullName,
                            })
                        : undefined
                    }
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-foreground">
                      {selectedHost.fullName}
                    </p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {userRoleLabel(selectedHost.role) || selectedHost.role}
                      {isPharmacyHost(selectedHost.role) ? " · Dorixona" : " · Ofis"}
                      {selectedHost.presence?.label
                        ? ` · ${selectedHost.presence.label}`
                        : ""}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 shrink-0 rounded-xl px-2 text-xs"
                    onClick={() => setHostPickerOpen(true)}
                  >
                    Almashtirish
                  </Button>
                  <button
                    type="button"
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-muted-foreground hover:bg-muted"
                    onClick={() => {
                      setHostUserId("");
                      setHostName("");
                    }}
                    aria-label="Tozalash"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : null}

              <button
                type="button"
                onClick={() => setHostPickerOpen((v) => !v)}
                className={cn(
                  "flex h-12 w-full items-center gap-3 rounded-2xl border bg-background px-3.5 text-left text-sm shadow-sm transition",
                  hostPickerOpen
                    ? "border-primary/40 ring-2 ring-primary/15"
                    : "border-border/80 hover:border-primary/30 hover:bg-muted/30",
                )}
              >
                {!selectedHost ? (
                  <>
                    <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <UserRound className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium text-foreground">Xodimni tanlang</span>
                      <span className="block text-[11px] text-muted-foreground">
                        Sukutda faqat ofis xodimlari
                      </span>
                    </span>
                  </>
                ) : (
                  <>
                    <span className="min-w-0 flex-1 text-xs text-muted-foreground">
                      Ro‘yxatni ochish / qidirish
                    </span>
                  </>
                )}
                <ChevronDown
                  className={cn(
                    "h-4 w-4 shrink-0 text-muted-foreground transition",
                    hostPickerOpen && "rotate-180",
                  )}
                />
              </button>

              {hostPickerOpen ? (
                <div className="absolute z-30 mt-2 w-full overflow-hidden rounded-2xl border border-border/80 bg-card shadow-2xl shadow-primary/5 ring-1 ring-black/5">
                  <div className="space-y-2 border-b bg-gradient-to-b from-muted/40 to-card p-3">
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        value={hostSearch}
                        onChange={(e) => setHostSearch(e.target.value)}
                        placeholder="Ism, lavozim yoki telefon…"
                        className="h-10 rounded-xl border-border/70 bg-background pl-9 text-sm shadow-inner"
                        autoFocus
                      />
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <label
                        className={cn(
                          "inline-flex cursor-pointer items-center gap-2 rounded-xl border px-2.5 py-1.5 text-xs font-semibold transition",
                          showOfisHosts
                            ? "border-primary/30 bg-primary/10 text-primary"
                            : "border-border bg-background text-muted-foreground",
                        )}
                      >
                        <Checkbox
                          checked={showOfisHosts}
                          onCheckedChange={(v) => setShowOfisHosts(v === true)}
                        />
                        <Building2 className="h-3.5 w-3.5" />
                        Ofis
                        <span className="rounded-md bg-background/80 px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">
                          {hostCounts.ofis}
                        </span>
                      </label>
                      <label
                        className={cn(
                          "inline-flex cursor-pointer items-center gap-2 rounded-xl border px-2.5 py-1.5 text-xs font-semibold transition",
                          showPharmacyHosts
                            ? "border-violet-400/40 bg-violet-500/10 text-violet-800"
                            : "border-border bg-background text-muted-foreground",
                        )}
                      >
                        <Checkbox
                          checked={showPharmacyHosts}
                          onCheckedChange={(v) => setShowPharmacyHosts(v === true)}
                        />
                        <Store className="h-3.5 w-3.5" />
                        Dorixona
                        <span className="rounded-md bg-background/80 px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">
                          {hostCounts.pharmacy}
                        </span>
                      </label>
                    </div>
                    {!showPharmacyHosts ? (
                      <p className="text-[10px] leading-snug text-muted-foreground">
                        Dorixona xodimlari yashirin — kerak bo‘lsa «Dorixona»ni belgilang.
                      </p>
                    ) : null}
                  </div>
                  <div className="max-h-56 overflow-y-auto p-1.5">
                    {filteredHosts.map((h) => {
                      const pharm = isPharmacyHost(h.role);
                      const active = hostUserId === String(h.id);
                      return (
                        <button
                          key={h.id}
                          type="button"
                          onClick={() => pickHost(h)}
                          className={cn(
                            "group flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition",
                            active
                              ? "bg-primary/10 ring-1 ring-primary/20"
                              : "hover:bg-muted/70",
                          )}
                        >
                          <AvatarBubble
                            name={h.fullName}
                            size="sm"
                            tone={pharm ? "violet" : "primary"}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-1.5">
                              <span className="truncate text-sm font-semibold text-foreground">
                                {h.fullName}
                              </span>
                              <span
                                className={cn(
                                  "shrink-0 rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide",
                                  pharm
                                    ? "bg-violet-100 text-violet-800"
                                    : "bg-sky-100 text-sky-800",
                                )}
                              >
                                {pharm ? "Dorixona" : "Ofis"}
                              </span>
                            </span>
                            <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                              {userRoleLabel(h.role) || h.role}
                              {h.phone ? ` · ${h.phone}` : ""}
                            </span>
                          </span>
                          {h.phone ? (
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted/60 text-muted-foreground group-hover:bg-background">
                              <Phone className="h-3.5 w-3.5" />
                            </span>
                          ) : null}
                        </button>
                      );
                    })}
                    {!filteredHosts.length ? (
                      <div className="px-3 py-8 text-center">
                        <Users className="mx-auto mb-2 h-7 w-7 text-muted-foreground/40" />
                        <p className="text-xs font-medium text-foreground">Xodim topilmadi</p>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          {!showOfisHosts && !showPharmacyHosts
                            ? "Kamida Ofis yoki Dorixona filtrini yoqing"
                            : "Qidiruvni o‘zgartiring yoki Dorixona filtrini yoqing"}
                        </p>
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  <Clock3 className="h-3.5 w-3.5" />
                  Kirish vaqti
                </label>
                <Input
                  type="datetime-local"
                  value={visitAt}
                  onChange={(e) => setVisitAt(e.target.value)}
                  className="h-11 rounded-2xl border-border/80 bg-background shadow-sm"
                />
              </div>
              <div>
                <label className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  <LogOut className="h-3.5 w-3.5" />
                  Kutilayotgan chiqish
                </label>
                <Input
                  type="datetime-local"
                  value={leftAt}
                  onChange={(e) => setLeftAt(e.target.value)}
                  className="h-11 rounded-2xl border-border/80 bg-background shadow-sm"
                />
              </div>
            </div>

            <Button
              type="button"
              className="h-12 w-full rounded-2xl text-sm font-semibold shadow-md shadow-primary/20"
              disabled={!canWrite || mut.create.isPending}
              onClick={() => void onSubmit()}
            >
              {mut.create.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Send className="mr-2 h-4 w-4" />
              )}
              Qayd etish va xabarnoma yuborish
            </Button>
          </div>
        </section>

        {/* Host preview */}
        <section className="rounded-3xl border border-border/70 bg-gradient-to-br from-primary/5 via-card to-card p-4 shadow-sm sm:p-5 xl:col-span-4">
          <h2 className="mb-3 text-base font-semibold">Kimning oldiga</h2>
          {selectedHost ? (
            <div className="space-y-4">
              <div className="flex flex-col items-center text-center sm:flex-row sm:items-start sm:text-left gap-4">
                <AvatarBubble
                  name={selectedHost.fullName}
                  size="xl"
                  photoUrl={selectedHost.photoUrl}
                  onOpen={
                    selectedHost.photoUrl
                      ? () =>
                          setPhotoPreview({
                            url: selectedHost.photoUrl!,
                            name: selectedHost.fullName,
                          })
                      : undefined
                  }
                />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
                    <p className="text-lg font-semibold leading-tight">{selectedHost.fullName}</p>
                    <span
                      className={cn(
                        "rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                        presenceBadgeClass(selectedHost.presence?.status),
                      )}
                    >
                      {selectedHost.presence?.label || "Kelmagan"}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {userRoleLabel(selectedHost.role) || selectedHost.role}
                    {isPharmacyHost(selectedHost.role) ? " · Dorixona" : " · Ofis"}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    Davomat:{" "}
                    {selectedHost.presence?.checkIn
                      ? `keldi ${selectedHost.presence.checkIn}`
                      : "bugun kelmagan"}
                    {selectedHost.presence?.checkOut
                      ? ` · ketdi ${selectedHost.presence.checkOut}`
                      : selectedHost.presence?.status === "in_office"
                        ? " · hali ofisda"
                        : ""}
                  </p>
                </div>
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                <div className="rounded-2xl border bg-card/80 px-3 py-2.5">
                  <p className="text-[10px] font-semibold uppercase text-muted-foreground">Telefon</p>
                  <p className="mt-0.5 text-sm font-medium tabular-nums">
                    {selectedHost.phone || "—"}
                  </p>
                </div>
                <div className="rounded-2xl border bg-card/80 px-3 py-2.5">
                  <p className="text-[10px] font-semibold uppercase text-muted-foreground">
                    Tashrif turi
                  </p>
                  <p className="mt-0.5 text-sm font-medium">{typeLabel(String(visitType))}</p>
                </div>
              </div>

              <div className="overflow-hidden rounded-2xl border border-[#229ED9]/30 bg-gradient-to-b from-[#E8F6FD] to-card shadow-sm dark:from-[#0B3A4D]/40">
                <div className="flex items-center gap-2 border-b border-[#229ED9]/20 bg-[#229ED9]/10 px-3 py-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#229ED9] text-white">
                    <Send className="h-3.5 w-3.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-[#0B6B94]">Telegram bot</p>
                    <p className="truncate text-[10px] text-muted-foreground">
                      {selectedHost.hasTelegram
                        ? "Bog‘langan — qayd etganda yuboriladi"
                        : "Telegram ulanmagan — faqat tizim xabari"}
                    </p>
                  </div>
                </div>
                <div className="space-y-2 p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Boradigan xabar ko‘rinishi
                  </p>
                  <div className="rounded-2xl rounded-tl-sm bg-white px-3 py-2.5 text-left shadow-sm ring-1 ring-black/5 dark:bg-slate-900">
                    <p className="text-[11px] font-semibold text-[#229ED9]">Vaksina HR</p>
                    <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-foreground">
                      {telegramPreview}
                    </p>
                  </div>
                  <p className="text-[10px] leading-snug text-muted-foreground">
                    «Qayd etish» bosilganda shu matn xodimga Telegram + tizim bildirishnomasiga
                    ketadi.
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Tizim orqali qo‘ng‘iroq
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    type="button"
                    className="h-11 rounded-2xl bg-emerald-600 font-semibold hover:bg-emerald-700"
                    disabled={callBusy || !(callSnap.me?.canCall ?? true)}
                    onClick={() =>
                      void callEngine.call(
                        {
                          id: selectedHost.id,
                          fullName: selectedHost.fullName,
                          role: selectedHost.role,
                        },
                        false,
                      )
                    }
                  >
                    <PhoneCall className="mr-1.5 h-4 w-4" />
                    Ovozli
                  </Button>
                  <Button
                    type="button"
                    className="h-11 rounded-2xl bg-sky-600 font-semibold hover:bg-sky-700"
                    disabled={callBusy || !(callSnap.me?.canCall ?? true)}
                    onClick={() =>
                      void callEngine.call(
                        {
                          id: selectedHost.id,
                          fullName: selectedHost.fullName,
                          role: selectedHost.role,
                        },
                        true,
                      )
                    }
                  >
                    <Video className="mr-1.5 h-4 w-4" />
                    Video
                  </Button>
                </div>
                {selectedHost.phone ? (
                  <a
                    href={`tel:${selectedHost.phone.replace(/\s/g, "")}`}
                    className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-2xl border border-border/80 bg-card text-sm font-medium text-foreground hover:bg-muted/40"
                  >
                    <Phone className="h-4 w-4 text-muted-foreground" />
                    Mobil raqamga qo‘ng‘iroq
                  </a>
                ) : null}
                {callBusy ? (
                  <p className="text-center text-[10px] text-amber-700">
                    Joriy qo‘ng‘iroq davom etmoqda…
                  </p>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="flex min-h-[280px] flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-muted/20 px-4 text-center">
              <BriefcaseBusiness className="mb-2 h-8 w-8 text-muted-foreground/50" />
              <p className="text-sm font-medium text-foreground">Xodim tanlanmagan</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Chapdagi formadan «Kimning oldiga» ni tanlang — rasm, davomat holati, Telegram
                xabar ko‘rinishi va qo‘ng‘iroq shu yerda ochiladi.
              </p>
            </div>
          )}
        </section>

        {/* Quick side */}
        <aside className="space-y-3 xl:col-span-3">
          <div className="rounded-3xl border border-sky-200 bg-sky-50 p-4 text-sky-950 shadow-sm dark:border-sky-900/40 dark:bg-sky-950/30 dark:text-sky-50">
            <p className="flex items-center gap-2 text-sm font-semibold">
              <Bell className="h-4 w-4" />
              Xodimga xabar
            </p>
            <p className="mt-1.5 text-xs leading-relaxed opacity-90">
              Tashrif qayd etilganda tanlangan xodimga tizim ichida bildirishnoma yuboriladi.
            </p>
          </div>

          <div className="rounded-3xl border border-border/70 bg-card p-4 shadow-sm">
            <p className="text-sm font-semibold">Tashrifnoma</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Mehmon uchun qisqa yo‘llanma — ism, kimning oldiga, vaqt.
            </p>
            <Button
              type="button"
              variant="secondary"
              className="mt-3 h-9 w-full rounded-xl gap-1.5"
              onClick={() => window.print()}
            >
              <QrCode className="h-4 w-4" />
              Chop etish
            </Button>
          </div>

          <div className="rounded-3xl border border-border/70 bg-card p-4 shadow-sm">
            <p className="mb-2 text-sm font-semibold">Tezkor amallar</p>
            <div className="space-y-1.5">
              <button
                type="button"
                onClick={() => setDayScope("today")}
                className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-sm hover:bg-muted/50"
              >
                <Clock3 className="h-4 w-4 text-primary" />
                Bugungi jurnal
              </button>
              <button
                type="button"
                onClick={() => setDayScope("all")}
                className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-sm hover:bg-muted/50"
              >
                <FileText className="h-4 w-4 text-primary" />
                Barcha tashriflar
              </button>
              <button
                type="button"
                onClick={scrollToForm}
                className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-sm hover:bg-muted/50"
              >
                <Download className="h-4 w-4 text-primary" />
                Yangi qayd
              </button>
            </div>
          </div>
        </aside>
      </div>

      {/* Table */}
      <section className="overflow-hidden rounded-3xl border border-border/70 bg-card shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/30 px-4 py-3">
          <div>
            <h2 className="text-base font-semibold">
              {dayScope === "today" ? "Bugungi tashriflar" : "Barcha tashriflar"}
            </h2>
            <p className="text-xs text-muted-foreground">{items.length} ta yozuv</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[180px]">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Qidirish…"
                className="h-9 rounded-xl pl-8"
              />
            </div>
            <div className="flex rounded-xl border bg-card p-0.5 text-xs font-semibold">
              <button
                type="button"
                className={cn(
                  "rounded-lg px-3 py-1.5",
                  dayScope === "today"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground",
                )}
                onClick={() => setDayScope("today")}
              >
                Bugun
              </button>
              <button
                type="button"
                className={cn(
                  "rounded-lg px-3 py-1.5",
                  dayScope === "all"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground",
                )}
                onClick={() => setDayScope("all")}
              >
                Barchasi
              </button>
            </div>
          </div>
        </div>

        {logsQ.isLoading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Yuklanmoqda…
          </div>
        ) : items.length === 0 ? (
          <div className="px-4 py-16 text-center text-sm text-muted-foreground">
            Hali tashrif yo‘q. Yuqoridan yangi qayd qo‘shing.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-left text-sm">
              <thead className="border-b bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2.5 font-semibold">#</th>
                  <th className="px-3 py-2.5 font-semibold">Vaqt</th>
                  <th className="px-3 py-2.5 font-semibold">Mehmon</th>
                  <th className="px-3 py-2.5 font-semibold">Turi</th>
                  <th className="px-3 py-2.5 font-semibold">Kimning oldiga</th>
                  <th className="px-3 py-2.5 font-semibold">Maqsad</th>
                  <th className="px-3 py-2.5 font-semibold">Holat</th>
                  <th className="px-3 py-2.5 font-semibold">Chiqish</th>
                  <th className="px-3 py-2.5 font-semibold">Amal</th>
                </tr>
              </thead>
              <tbody>
                {items.map((row, idx) => (
                  <tr key={row.id} className="border-b border-border/50 hover:bg-muted/20">
                    <td className="px-3 py-3 tabular-nums text-muted-foreground">{idx + 1}</td>
                    <td className="px-3 py-3 tabular-nums font-medium">
                      {formatVisitTime(row.visitAt)}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2.5">
                        <AvatarBubble name={row.visitorFullName} size="sm" tone="violet" />
                        <div className="min-w-0">
                          <p className="truncate font-medium">{row.visitorFullName}</p>
                          {row.visitorPhone ? (
                            <p className="truncate text-[11px] text-muted-foreground">
                              {row.visitorPhone}
                            </p>
                          ) : null}
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <span
                        className={cn(
                          "inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold",
                          TYPE_BADGE[row.visitType] || "bg-muted",
                        )}
                      >
                        {row.visitTypeLabel || typeLabel(String(row.visitType))}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2">
                        <AvatarBubble
                          name={row.hostName || row.hostUserName || "?"}
                          size="sm"
                          tone="emerald"
                        />
                        <span className="truncate text-xs">
                          {row.hostName || row.hostUserName || "—"}
                        </span>
                      </div>
                    </td>
                    <td className="max-w-[160px] truncate px-3 py-3 text-xs text-muted-foreground">
                      {row.purpose || "—"}
                    </td>
                    <td className="px-3 py-3">
                      <span
                        className={cn(
                          "inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold",
                          STATUS_BADGE[row.status] || "bg-muted",
                        )}
                      >
                        {statusLabel(row.status)}
                      </span>
                    </td>
                    <td className="px-3 py-3 tabular-nums text-xs text-muted-foreground">
                      {row.leftAt ? formatVisitTime(row.leftAt) : "—"}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap gap-1">
                        {canWrite && row.status !== "done" ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            className="h-7 rounded-lg px-2 text-[11px]"
                            onClick={() => void markDone(row)}
                          >
                            <LogOut className="mr-1 h-3 w-3" />
                            Chiqdi
                          </Button>
                        ) : (
                          <span className="inline-flex h-7 items-center gap-1 rounded-lg px-2 text-[11px] text-emerald-700">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            OK
                          </span>
                        )}
                        {row.visitorPhone ? (
                          <a
                            href={`tel:${row.visitorPhone.replace(/\s/g, "")}`}
                            className="inline-flex h-7 items-center rounded-lg px-2 text-muted-foreground hover:bg-muted"
                          >
                            <Phone className="h-3.5 w-3.5" />
                          </a>
                        ) : null}
                        {canWrite ? (
                          <button
                            type="button"
                            className="inline-flex h-7 items-center rounded-lg px-2 text-rose-600 hover:bg-rose-50"
                            onClick={() => void onDelete(row)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {photoPreview ? (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label={`${photoPreview.name} rasmi`}
          onClick={() => setPhotoPreview(null)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setPhotoPreview(null);
          }}
        >
          <button
            type="button"
            className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-white hover:bg-white/25"
            onClick={() => setPhotoPreview(null)}
            aria-label="Yopish"
          >
            <X className="h-5 w-5" />
          </button>
          <div
            className="flex max-h-[90vh] max-w-[min(92vw,420px)] flex-col items-center gap-3"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={photoPreview.url}
              alt={photoPreview.name}
              className="max-h-[78vh] w-full rounded-3xl object-cover shadow-2xl ring-1 ring-white/20"
            />
            <p className="text-sm font-semibold text-white drop-shadow">{photoPreview.name}</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
