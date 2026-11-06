import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  canManageMalumotnoma,
  downloadMalumotnomaPdf,
  useCancelMalumotnoma,
  useCreateMalumotnoma,
  useDeleteMalumotnoma,
  useMalumotnomaList,
  useMalumotnomaSettings,
  useMalumotnomaStaff,
  useSaveMalumotnomaSettings,
  type MalumotnomaStaff,
} from "@/lib/malumotnoma-api";
import {
  Building2,
  Clock3,
  Download,
  Eye,
  FileBadge2,
  Loader2,
  MapPin,
  Search,
  Settings2,
  Trash2,
  UserRound,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { displayBranchName } from "@/lib/pharmacy-staff-api";

function branchLabel(raw?: string | null) {
  const name = displayBranchName(raw).trim();
  return name || "—";
}

export default function AdminMalumotnomaPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const allowed = canManageMalumotnoma(user?.role);
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<MalumotnomaStaff | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const staffQ = useMalumotnomaStaff(q, allowed && q.trim().length >= 1);
  const listQ = useMalumotnomaList(allowed);
  const settingsQ = useMalumotnomaSettings(allowed);
  const saveSettings = useSaveMalumotnomaSettings();
  const create = useCreateMalumotnoma();
  const cancelMut = useCancelMalumotnoma();
  const deleteMut = useDeleteMalumotnoma();
  const [companyName, setCompanyName] = useState("");
  const [directorTitle, setDirectorTitle] = useState("");
  const [directorName, setDirectorName] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);

  const items = staffQ.data?.items ?? [];
  const recent = listQ.data?.items ?? [];

  useEffect(() => {
    if (!settingsQ.data) return;
    setCompanyName(settingsQ.data.companyName);
    setDirectorTitle(settingsQ.data.directorTitle);
    setDirectorName(settingsQ.data.directorName);
  }, [settingsQ.data]);

  if (!allowed) {
    return (
      <div className="mx-auto max-w-lg rounded-2xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
        Ma’lumotnoma bo‘limi faqat admin va HR uchun.
      </div>
    );
  }

  const make = async () => {
    if (!picked) {
      toast({ title: "Xodimni tanlang", variant: "destructive" });
      return;
    }
    try {
      const row = await create.mutateAsync(picked.employeeId);
      toast({ title: "Ma’lumotnoma yaratildi", description: row.docNo });
      await downloadMalumotnomaPdf(row.id, row.fullName);
    } catch (e: any) {
      toast({ title: "Xato", description: e.message, variant: "destructive" });
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-5 pb-10">
      <div className="overflow-hidden rounded-3xl border border-border bg-gradient-to-br from-[#4A1C6A] via-[#5B2A7A] to-slate-900 text-white shadow-lg">
        <div className="flex flex-wrap items-start justify-between gap-4 px-5 py-6 sm:px-7">
          <div className="flex items-start gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/10 ring-1 ring-white/20">
              <FileBadge2 className="h-6 w-6 text-amber-300" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Ma’lumotnoma</h1>
              <p className="mt-1 max-w-xl text-sm text-white/75">
                Xodimni tanlang — 1 varaqli A4 PDF: VAKSINA MED logo, filial, lavozim, smena va QR tekshiruv.
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="secondary"
            className="gap-2 rounded-xl bg-white/95 text-[#4A1C6A] hover:bg-white"
            onClick={() => setSettingsOpen((v) => !v)}
          >
            <Settings2 className="h-4 w-4" />
            Shapka sozlamasi
          </Button>
        </div>
      </div>

      {settingsOpen ? (
        <div className="rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-5">
          <p className="mb-3 text-sm font-semibold text-foreground">Kompaniya shapkasi (PDF yuqorisi va imzo)</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="space-y-1.5 text-sm">
              <span className="text-muted-foreground">Kompaniya nomi</span>
              <Input value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
            </label>
            <label className="space-y-1.5 text-sm">
              <span className="text-muted-foreground">Rahbar lavozimi</span>
              <Input value={directorTitle} onChange={(e) => setDirectorTitle(e.target.value)} />
            </label>
            <label className="space-y-1.5 text-sm">
              <span className="text-muted-foreground">Direktor F.I.Sh.</span>
              <Input value={directorName} onChange={(e) => setDirectorName(e.target.value)} />
            </label>
          </div>
          <div className="mt-3 flex justify-end">
            <Button
              type="button"
              className="rounded-xl bg-[#4A1C6A] hover:bg-[#3a1554]"
              disabled={saveSettings.isPending}
              onClick={async () => {
                try {
                  await saveSettings.mutateAsync({ companyName, directorTitle, directorName });
                  toast({ title: "Saqlandi" });
                } catch (e: any) {
                  toast({ title: "Xato", description: e.message, variant: "destructive" });
                }
              }}
            >
              Saqlash
            </Button>
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-5">
          <p className="mb-3 text-sm font-semibold text-foreground">Xodimni qidirish</p>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Ism, filial yoki lavozim…"
              className="h-11 rounded-xl pl-10"
            />
          </div>
          <div className="mt-3 max-h-72 space-y-1.5 overflow-y-auto">
            {staffQ.isFetching ? (
              <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Qidirilmoqda…
              </p>
            ) : !q.trim() ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Qidiruvga kamida 1 belgi yozing</p>
            ) : !items.length ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Xodim topilmadi</p>
            ) : (
              items.map((s) => (
                <button
                  key={s.employeeId}
                  type="button"
                  onClick={() => setPicked(s)}
                  className={cn(
                    "flex w-full items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition",
                    picked?.employeeId === s.employeeId
                      ? "border-[#4A1C6A]/70 bg-[#4A1C6A]/5 ring-1 ring-[#4A1C6A]/30"
                      : "border-border hover:bg-muted/40",
                  )}
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#4A1C6A] text-xs font-bold text-white">
                    {s.fullName
                      .split(/\s+/)
                      .slice(0, 2)
                      .map((p) => p[0])
                      .join("")
                      .toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-foreground">{s.fullName}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {s.position} · {branchLabel(s.branch)}
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {s.shiftLabel}: {s.workStart}–{s.workEnd}
                    </p>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-5">
          <p className="mb-3 text-sm font-semibold text-foreground">Tanlangan xodim</p>
          {!picked ? (
            <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
              <UserRound className="h-8 w-8 opacity-50" />
              Chapdan xodim tanlang
            </div>
          ) : (
            <div className="space-y-3">
              <div className="rounded-2xl bg-gradient-to-br from-[#4A1C6A]/10 to-amber-50 p-4 dark:to-amber-500/5">
                <p className="text-lg font-bold text-foreground">{picked.fullName}</p>
                <ul className="mt-3 space-y-2 text-sm">
                  <li className="flex items-center gap-2 text-foreground/90">
                    <Building2 className="h-4 w-4 text-[#4A1C6A]" />
                    {picked.position}
                  </li>
                  <li className="flex items-center gap-2 text-foreground/90">
                    <MapPin className="h-4 w-4 text-[#4A1C6A]" />
                    {branchLabel(picked.branch)}
                  </li>
                  <li className="flex items-center gap-2 text-foreground/90">
                    <Clock3 className="h-4 w-4 text-[#4A1C6A]" />
                    {picked.shiftLabel}: {picked.workStart}–{picked.workEnd}
                  </li>
                </ul>
              </div>
              <Button
                type="button"
                className="h-11 w-full gap-2 rounded-xl bg-[#4A1C6A] text-sm font-semibold hover:bg-[#3a1554]"
                disabled={create.isPending}
                onClick={make}
              >
                {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileBadge2 className="h-4 w-4" />}
                Ma’lumotnoma yaratish (PDF)
              </Button>
              <p className="text-center text-[11px] text-muted-foreground">
                PDF da logo, shapka, matn, QR va direktor imzo joyi bo‘ladi
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-5">
        <p className="mb-3 text-sm font-semibold text-foreground">So‘nggi yaratilganlar</p>
        {listQ.isLoading ? (
          <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Yuklanmoqda…
          </p>
        ) : !recent.length ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Hali ma’lumotnoma yaratilmagan</p>
        ) : (
          <ul className="divide-y divide-border">
            {recent.map((r) => {
              const cancelled = r.status === "cancelled";
              const acting = busyId === r.id || cancelMut.isPending || deleteMut.isPending;
              return (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className={cn("truncate text-sm font-semibold", cancelled ? "text-muted-foreground line-through" : "text-foreground")}>
                        {r.fullName}
                      </p>
                      {cancelled ? (
                        <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-700 ring-1 ring-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:ring-rose-500/30">
                          Bekor qilingan
                        </span>
                      ) : (
                        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/30">
                          Faol
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {r.docNo} · {r.position} · {branchLabel(r.branch)} · {r.issuedAtLabel}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="gap-1.5 rounded-xl"
                      onClick={() => window.open(r.pdfUrl, "_blank")}
                    >
                      <Eye className="h-3.5 w-3.5" />
                      Ko‘rish
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      className="gap-1.5 rounded-xl bg-[#4A1C6A] hover:bg-[#3a1554]"
                      disabled={acting}
                      onClick={async () => {
                        setBusyId(r.id);
                        try {
                          await downloadMalumotnomaPdf(r.id, r.fullName);
                        } catch (e: any) {
                          toast({ title: "Xato", description: e.message, variant: "destructive" });
                        } finally {
                          setBusyId(null);
                        }
                      }}
                    >
                      {busyId === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                      PDF
                    </Button>
                    {!cancelled ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="gap-1.5 rounded-xl border-amber-300 text-amber-800 hover:bg-amber-50 dark:border-amber-500/40 dark:text-amber-200 dark:hover:bg-amber-500/10"
                        disabled={acting}
                        onClick={async () => {
                          if (!confirm(`${r.fullName} ma’lumotnomasini bekor qilasizmi? QR endi haqiqiy bo‘lmaydi.`)) return;
                          try {
                            await cancelMut.mutateAsync(r.id);
                            toast({ title: "Bekor qilindi" });
                          } catch (e: any) {
                            toast({ title: "Xato", description: e.message, variant: "destructive" });
                          }
                        }}
                      >
                        <XCircle className="h-3.5 w-3.5" />
                        Bekor qilish
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="gap-1.5 rounded-xl border-rose-200 text-rose-600 hover:bg-rose-50 dark:border-rose-500/30 dark:hover:bg-rose-500/10"
                      disabled={acting}
                      onClick={async () => {
                        if (!confirm(`${r.fullName} — ${r.docNo} ni butunlay o‘chirasizmi?`)) return;
                        try {
                          await deleteMut.mutateAsync(r.id);
                          toast({ title: "O‘chirildi" });
                        } catch (e: any) {
                          toast({ title: "Xato", description: e.message, variant: "destructive" });
                        }
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      O‘chirish
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
