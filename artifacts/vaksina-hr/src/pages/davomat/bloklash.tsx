import React, { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import {
  Award,
  Building2,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  EyeOff,
  Fingerprint,
  History,
  Layers,
  Loader2,
  MapPin,
  QrCode,
  RefreshCw,
  RotateCcw,
  ScanFace,
  Search,
  ShieldAlert,
  ShieldCheck,
  ShieldOff,
  SlidersHorizontal,
  Store,
  Users,
  X,
} from "lucide-react";
import BloklashTarix from "@/components/davomat/BloklashTarix";
import UnvonPanel from "@/components/davomat/UnvonPanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { hasFullPlatformAccess, normalizeUserRole, userRoleLabel } from "@/lib/roles";
import { cn } from "@/lib/utils";
import { displayBranchName } from "@/lib/pharmacy-staff-api";
import {
  canViewAccessAudit,
  fetchDavomatMethodAccess,
  saveDavomatMethodAccess,
  saveDavomatMethodAccessBulk,
  saveZonePresence,
  unlockZonePresence,
  resetEmployeeFingerprint,
  type DavomatMethodAccessRow,
} from "@/lib/davomat-api";

type PlaceFilter = "all" | "ofis" | "dorixona";
type StateFilter = "all" | "open" | "limited" | "blocked" | "face_only" | "qr_only" | "zone" | "finger";
type Mode = Exclude<StateFilter, "all" | "limited" | "zone" | "finger">;

const PAGE = 24;

function foldScript(input: string): string {
  const cyr: Record<string, string> = {
    а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo", ж: "j", з: "z",
    и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
    с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sh",
    ъ: "", ы: "i", ь: "", э: "e", ю: "yu", я: "ya", ў: "o", ғ: "g", қ: "q", ҳ: "h",
  };
  let s = input.toLowerCase().replace(/[\u2018\u2019\u02BB\u02BC']/g, "'");
  s = s.replace(/g'/g, "g").replace(/o'/g, "o");
  let out = "";
  for (const ch of s) out += cyr[ch] ?? ch;
  return out.replace(/[^a-z0-9]+/g, "");
}

function matchesQuery(row: DavomatMethodAccessRow, query: string) {
  const words = query.trim().split(/\s+/).map(foldScript).filter(Boolean);
  if (!words.length) return true;
  const hay = foldScript(`${row.fullName} ${userRoleLabel(row.role)} ${row.position} ${row.location} ${row.role}`);
  return words.every((word) => hay.includes(word));
}

function positionOf(row: DavomatMethodAccessRow) {
  const raw = row.position.trim();
  if (raw && !/^(manager|pharmacist|intern|coordinator|employee)$/i.test(raw)) return raw;
  return userRoleLabel(row.role) || raw || "—";
}

function stateOf(row: DavomatMethodAccessRow): Mode {
  if (row.face && row.qr) return "open";
  if (!row.face && !row.qr) return "blocked";
  if (row.face && !row.qr) return "face_only";
  return "qr_only";
}

function matchesState(row: DavomatMethodAccessRow, filter: StateFilter) {
  if (filter === "all") return true;
  if (filter === "zone") return Boolean(row.zoneEnabled);
  if (filter === "finger") return Boolean(row.finger);
  if (filter === "limited") return !(row.face && row.qr);
  return stateOf(row) === filter;
}

function zoneLabel(row: DavomatMethodAccessRow) {
  if (!row.zoneEnabled) return "O‘chiq";
  const method = row.zoneMethod === "QR" ? "QR" : "Face ID";
  if (row.zoneStatus === "blocked") return `Bloklangan · ${method}`;
  if (row.zoneStatus === "due") return `Kutilmoqda · ${method}`;
  return `Har ${row.zoneIntervalHours || 2} soat · ${method}`;
}

const MODE_META: Record<Mode, { label: string; pill: string; bar: string; avatar: string }> = {
  open: { label: "To‘liq ochiq", pill: "bg-emerald-50 text-emerald-700 ring-emerald-200", bar: "bg-emerald-400", avatar: "from-emerald-500 to-teal-600" },
  face_only: { label: "Faqat Face ID", pill: "bg-sky-50 text-sky-700 ring-sky-200", bar: "bg-sky-400", avatar: "from-sky-500 to-blue-600" },
  qr_only: { label: "Faqat QR", pill: "bg-violet-50 text-violet-700 ring-violet-200", bar: "bg-violet-400", avatar: "from-violet-500 to-purple-600" },
  blocked: { label: "To‘liq yopiq", pill: "bg-rose-50 text-rose-700 ring-rose-200", bar: "bg-rose-500", avatar: "from-rose-500 to-red-600" },
};

function initialsOf(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

export default function DavomatBloklashPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const allowed = hasFullPlatformAccess(user?.role);
  const [rows, setRows] = useState<DavomatMethodAccessRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [place, setPlace] = useState<PlaceFilter>("all");
  const [state, setState] = useState<StateFilter>("all");
  const [position, setPosition] = useState("all");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<number[]>([]);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [ask, setAsk] = useState<{
    title: string;
    text: string;
    confirm: string;
    danger?: boolean;
    run: () => Promise<void>;
  } | null>(null);
  const [askBusy, setAskBusy] = useState(false);
  const [zoneRow, setZoneRow] = useState<DavomatMethodAccessRow | null>(null);
  const [zoneOn, setZoneOn] = useState(false);
  const [zoneHours, setZoneHours] = useState(2);
  const [zoneWindow, setZoneWindow] = useState(15);
  const [zoneMethod, setZoneMethod] = useState<"FACE_ID" | "QR">("FACE_ID");
  const [zoneBusy, setZoneBusy] = useState(false);
  const [canAudit, setCanAudit] = useState(false);
  const [tab, setTab] = useState<"xodimlar" | "unvonlar" | "tarix">("xodimlar");
  const isAdmin = normalizeUserRole(user?.role) === "admin";

  useEffect(() => {
    if (!allowed || user?.role !== "admin") return;
    let alive = true;
    canViewAccessAudit()
      .then((r) => { if (alive) setCanAudit(Boolean(r.allowed)); })
      .catch(() => { if (alive) setCanAudit(false); });
    return () => { alive = false; };
  }, [allowed, user?.role]);

  const openZone = (row: DavomatMethodAccessRow) => {
    setZoneRow(row);
    setZoneOn(Boolean(row.zoneEnabled));
    setZoneHours(row.zoneIntervalHours || 2);
    setZoneWindow(row.zoneWindowMinutes || 15);
    setZoneMethod(row.zoneMethod === "QR" ? "QR" : "FACE_ID");
  };

  const applyZone = (userId: number, zone: { enabled?: boolean; method?: "FACE_ID" | "QR" | null; intervalHours?: number | null; windowMinutes?: number | null; status?: DavomatMethodAccessRow["zoneStatus"] } | null | undefined) => {
    setRows((cur) => cur.map((row) => row.userId === userId ? {
      ...row,
      zoneEnabled: Boolean(zone?.enabled),
      zoneMethod: zone?.method === "QR" ? "QR" : "FACE_ID",
      zoneIntervalHours: zone?.intervalHours || row.zoneIntervalHours || 2,
      zoneWindowMinutes: zone?.windowMinutes || row.zoneWindowMinutes || 15,
      zoneStatus: zone?.status || (zone?.enabled ? "idle" : "off"),
    } : row));
  };

  const load = async () => {
    setLoading(true);
    try {
      const data = await fetchDavomatMethodAccess();
      setRows(data.items);
    } catch (err) {
      toast({ title: "Ro‘yxat yuklanmadi", description: (err as Error).message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (allowed) void load();
    else setLoading(false);
  }, [allowed]);

  const positions = useMemo(() => {
    const set = new Set<string>();
    for (const row of rows) set.add(positionOf(row));
    return [...set].sort((a, b) => a.localeCompare(b, "uz"));
  }, [rows]);

  const filtered = useMemo(() => {
    return rows.filter((row) => {
      if (place !== "all" && row.place !== place) return false;
      if (position !== "all" && positionOf(row) !== position) return false;
      if (!matchesState(row, state)) return false;
      return matchesQuery(row, q);
    });
  }, [rows, place, position, state, q]);

  useEffect(() => {
    setPage(1);
  }, [q, place, state, position]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const view = filtered.slice((page - 1) * PAGE, page * PAGE);
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const allViewSelected = view.length > 0 && view.every((row) => selectedSet.has(row.userId));
  const filtersActive = q.trim() !== "" || place !== "all" || state !== "all" || position !== "all";

  const counts = useMemo(() => {
    const base = rows.filter((row) => (place === "all" || row.place === place) && matchesQuery(row, q) && (position === "all" || positionOf(row) === position));
    return {
      all: base.length,
      open: base.filter((row) => row.face && row.qr).length,
      limited: base.filter((row) => !(row.face && row.qr)).length,
      blocked: base.filter((row) => !row.face && !row.qr).length,
      faceOnly: base.filter((row) => row.face && !row.qr).length,
      qrOnly: base.filter((row) => !row.face && row.qr).length,
      zone: base.filter((row) => row.zoneEnabled).length,
      finger: base.filter((row) => row.finger).length,
    };
  }, [rows, place, q, position]);

  const totals = useMemo(() => ({
    all: rows.length,
    ofis: rows.filter((row) => row.place === "ofis").length,
    dorixona: rows.filter((row) => row.place === "dorixona").length,
    limited: rows.filter((row) => !(row.face && row.qr)).length,
    finger: rows.filter((row) => row.finger).length,
    fingerEnrolled: rows.filter((row) => row.fingerEnrolled).length,
    zone: rows.filter((row) => row.zoneEnabled).length,
  }), [rows]);

  const applyLocal = (userIds: number[], patch: Partial<Pick<DavomatMethodAccessRow, "face" | "qr" | "finger" | "fingerEnrolled" | "fingerDevice" | "fingerEnrolledAt" | "fingerLastUsedAt">>) => {
    const set = new Set(userIds);
    setRows((cur) => cur.map((row) => (set.has(row.userId) ? { ...row, ...patch } : row)));
  };

  const toggle = async (row: DavomatMethodAccessRow, key: "face" | "qr" | "finger", next: boolean) => {
    setSavingId(row.userId);
    applyLocal([row.userId], { [key]: next });
    try {
      const saved = await saveDavomatMethodAccess({ userId: row.userId, [key]: next });
      applyLocal([row.userId], { face: saved.face, qr: saved.qr, finger: Boolean(saved.finger) });
      if (key === "finger") {
        toast({
          title: next ? "Barmoq izi yoqildi" : "Barmoq izi o‘chirildi",
          description: next
            ? `${row.fullName}: davomat oynasida «Barmoq izi» paydo bo‘ladi. Birinchi marta o‘z telefonidan ro‘yxatdan o‘tkazadi.`
            : `${row.fullName}: «Barmoq izi» xodimga endi ko‘rinmaydi.`,
        });
      }
    } catch (err) {
      applyLocal([row.userId], { face: row.face, qr: row.qr, finger: row.finger });
      toast({ title: "Saqlanmadi", description: (err as Error).message, variant: "destructive" });
    } finally {
      setSavingId(null);
    }
  };

  const setBoth = async (row: DavomatMethodAccessRow, on: boolean) => {
    setSavingId(row.userId);
    applyLocal([row.userId], { face: on, qr: on });
    try {
      const saved = await saveDavomatMethodAccess({ userId: row.userId, face: on, qr: on });
      applyLocal([row.userId], { face: saved.face, qr: saved.qr });
      toast({
        title: on ? "Qoldirildi" : "O‘chirildi",
        description: on
          ? `${row.fullName}: Face ID va QR yoqildi.`
          : `${row.fullName}: Face ID va QR o‘chirildi. Davomat qila olmaydi.`,
      });
    } catch (err) {
      applyLocal([row.userId], { face: row.face, qr: row.qr });
      toast({ title: "Saqlanmadi", description: (err as Error).message, variant: "destructive" });
    } finally {
      setSavingId(null);
    }
  };

  const askBoth = (row: DavomatMethodAccessRow, on: boolean) => {
    setAsk({
      title: on ? "Ikkalasini qoldirish" : "To‘liq o‘chirish",
      confirm: on ? "Ha, qoldirish" : "Ha, o‘chirish",
      danger: !on,
      text: on
        ? `${row.fullName} uchun Face ID ham, QR ham yoqiladi. Shu xodim ikkala usul bilan ham davomat qila oladi.`
        : `${row.fullName} uchun Face ID ham, QR ham o‘chiriladi. Davomat qila olmaydi. Keyin ruxsat berilmagan usulda «Aynan sizga ruxsat yo‘q» chiqadi.`,
      run: () => setBoth(row, on),
    });
  };

  const bulk = async (patch: { face?: boolean; qr?: boolean; finger?: boolean }, label: string) => {
    const ids = selected.filter((id) => filtered.some((row) => row.userId === id));
    if (!ids.length) return;
    const snapshot = rows.filter((row) => ids.includes(row.userId));
    setBulkBusy(true);
    applyLocal(ids, patch);
    try {
      await saveDavomatMethodAccessBulk({ userIds: ids, ...patch });
      toast({ title: label, description: `${ids.length} xodim yangilandi` });
      setSelected([]);
    } catch (err) {
      setRows((cur) => cur.map((row) => snapshot.find((item) => item.userId === row.userId) ?? row));
      toast({ title: "Saqlanmadi", description: (err as Error).message, variant: "destructive" });
    } finally {
      setBulkBusy(false);
    }
  };

  const askBulk = (patch: { face?: boolean; qr?: boolean; finger?: boolean }, title: string, text: string, confirm: string) => {
    const count = selected.filter((id) => filtered.some((row) => row.userId === id)).length;
    if (!count) return;
    setAsk({
      title,
      text: `${count} xodim. ${text}`,
      confirm,
      danger: patch.face === false || patch.finger === false,
      run: () => bulk(patch, title),
    });
  };

  const askResetFinger = (row: DavomatMethodAccessRow) => {
    setAsk({
      title: "Barmoq izini qayta tiklash",
      confirm: "Ha, o‘chirish",
      danger: true,
      text: `${row.fullName}ning ro‘yxatdagi barmoq izi${row.fingerDevice ? ` (${row.fingerDevice})` : ""} o‘chiriladi. Xodim yangi telefonidan qayta ro‘yxatdan o‘tkazadi. Eski qurilmada barmoq izi bilan davomat endi ishlamaydi.`,
      run: async () => {
        setSavingId(row.userId);
        try {
          await resetEmployeeFingerprint(row.userId);
          applyLocal([row.userId], { fingerEnrolled: false, fingerDevice: null, fingerEnrolledAt: null, fingerLastUsedAt: null });
          toast({ title: "Barmoq izi o‘chirildi", description: `${row.fullName} qayta ro‘yxatdan o‘tkaza oladi.` });
        } catch (err) {
          toast({ title: "O‘chirilmadi", description: (err as Error).message, variant: "destructive" });
        } finally {
          setSavingId(null);
        }
      },
    });
  };

  const confirmAsk = async () => {
    if (!ask) return;
    setAskBusy(true);
    try {
      await ask.run();
      setAsk(null);
    } finally {
      setAskBusy(false);
    }
  };

  const toggleSelect = (userId: number) =>
    setSelected((cur) => (cur.includes(userId) ? cur.filter((id) => id !== userId) : [...cur, userId]));

  const toggleViewSelection = () => {
    if (allViewSelected) setSelected((cur) => cur.filter((id) => !view.some((row) => row.userId === id)));
    else setSelected((cur) => [...new Set([...cur, ...view.map((row) => row.userId)])]);
  };

  const resetFilters = () => {
    setQ("");
    setPlace("all");
    setState("all");
    setPosition("all");
  };

  if (!allowed) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-50 text-rose-600">
          <ShieldAlert className="h-7 w-7" />
        </div>
        <p className="text-sm font-semibold text-rose-700">Bloklash oynasi faqat admin, direktor va asoschi uchun.</p>
        <Link href="/davomat" className="mt-3 inline-block text-sm font-semibold text-[#0b3a5c] underline">
          Davomat hisobotga qaytish
        </Link>
      </div>
    );
  }

  const stateItems: { id: StateFilter; label: string; count: number; icon: React.ReactNode; dot: string }[] = [
    { id: "all", label: "Barcha xodimlar", count: counts.all, icon: <Layers className="h-4 w-4" />, dot: "bg-slate-400" },
    { id: "open", label: "To‘liq ochiq", count: counts.open, icon: <ShieldCheck className="h-4 w-4" />, dot: "bg-emerald-500" },
    { id: "limited", label: "Cheklangan", count: counts.limited, icon: <ShieldAlert className="h-4 w-4" />, dot: "bg-amber-500" },
    { id: "blocked", label: "To‘liq yopiq", count: counts.blocked, icon: <ShieldOff className="h-4 w-4" />, dot: "bg-rose-500" },
    { id: "face_only", label: "Faqat Face ID", count: counts.faceOnly, icon: <ScanFace className="h-4 w-4" />, dot: "bg-sky-500" },
    { id: "qr_only", label: "Faqat QR", count: counts.qrOnly, icon: <QrCode className="h-4 w-4" />, dot: "bg-violet-500" },
    { id: "finger", label: "Barmoq izi yoqilgan", count: counts.finger, icon: <Fingerprint className="h-4 w-4" />, dot: "bg-teal-500" },
    { id: "zone", label: "Hudud tasdiqi", count: counts.zone, icon: <MapPin className="h-4 w-4" />, dot: "bg-lime-500" },
  ];

  return (
    <div className="mx-auto flex w-full max-w-[2200px] flex-col gap-5 pb-24">
      <section className="relative overflow-hidden rounded-[28px] bg-gradient-to-br from-[#081f36] via-[#0d3456] to-[#0a5560] px-5 py-6 text-white shadow-[0_20px_60px_-25px_rgba(8,31,54,0.65)] sm:px-8 sm:py-8">
        <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-teal-400/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 left-1/3 h-72 w-72 rounded-full bg-sky-400/10 blur-3xl" />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,rgba(255,255,255,0.06)_1px,transparent_0)] [background-size:22px_22px]" />

        <div className="relative flex flex-wrap items-start justify-between gap-5">
          <div className="min-w-0 max-w-2xl">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-teal-100 ring-1 ring-white/15">
              <ShieldCheck className="h-3.5 w-3.5" /> Davomat · Kirish nazorati
            </div>
            <h1 className="mt-3 text-2xl font-bold tracking-tight sm:text-[32px]">Bloklash oynasi</h1>
            <p className="mt-2 text-sm leading-relaxed text-slate-200/90">
              Har bir xodim uchun davomat usullarini alohida boshqaring: Face ID, QR va barmoq izi.
              Barmoq izi hammada yashirin — faqat shu yerda yoqilgan xodimga ko‘rinadi.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {canAudit || isAdmin ? (
              <div className="inline-flex rounded-2xl bg-white/10 p-1 ring-1 ring-white/15 backdrop-blur">
                <HeroTab active={tab === "xodimlar"} onClick={() => setTab("xodimlar")}>
                  <Users className="h-4 w-4" /> Xodimlar
                </HeroTab>
                {isAdmin ? (
                  <HeroTab active={tab === "unvonlar"} onClick={() => setTab("unvonlar")}>
                    <Award className="h-4 w-4" /> Unvon berish
                  </HeroTab>
                ) : null}
                {canAudit ? (
                  <HeroTab active={tab === "tarix"} onClick={() => setTab("tarix")}>
                    <History className="h-4 w-4" /> Tarix
                  </HeroTab>
                ) : null}
              </div>
            ) : null}
            {tab === "xodimlar" ? (
              <button
                type="button"
                onClick={() => void load()}
                disabled={loading}
                className="inline-flex h-10 items-center gap-2 rounded-2xl bg-white px-4 text-sm font-semibold text-[#0b2a46] shadow-sm transition hover:bg-teal-50 disabled:opacity-70"
              >
                <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
                Yangilash
              </button>
            ) : null}
          </div>
        </div>

        <div className={cn("relative mt-7 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6", tab === "unvonlar" && "hidden")}>
          <HeroStat icon={<Users className="h-4 w-4" />} label="Jami xodim" value={totals.all} />
          <HeroStat icon={<Building2 className="h-4 w-4" />} label="Ofis" value={totals.ofis} />
          <HeroStat icon={<Store className="h-4 w-4" />} label="Dorixona" value={totals.dorixona} />
          <HeroStat icon={<ShieldAlert className="h-4 w-4" />} label="Cheklangan" value={totals.limited} tone="rose" />
          <HeroStat icon={<Fingerprint className="h-4 w-4" />} label="Barmoq izi" value={totals.finger} sub={`${totals.fingerEnrolled} ro‘yxatda`} tone="teal" />
          <HeroStat icon={<MapPin className="h-4 w-4" />} label="Hudud tasdiqi" value={totals.zone} tone="lime" />
        </div>
      </section>

      {tab === "unvonlar" && isAdmin ? (
        <UnvonPanel />
      ) : tab === "tarix" && canAudit ? (
        <div className="rounded-[24px] border border-slate-200/80 bg-white p-4 shadow-sm sm:p-6">
          <BloklashTarix />
        </div>
      ) : (
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start">
          <aside className="w-full shrink-0 xl:sticky xl:top-4 xl:w-[300px]">
            <div className="rounded-[24px] border border-slate-200/80 bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between">
                <p className="flex items-center gap-2 text-sm font-bold text-[#0f2744]">
                  <SlidersHorizontal className="h-4 w-4 text-teal-600" /> Filtrlar
                </p>
                {filtersActive ? (
                  <button type="button" onClick={resetFilters} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold text-slate-500 hover:bg-slate-100">
                    <X className="h-3 w-3" /> Tozalash
                  </button>
                ) : null}
              </div>

              <div className="relative">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  value={q}
                  onChange={(event) => setQ(event.target.value)}
                  placeholder="Ism, lavozim, filial…"
                  className="h-11 rounded-2xl border-slate-200 bg-slate-50 pl-10 focus-visible:bg-white"
                />
              </div>

              <p className="mb-2 mt-5 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">Joy</p>
              <div className="grid grid-cols-3 gap-1 rounded-2xl bg-slate-100 p-1">
                <Segment active={place === "all"} onClick={() => setPlace("all")}>Hammasi</Segment>
                <Segment active={place === "ofis"} onClick={() => setPlace("ofis")}><Building2 className="h-3.5 w-3.5" /> Ofis</Segment>
                <Segment active={place === "dorixona"} onClick={() => setPlace("dorixona")}><Store className="h-3.5 w-3.5" /> Dorixona</Segment>
              </div>

              <p className="mb-2 mt-5 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">Holat</p>
              <div className="grid grid-cols-1 gap-1 sm:grid-cols-2 xl:grid-cols-1">
                {stateItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setState(item.id)}
                    className={cn(
                      "group flex items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition",
                      state === item.id
                        ? "bg-[#0b2a46] text-white shadow-md shadow-[#0b2a46]/20"
                        : "text-slate-600 hover:bg-slate-50",
                    )}
                  >
                    <span className={cn(
                      "flex h-7 w-7 items-center justify-center rounded-lg",
                      state === item.id ? "bg-white/15 text-white" : "bg-slate-100 text-slate-500 group-hover:bg-white",
                    )}>
                      {item.icon}
                    </span>
                    <span className="flex-1 truncate font-medium">{item.label}</span>
                    <span className={cn(
                      "min-w-[2rem] rounded-full px-2 py-0.5 text-center text-[11px] font-bold tabular-nums",
                      state === item.id ? "bg-white/15 text-white" : "bg-slate-100 text-slate-600",
                    )}>
                      {item.count}
                    </span>
                  </button>
                ))}
              </div>

              <p className="mb-2 mt-5 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">Lavozim</p>
              <select
                value={position}
                onChange={(event) => setPosition(event.target.value)}
                className="h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm font-medium text-slate-700 outline-none focus:border-teal-500 focus:bg-white"
              >
                <option value="all">Barcha lavozimlar</option>
                {positions.map((item) => (
                  <option key={item} value={item}>{item}</option>
                ))}
              </select>
            </div>

            <div className="mt-4 hidden rounded-[24px] border border-teal-100 bg-gradient-to-br from-teal-50 to-white p-4 text-xs leading-relaxed text-slate-600 xl:block">
              <p className="mb-2 flex items-center gap-2 text-sm font-bold text-teal-800">
                <Fingerprint className="h-4 w-4" /> Qoidalar
              </p>
              <ul className="space-y-1.5">
                <li>• Face ID va QR ikkalasi o‘chsa (barmoq izi yoqilmagan bo‘lsa), xodim davomat qila olmaydi.</li>
                <li>• Koordinator uchun QR standart holatda yopiq.</li>
                <li>• Barmoq izi: 1 xodim = 1 barmoq izi = 1 qurilma.</li>
                <li>• Telefon almashsa — <RotateCcw className="inline h-3 w-3" /> qayta tiklash, keyin xodim yangidan ro‘yxatdan o‘tadi.</li>
              </ul>
            </div>
          </aside>

          <main className="min-w-0 flex-1">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-[20px] border border-slate-200/80 bg-white px-4 py-3 shadow-sm">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={toggleViewSelection}
                  disabled={view.length === 0}
                  className={cn(
                    "inline-flex h-9 items-center gap-2 rounded-xl border px-3 text-xs font-semibold transition",
                    allViewSelected ? "border-[#0b2a46] bg-[#0b2a46] text-white" : "border-slate-200 text-slate-600 hover:bg-slate-50",
                  )}
                >
                  <span className={cn("flex h-4 w-4 items-center justify-center rounded border", allViewSelected ? "border-white bg-white text-[#0b2a46]" : "border-slate-300")}>
                    {allViewSelected ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
                  </span>
                  Sahifani tanlash
                </button>
                <p className="text-sm text-slate-500">
                  <span className="font-bold text-[#0f2744]">{filtered.length}</span> xodim
                  {selected.length ? <span className="ml-2 text-teal-700">· {selected.length} tanlandi</span> : null}
                </p>
              </div>
              <Pager page={page} pages={pages} onPage={setPage} />
            </div>

            {loading ? (
              <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(min(100%,340px),1fr))]">
                {Array.from({ length: 6 }, (_, i) => (
                  <div key={i} className="h-[300px] animate-pulse rounded-[24px] border border-slate-200 bg-white p-5">
                    <div className="flex items-center gap-3">
                      <div className="h-12 w-12 rounded-2xl bg-slate-100" />
                      <div className="flex-1 space-y-2">
                        <div className="h-3 w-2/3 rounded bg-slate-100" />
                        <div className="h-3 w-1/3 rounded bg-slate-100" />
                      </div>
                    </div>
                    <div className="mt-6 grid grid-cols-3 gap-2">
                      <div className="h-24 rounded-2xl bg-slate-100" />
                      <div className="h-24 rounded-2xl bg-slate-100" />
                      <div className="h-24 rounded-2xl bg-slate-100" />
                    </div>
                  </div>
                ))}
              </div>
            ) : view.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-[24px] border border-dashed border-slate-300 bg-white px-6 py-16 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
                  <Search className="h-6 w-6" />
                </div>
                <p className="mt-4 font-semibold text-[#0f2744]">Bu filtrda xodim topilmadi</p>
                <p className="mt-1 text-sm text-slate-500">Qidiruv yoki filtrlarni o‘zgartirib ko‘ring.</p>
                {filtersActive ? (
                  <Button type="button" variant="outline" className="mt-4 rounded-xl" onClick={resetFilters}>Filtrlarni tozalash</Button>
                ) : null}
              </div>
            ) : (
              <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(min(100%,340px),1fr))]">
                {view.map((row) => (
                  <EmployeeCard
                    key={row.userId}
                    row={row}
                    selected={selectedSet.has(row.userId)}
                    busy={savingId === row.userId || bulkBusy}
                    onSelect={() => toggleSelect(row.userId)}
                    onToggle={(key, on) => void toggle(row, key, on)}
                    onBoth={(on) => askBoth(row, on)}
                    onZone={() => openZone(row)}
                    onResetFinger={() => askResetFinger(row)}
                  />
                ))}
              </div>
            )}

            {pages > 1 && !loading ? (
              <div className="mt-5 flex justify-center">
                <Pager page={page} pages={pages} onPage={setPage} />
              </div>
            ) : null}

            {selected.length > 0 ? (
              <div className="sticky bottom-4 z-30 mt-5 flex justify-center">
                <div className="flex max-w-full items-center gap-2 overflow-x-auto rounded-[22px] bg-[#0b2a46]/95 p-2 pl-4 text-white shadow-[0_18px_50px_-12px_rgba(8,31,54,0.7)] ring-1 ring-white/10 backdrop-blur [scrollbar-width:none] [&>*]:shrink-0">
                  <span className="mr-1 flex items-center gap-2 whitespace-nowrap text-sm font-semibold">
                    <span className="flex h-7 min-w-[1.75rem] items-center justify-center rounded-full bg-teal-400 px-2 text-xs font-bold text-[#0b2a46]">{selected.length}</span>
                    tanlandi
                  </span>
                  <BulkButton disabled={bulkBusy} onClick={() => askBulk({ face: true, qr: true }, "Ikkalasini qoldirish", "Face ID ham, QR ham yoqiladi. Tanlangan xodimlar ikkala usul bilan davomat qila oladi.", "Ha, qoldirish")}>
                    <ShieldCheck className="h-3.5 w-3.5" /> Ikkalasi
                  </BulkButton>
                  <BulkButton disabled={bulkBusy} onClick={() => askBulk({ face: true, qr: false }, "Faqat Face ID", "QR o‘chiriladi, Face ID qoladi. QR bosilsa «Aynan sizga ruxsat yo‘q» chiqadi.", "Ha, faqat Face ID")}>
                    <ScanFace className="h-3.5 w-3.5" /> Faqat Face ID
                  </BulkButton>
                  <BulkButton disabled={bulkBusy} onClick={() => askBulk({ face: false, qr: true }, "Faqat QR", "Face ID o‘chiriladi, QR qoladi. Face ID bosilsa «Aynan sizga ruxsat yo‘q» chiqadi.", "Ha, faqat QR")}>
                    <QrCode className="h-3.5 w-3.5" /> Faqat QR
                  </BulkButton>
                  <BulkButton tone="danger" disabled={bulkBusy} onClick={() => askBulk({ face: false, qr: false }, "To‘liq o‘chirish", "Face ID ham, QR ham o‘chiriladi. Tanlangan xodimlar davomat qila olmaydi.", "Ha, o‘chirish")}>
                    <ShieldOff className="h-3.5 w-3.5" /> To‘liq o‘chirish
                  </BulkButton>
                  <span className="mx-1 hidden h-6 w-px bg-white/20 sm:block" />
                  <BulkButton tone="teal" disabled={bulkBusy} onClick={() => askBulk({ finger: true }, "Barmoq izini yoqish", "Davomat oynasida «Barmoq izi» paydo bo‘ladi. Har biri o‘z telefonidan bir marta ro‘yxatdan o‘tkazadi.", "Ha, yoqish")}>
                    <Fingerprint className="h-3.5 w-3.5" /> Barmoq izi yoqish
                  </BulkButton>
                  <BulkButton disabled={bulkBusy} onClick={() => askBulk({ finger: false }, "Barmoq izini o‘chirish", "«Barmoq izi» xodimlarga ko‘rinmaydi. Ro‘yxatdan o‘tgan barmoq izlari saqlanadi — qayta yoqilsa yana ishlaydi.", "Ha, o‘chirish")}>
                    <EyeOff className="h-3.5 w-3.5" /> Barmoq izi yashirish
                  </BulkButton>
                  <button
                    type="button"
                    onClick={() => setSelected([])}
                    title="Tanlovni bekor qilish"
                    className="ml-1 flex h-8 w-8 items-center justify-center rounded-xl text-white/70 hover:bg-white/10 hover:text-white"
                  >
                    {bulkBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            ) : null}
          </main>
        </div>
      )}

      <Dialog open={ask != null} onOpenChange={(open) => { if (!open && !askBusy) setAsk(null); }}>
        <DialogContent className="rounded-[24px] sm:max-w-md">
          <DialogHeader className="items-center text-center sm:text-center">
            <div className={cn(
              "mb-2 flex h-14 w-14 items-center justify-center rounded-2xl",
              ask?.danger ? "bg-rose-50 text-rose-600" : "bg-emerald-50 text-emerald-600",
            )}>
              {ask?.danger ? <ShieldOff className="h-7 w-7" /> : <ShieldCheck className="h-7 w-7" />}
            </div>
            <DialogTitle className="text-lg">{ask?.title}</DialogTitle>
            <DialogDescription className="leading-relaxed">{ask?.text}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:justify-center">
            <Button type="button" variant="outline" className="rounded-xl" disabled={askBusy} onClick={() => setAsk(null)}>Bekor qilish</Button>
            <Button type="button" className="rounded-xl" variant={ask?.danger ? "destructive" : "default"} disabled={askBusy} onClick={() => void confirmAsk()}>
              {askBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {ask?.confirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={zoneRow != null} onOpenChange={(open) => { if (!open && !zoneBusy) setZoneRow(null); }}>
        <DialogContent className="rounded-[24px] sm:max-w-md">
          <DialogHeader>
            <div className="mb-1 flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-lime-50 text-lime-700">
                <MapPin className="h-5 w-5" />
              </div>
              <div className="min-w-0 text-left">
                <DialogTitle>Yashil hudud tasdiqi</DialogTitle>
                <p className="truncate text-sm font-medium text-slate-500">{zoneRow?.fullName}</p>
              </div>
            </div>
            <DialogDescription className="text-left leading-relaxed">
              Rejim o‘chiq tursa, hech narsa so‘ralmaydi. Yoqilsa, Keldimdan keyin har belgilangan soatda yashil hudud ichida tasdiqlashi shart.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 text-sm">
            <label className={cn(
              "flex cursor-pointer items-center justify-between gap-3 rounded-2xl border px-4 py-3 transition",
              zoneOn ? "border-lime-300 bg-lime-50/60" : "border-slate-200",
            )}>
              <span>
                <span className="block font-semibold text-[#0f2744]">Shu xodimga yoqish</span>
                <span className="text-xs text-slate-500">{zoneOn ? "Hudud tasdiqi talab qilinadi" : "Hech narsa so‘ralmaydi"}</span>
              </span>
              <Switch checked={zoneOn} onCheckedChange={setZoneOn} />
            </label>
            <div className={cn("grid grid-cols-2 gap-3 transition", !zoneOn && "pointer-events-none opacity-50")}>
              <label className="block rounded-2xl border border-slate-200 p-3">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Har necha soatda</span>
                <Input type="number" min={1} max={12} value={zoneHours} onChange={(event) => setZoneHours(Number(event.target.value))} className="mt-1 h-10 rounded-xl text-base font-semibold" />
              </label>
              <label className="block rounded-2xl border border-slate-200 p-3">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Oyna, daqiqa</span>
                <Input type="number" min={5} max={120} value={zoneWindow} onChange={(event) => setZoneWindow(Number(event.target.value))} className="mt-1 h-10 rounded-xl text-base font-semibold" />
              </label>
            </div>
            <div className={cn("grid grid-cols-2 gap-1 rounded-2xl bg-slate-100 p-1", !zoneOn && "pointer-events-none opacity-50")}>
              <Segment active={zoneMethod === "FACE_ID"} onClick={() => setZoneMethod("FACE_ID")}><ScanFace className="h-4 w-4" /> Face ID</Segment>
              <Segment active={zoneMethod === "QR"} onClick={() => setZoneMethod("QR")}><QrCode className="h-4 w-4" /> QR kod</Segment>
            </div>
            {zoneRow?.zoneStatus === "blocked" ? (
              <p className="rounded-2xl bg-rose-50 px-4 py-3 text-xs leading-relaxed text-rose-800">
                Bugun bloklangan. Ruxsat bersangiz, shu kun ochiladi va tasdiq yangidan hisoblanadi.
              </p>
            ) : null}
          </div>
          <DialogFooter className="gap-2">
            {zoneRow?.zoneStatus === "blocked" ? (
              <Button
                type="button"
                variant="outline"
                className="rounded-xl"
                disabled={zoneBusy}
                onClick={() => {
                  if (!zoneRow) return;
                  setZoneBusy(true);
                  void unlockZonePresence(zoneRow.userId)
                    .then((saved) => {
                      applyZone(zoneRow.userId, saved.zone);
                      toast({ title: "Ruxsat berildi", description: "Keldim va Ketdim yana ochiq." });
                      setZoneRow(null);
                    })
                    .catch((err) => toast({ title: "Ruxsat berilmadi", description: (err as Error).message, variant: "destructive" }))
                    .finally(() => setZoneBusy(false));
                }}
              >
                Ruxsat berish
              </Button>
            ) : null}
            <Button type="button" variant="outline" className="rounded-xl" disabled={zoneBusy} onClick={() => setZoneRow(null)}>Bekor</Button>
            <Button
              type="button"
              className="rounded-xl"
              disabled={zoneBusy || !zoneRow}
              onClick={() => {
                if (!zoneRow) return;
                setZoneBusy(true);
                void saveZonePresence({
                  userId: zoneRow.userId,
                  enabled: zoneOn,
                  intervalHours: zoneHours,
                  windowMinutes: zoneWindow,
                  method: zoneMethod,
                })
                  .then((saved) => {
                    applyZone(zoneRow.userId, saved.zone);
                    toast({ title: zoneOn ? "Hudud tasdiqi yoqildi" : "Hudud tasdiqi o‘chirildi" });
                    setZoneRow(null);
                  })
                  .catch((err) => toast({ title: "Saqlanmadi", description: (err as Error).message, variant: "destructive" }))
                  .finally(() => setZoneBusy(false));
              }}
            >
              {zoneBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Saqlash
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EmployeeCard({
  row,
  selected,
  busy,
  onSelect,
  onToggle,
  onBoth,
  onZone,
  onResetFinger,
}: {
  row: DavomatMethodAccessRow;
  selected: boolean;
  busy: boolean;
  onSelect: () => void;
  onToggle: (key: "face" | "qr" | "finger", on: boolean) => void;
  onBoth: (on: boolean) => void;
  onZone: () => void;
  onResetFinger: () => void;
}) {
  const mode = stateOf(row);
  const meta = MODE_META[mode];
  const zoneTone =
    row.zoneStatus === "blocked" ? "text-rose-700 bg-rose-50"
    : row.zoneStatus === "due" ? "text-amber-700 bg-amber-50"
    : row.zoneEnabled ? "text-lime-800 bg-lime-50"
    : "text-slate-500 bg-slate-100";

  return (
    <article
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-[24px] border bg-white shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_14px_40px_-18px_rgba(15,39,68,0.35)]",
        selected ? "border-[#0b2a46] ring-2 ring-[#0b2a46]/15" : "border-slate-200/80",
      )}
    >
      <span className={cn("absolute inset-y-0 left-0 w-1", meta.bar)} />

      <header className="flex items-start gap-3 px-5 pb-3 pt-5">
        <button
          type="button"
          onClick={onSelect}
          aria-label="Tanlash"
          className={cn(
            "relative flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br text-sm font-bold text-white shadow-sm transition",
            meta.avatar,
          )}
        >
          {selected ? <Check className="h-5 w-5" strokeWidth={3} /> : initialsOf(row.fullName)}
          <span className={cn(
            "absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full border-2 border-white text-white transition",
            selected ? "bg-[#0b2a46] opacity-100" : "bg-slate-300 opacity-0 group-hover:opacity-100",
          )}>
            <Check className="h-2.5 w-2.5" strokeWidth={4} />
          </span>
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-bold leading-tight text-[#0f2744]" title={row.fullName}>{row.fullName}</p>
          <p className="mt-1 truncate text-xs text-slate-500" title={positionOf(row)}>
            {positionOf(row)}
            {row.location ? <span className="text-slate-400"> · {displayBranchName(row.location)}</span> : null}
          </p>
        </div>
        <span className={cn("shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ring-1", meta.pill)}>
          {meta.label}
        </span>
      </header>

      <div className="mx-5 flex items-center gap-2 rounded-2xl bg-slate-50 px-3 py-2 text-xs">
        <span className="inline-flex items-center gap-1.5 font-semibold text-slate-600">
          {row.place === "dorixona" ? <Store className="h-3.5 w-3.5 text-teal-600" /> : <Building2 className="h-3.5 w-3.5 text-sky-600" />}
          {row.place === "dorixona" ? "Dorixona" : "Ofis"}
        </span>
        <span className="h-3.5 w-px bg-slate-200" />
        <span className="inline-flex min-w-0 items-center gap-1.5 text-slate-600">
          <Clock3 className="h-3.5 w-3.5 shrink-0 text-slate-400" />
          <span className="font-bold tabular-nums text-[#0f2744]">{row.scheduleHours || "—"}</span>
          <span className="truncate text-slate-400">{row.scheduleLabel || (row.place === "dorixona" ? "Smena" : "Ofis")}</span>
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2 px-5 pt-4">
        <MethodTile
          icon={<ScanFace className="h-[18px] w-[18px]" />}
          label="Face ID"
          on={row.face}
          tone="sky"
          disabled={busy}
          onChange={(on) => onToggle("face", on)}
        />
        <MethodTile
          icon={<QrCode className="h-[18px] w-[18px]" />}
          label="QR kod"
          on={row.qr}
          tone="violet"
          disabled={busy}
          onChange={(on) => onToggle("qr", on)}
        />
        <MethodTile
          icon={<Fingerprint className="h-[18px] w-[18px]" />}
          label="Barmoq izi"
          on={Boolean(row.finger)}
          offText="Yashirin"
          tone="teal"
          disabled={busy}
          onChange={(on) => onToggle("finger", on)}
        />
      </div>

      {row.finger || row.fingerEnrolled ? (
        <div className={cn(
          "mx-5 mt-2 flex items-center gap-2 rounded-xl px-3 py-1.5 text-[11px]",
          row.fingerEnrolled ? "bg-teal-50 text-teal-800" : "bg-amber-50 text-amber-800",
        )}>
          <Fingerprint className="h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate" title={row.fingerDevice || undefined}>
            {row.fingerEnrolled ? <>Ro‘yxatda · <b>{row.fingerDevice || "qurilma"}</b></> : "Hali ro‘yxatdan o‘tmagan"}
          </span>
          {row.fingerEnrolled ? (
            <button
              type="button"
              disabled={busy}
              onClick={onResetFinger}
              title="Barmoq izini o‘chirish (qayta ro‘yxatdan o‘tkazish uchun)"
              className="inline-flex shrink-0 items-center gap-1 rounded-lg px-1.5 py-0.5 font-semibold text-teal-700 hover:bg-white hover:text-rose-600"
            >
              <RotateCcw className="h-3 w-3" /> Tiklash
            </button>
          ) : null}
        </div>
      ) : null}

      <button
        type="button"
        onClick={onZone}
        className="mx-5 mt-2 flex items-center gap-2 rounded-xl border border-dashed border-slate-200 px-3 py-2 text-left text-xs transition hover:border-lime-300 hover:bg-lime-50/40"
      >
        <MapPin className="h-3.5 w-3.5 shrink-0 text-lime-600" />
        <span className="font-semibold text-slate-600">Yashil hudud</span>
        <span className={cn("ml-auto rounded-full px-2 py-0.5 text-[11px] font-bold", zoneTone)}>{zoneLabel(row)}</span>
        <ChevronRight className="h-3.5 w-3.5 text-slate-300" />
      </button>

      <footer className="mt-auto grid grid-cols-2 gap-2 px-5 pb-5 pt-4">
        <button
          type="button"
          disabled={busy || mode === "open"}
          onClick={() => onBoth(true)}
          className="inline-flex h-9 items-center justify-center gap-1.5 rounded-xl bg-[#0b2a46] text-xs font-semibold text-white transition hover:bg-[#0d3456] disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
        >
          <ShieldCheck className="h-3.5 w-3.5" /> Qoldirish
        </button>
        <button
          type="button"
          disabled={busy || mode === "blocked"}
          onClick={() => onBoth(false)}
          className="inline-flex h-9 items-center justify-center gap-1.5 rounded-xl border border-rose-200 text-xs font-semibold text-rose-600 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:border-slate-100 disabled:text-slate-300"
        >
          <ShieldOff className="h-3.5 w-3.5" /> O‘chirish
        </button>
      </footer>
    </article>
  );
}

const TILE_TONES = {
  sky: { on: "border-sky-200 bg-gradient-to-br from-sky-50 to-white", icon: "bg-sky-500 text-white shadow-sky-500/30", text: "text-sky-700" },
  violet: { on: "border-violet-200 bg-gradient-to-br from-violet-50 to-white", icon: "bg-violet-500 text-white shadow-violet-500/30", text: "text-violet-700" },
  teal: { on: "border-teal-200 bg-gradient-to-br from-teal-50 to-white", icon: "bg-teal-500 text-white shadow-teal-500/30", text: "text-teal-700" },
} as const;

function MethodTile({
  icon,
  label,
  on,
  offText = "O‘chiq",
  tone,
  disabled,
  onChange,
}: {
  icon: React.ReactNode;
  label: string;
  on: boolean;
  offText?: string;
  tone: keyof typeof TILE_TONES;
  disabled?: boolean;
  onChange: (on: boolean) => void;
}) {
  const t = TILE_TONES[tone];
  return (
    <div className={cn(
      "flex flex-col gap-2 rounded-2xl border p-2.5 transition",
      on ? t.on : "border-slate-200 bg-slate-50/60",
    )}>
      <div className="flex items-center justify-between gap-1">
        <span className={cn(
          "flex h-8 w-8 items-center justify-center rounded-xl shadow-sm transition",
          on ? cn(t.icon, "shadow-md") : "bg-white text-slate-400",
        )}>
          {icon}
        </span>
        <Switch checked={on} disabled={disabled} onCheckedChange={onChange} className="scale-90" />
      </div>
      <div className="min-w-0">
        <p className="truncate text-xs font-bold text-[#0f2744]">{label}</p>
        <p className={cn("text-[11px] font-semibold", on ? t.text : "text-slate-400")}>{on ? "Yoqilgan" : offText}</p>
      </div>
    </div>
  );
}

function HeroStat({ icon, label, value, sub, tone }: { icon: React.ReactNode; label: string; value: number; sub?: string; tone?: "rose" | "teal" | "lime" }) {
  return (
    <div className="rounded-2xl bg-white/[0.07] p-3.5 ring-1 ring-white/10 backdrop-blur-sm transition hover:bg-white/[0.11]">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-slate-300">
        <span className={cn(
          "flex h-7 w-7 items-center justify-center rounded-lg",
          tone === "rose" ? "bg-rose-400/20 text-rose-200"
          : tone === "teal" ? "bg-teal-400/20 text-teal-200"
          : tone === "lime" ? "bg-lime-400/20 text-lime-200"
          : "bg-white/10 text-white",
        )}>
          {icon}
        </span>
        <span className="truncate">{label}</span>
      </div>
      <p className={cn("mt-2 text-2xl font-bold tabular-nums tracking-tight", tone === "rose" ? "text-rose-200" : "text-white")}>{value}</p>
      {sub ? <p className="text-[11px] text-slate-300">{sub}</p> : null}
    </div>
  );
}

function HeroTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold transition",
        active ? "bg-white text-[#0b2a46] shadow-sm" : "text-white/80 hover:bg-white/10 hover:text-white",
      )}
    >
      {children}
    </button>
  );
}

function Segment({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-9 items-center justify-center gap-1.5 rounded-xl px-2 text-xs font-semibold transition",
        active ? "bg-white text-[#0b2a46] shadow-sm" : "text-slate-500 hover:text-slate-700",
      )}
    >
      {children}
    </button>
  );
}

function BulkButton({ tone, disabled, onClick, children }: { tone?: "danger" | "teal"; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-xl px-3 text-xs font-semibold transition disabled:opacity-50",
        tone === "danger" ? "bg-rose-500 text-white hover:bg-rose-600"
        : tone === "teal" ? "bg-teal-400 text-[#0b2a46] hover:bg-teal-300"
        : "bg-white/10 text-white hover:bg-white/20",
      )}
    >
      {children}
    </button>
  );
}

function Pager({ page, pages, onPage }: { page: number; pages: number; onPage: (n: number) => void }) {
  return (
    <div className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white p-1">
      <button
        type="button"
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
        className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-30"
        aria-label="Oldingi"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      <span className="min-w-[3.5rem] text-center text-xs font-bold tabular-nums text-[#0f2744]">{page} / {pages}</span>
      <button
        type="button"
        disabled={page >= pages}
        onClick={() => onPage(page + 1)}
        className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-30"
        aria-label="Keyingi"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}
