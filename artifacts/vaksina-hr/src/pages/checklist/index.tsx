import React, { useMemo, useState } from "react";
import {
  ClipboardCheck,
  CalendarDays,
  Store,
  User,
  RotateCcw,
  Check,
  X,
  Save,
  FolderOpen,
  TrendingUp,
  History,
  Trash2,
  Info,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import {
  createEmptyAuditTemplate,
  scoreFromCategories,
  useAuditBranches,
  useBranchAudits,
  useCreateBranchAudit,
  useDeleteBranchAudit,
  type AuditAnswer,
  type AuditCategory,
  type BranchAudit,
} from "@/lib/branch-audits-api";

const VISIT_NAMES = [
  { value: "1-tashrif", label: "1-tashrif" },
  { value: "2-tashrif", label: "2-tashrif" },
  { value: "3-tashrif", label: "3-tashrif" },
  { value: "nazorat", label: "Nazorat tashrifi" },
  { value: "qayta-tekshiruv", label: "Qayta tekshiruv" },
];

const MONTHS = [
  "Yanvar",
  "Fevral",
  "Mart",
  "Aprel",
  "May",
  "Iyun",
  "Iyul",
  "Avgust",
  "Sentabr",
  "Oktabr",
  "Noyabr",
  "Dekabr",
];

function todayIso() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function currentMonthLabel() {
  return MONTHS[new Date().getMonth()];
}

function scoreTone(pct: number) {
  if (pct >= 85) return "text-emerald-600";
  if (pct >= 70) return "text-amber-600";
  return "text-rose-600";
}

function scoreBar(pct: number) {
  if (pct >= 85) return "bg-emerald-500";
  if (pct >= 70) return "bg-amber-500";
  return "bg-rose-500";
}

export default function ChecklistPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { data: branches = [], isLoading: branchesLoading } = useAuditBranches();
  const { data: history = [], isLoading: historyLoading } = useBranchAudits();
  const createAudit = useCreateBranchAudit();
  const deleteAudit = useDeleteBranchAudit();

  const [managerId, setManagerId] = useState<string>("");
  const [visitDate, setVisitDate] = useState(todayIso());
  const [visitName, setVisitName] = useState("1-tashrif");
  const [monthLabel, setMonthLabel] = useState(currentMonthLabel());
  const [generalNote, setGeneralNote] = useState("");
  const [categories, setCategories] = useState<AuditCategory[]>(() =>
    createEmptyAuditTemplate(),
  );
  const [historyOpen, setHistoryOpen] = useState(false);
  const [viewing, setViewing] = useState<BranchAudit | null>(null);

  const selectedBranch = useMemo(
    () => branches.find((b) => String(b.id) === managerId) || null,
    [branches, managerId],
  );

  const live = useMemo(() => scoreFromCategories(categories), [categories]);

  const canWrite = user?.role === "koordinator" || user?.role === "admin";

  function setAnswer(catId: string, itemId: string, answer: AuditAnswer) {
    setCategories((prev) =>
      prev.map((cat) =>
        cat.id !== catId
          ? cat
          : {
              ...cat,
              items: cat.items.map((it) =>
                it.id !== itemId
                  ? it
                  : {
                      ...it,
                      // Qayta bosilsa — tanlov bekor (null)
                      answer: it.answer === answer ? null : answer,
                      note: answer === "yes" ? null : it.note,
                    },
              ),
            },
      ),
    );
  }

  function setItemNote(catId: string, itemId: string, note: string) {
    setCategories((prev) =>
      prev.map((cat) =>
        cat.id !== catId
          ? cat
          : {
              ...cat,
              items: cat.items.map((it) =>
                it.id !== itemId ? it : { ...it, note },
              ),
            },
      ),
    );
  }

  function markAllYes() {
    setCategories((prev) =>
      prev.map((cat) => ({
        ...cat,
        items: cat.items.map((it) => ({ ...it, answer: "yes" as const, note: null })),
      })),
    );
  }

  function clearAnswers() {
    setCategories(createEmptyAuditTemplate());
    setGeneralNote("");
  }

  function resetForm() {
    setManagerId("");
    setVisitDate(todayIso());
    setVisitName("1-tashrif");
    setMonthLabel(currentMonthLabel());
    setGeneralNote("");
    setCategories(createEmptyAuditTemplate());
  }

  async function handleSave() {
    if (!canWrite) {
      toast({ title: "Ruxsat yo‘q", variant: "destructive" });
      return;
    }
    if (!managerId) {
      toast({ title: "Filialni tanlang", variant: "destructive" });
      return;
    }
    if (!visitDate) {
      toast({ title: "Sanani belgilang", variant: "destructive" });
      return;
    }
    if (live.answered === 0) {
      toast({
        title: "Javob belgilang",
        description: "Kamida bitta talabga Ha yoki Yo‘q tanlang",
        variant: "destructive",
      });
      return;
    }

    try {
      await createAudit.mutateAsync({
        managerEmployeeId: parseInt(managerId, 10),
        visitDate,
        visitName,
        monthLabel,
        generalNote: generalNote.trim() || null,
        categories,
      });
      toast({
        title: "Cheklist saqlandi",
        description: `Umumiy ball: ${live.scorePercent}% (${live.yes} Ha / ${live.no} Yo‘q)`,
      });
      resetForm();
    } catch (e: any) {
      toast({
        title: "Saqlanmadi",
        description: e?.message || "Xato",
        variant: "destructive",
      });
    }
  }

  if (user?.role !== "koordinator" && user?.role !== "admin") {
    return (
      <div className="rounded-2xl border bg-white p-8 text-center shadow-sm">
        <Info className="mx-auto h-10 w-10 text-slate-400" />
        <h2 className="mt-3 text-lg font-semibold">Faqat koordinatorlar uchun</h2>
        <p className="mt-1 text-sm text-slate-500">
          Filial audit cheklistini faqat koordinator to‘ldiradi.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 pb-10">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-2xl bg-[#0b1a2e] px-6 py-7 text-white shadow-lg">
        <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-cyan-400/10 blur-2xl" />
        <div className="pointer-events-none absolute -bottom-20 left-10 h-48 w-48 rounded-full bg-amber-400/10 blur-2xl" />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-cyan-100">
              <ClipboardCheck className="h-3.5 w-3.5" />
              Koordinator · Filial nazorati
            </div>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
              Audit cheklist
            </h1>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-slate-300">
              Har bir filialga borib belgilangan talablarni tekshiring:{" "}
              <span className="text-emerald-300">Ha</span> yoki{" "}
              <span className="text-rose-300">Yo‘q</span>. Natija foizda
              hisoblanadi va saqlanadi.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              className="bg-white/10 text-white hover:bg-white/20"
              onClick={() => setHistoryOpen(true)}
            >
              <History className="mr-1.5 h-4 w-4" />
              Tarix ({history.length})
            </Button>
          </div>
        </div>
      </div>

      {/* Live score strip */}
      <div className="grid gap-3 sm:grid-cols-4">
        <ScoreCard
          icon={<TrendingUp className="h-4 w-4" />}
          label="Umumiy foiz"
          value={`${live.scorePercent}%`}
          valueClass={scoreTone(live.scorePercent)}
        />
        <ScoreCard
          icon={<Check className="h-4 w-4 text-emerald-600" />}
          label="Ha"
          value={String(live.yes)}
        />
        <ScoreCard
          icon={<X className="h-4 w-4 text-rose-600" />}
          label="Yo‘q"
          value={String(live.no)}
        />
        <ScoreCard
          icon={<ClipboardCheck className="h-4 w-4" />}
          label="Javob berilgan"
          value={`${live.answered}/${live.total}`}
        />
      </div>

      <div className="overflow-hidden rounded-2xl border bg-white shadow-sm">
        <div className="h-1.5 w-full bg-slate-100">
          <div
            className={cn("h-full transition-all duration-500", scoreBar(live.scorePercent))}
            style={{
              width: `${live.answered === 0 ? 0 : live.scorePercent}%`,
            }}
          />
        </div>

        {/* Meta form */}
        <div className="border-b px-5 py-5 sm:px-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-900 text-white">
                <Store className="h-4 w-4" />
              </div>
              <div>
                <h2 className="text-base font-semibold">Tashrif ma’lumotlari</h2>
                <p className="text-xs text-slate-500">
                  Filial tanlang — mudir avtomatik chiqadi
                </p>
              </div>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={resetForm}>
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
              Tozalash
            </Button>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-[11px] uppercase tracking-wide text-slate-500">
                Filialni tanlang
              </Label>
              <Select
                value={managerId || undefined}
                onValueChange={setManagerId}
                disabled={branchesLoading}
              >
                <SelectTrigger>
                  <SelectValue placeholder="— Filialni tanlang —" />
                </SelectTrigger>
                <SelectContent>
                  {branches.map((b) => (
                    <SelectItem key={b.id} value={String(b.id)}>
                      {b.branchLocation}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-[11px] uppercase tracking-wide text-slate-500">
                Filial mudiri
              </Label>
              <div className="flex h-9 items-center gap-2 rounded-md border bg-slate-50 px-3 text-sm">
                <User className="h-4 w-4 text-slate-400" />
                <span className={cn(!selectedBranch && "text-slate-400")}>
                  {selectedBranch?.managerName || "Avtomatik to‘ldiriladi…"}
                </span>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-[11px] uppercase tracking-wide text-slate-500">
                Tashrif sanasi
              </Label>
              <div className="relative">
                <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  type="date"
                  className="pl-9"
                  value={visitDate}
                  onChange={(e) => setVisitDate(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-[11px] uppercase tracking-wide text-slate-500">
                Tashrif nomi
              </Label>
              <Select value={visitName} onValueChange={setVisitName}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {VISIT_NAMES.map((v) => (
                    <SelectItem key={v.value} value={v.value}>
                      {v.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-[11px] uppercase tracking-wide text-slate-500">
                Koordinator F.I.Sh
              </Label>
              <div className="flex h-9 items-center rounded-md border bg-slate-50 px-3 text-sm font-medium">
                {user?.fullName || "—"}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-[11px] uppercase tracking-wide text-slate-500">
                Oy
              </Label>
              <Select value={monthLabel} onValueChange={setMonthLabel}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MONTHS.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label className="text-[11px] uppercase tracking-wide text-slate-500">
                Umumiy izoh / eslatma
              </Label>
              <Textarea
                rows={3}
                value={generalNote}
                onChange={(e) => setGeneralNote(e.target.value)}
                placeholder="Masalan: Konditsionerdan suv oqyapti — ustalarga aytilgan"
              />
            </div>
          </div>
        </div>

        {/* Checklist */}
        <div className="px-5 py-5 sm:px-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-cyan-600 text-white">
                <ClipboardCheck className="h-4 w-4" />
              </div>
              <div>
                <h2 className="text-base font-semibold">Audit cheklist</h2>
                <p className="text-xs text-slate-500">
                  Har bir bandni alohida tanlang — boshida hech narsa tanlanmagan
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={clearAnswers}>
                Javoblarni tozalash
              </Button>
              <Button type="button" size="sm" onClick={markAllYes}>
                <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                Barchasi «Ha»
              </Button>
            </div>
          </div>

          <Accordion
            type="multiple"
            defaultValue={categories.map((c) => c.id)}
            className="space-y-3"
          >
            {categories.map((cat) => {
              const catScore = scoreFromCategories([cat]);
              return (
                <AccordionItem
                  key={cat.id}
                  value={cat.id}
                  className="overflow-hidden rounded-xl border bg-slate-50/50 px-0"
                >
                  <AccordionTrigger className="px-4 py-3 hover:no-underline">
                    <div className="flex w-full items-center gap-3 pr-2 text-left">
                      <FolderOpen className="h-4 w-4 shrink-0 text-slate-500" />
                      <span className="flex-1 font-semibold text-slate-800">
                        {cat.title}
                      </span>
                      <Badge
                        variant="secondary"
                        className={cn(
                          "font-semibold",
                          catScore.answered === 0
                            ? "bg-slate-200 text-slate-600"
                            : scoreTone(catScore.scorePercent),
                        )}
                      >
                        {catScore.answered === 0
                          ? `${cat.items.length} ta`
                          : `${catScore.scorePercent}%`}
                      </Badge>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="px-3 pb-3 pt-0">
                    <ul className="space-y-2">
                      {cat.items.map((item) => (
                        <li
                          key={item.id}
                          className="rounded-xl border bg-white p-3 shadow-sm"
                        >
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <p className="text-sm font-medium text-slate-800">
                              {item.label}
                            </p>
                            <div className="flex shrink-0 gap-2">
                              <button
                                type="button"
                                onClick={() => setAnswer(cat.id, item.id, "yes")}
                                className={cn(
                                  "inline-flex min-w-[88px] items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-semibold transition-all",
                                  item.answer === "yes"
                                    ? "border-emerald-600 bg-emerald-600 text-white shadow-sm"
                                    : "border-slate-200 bg-white text-slate-600 hover:border-emerald-300 hover:bg-emerald-50",
                                )}
                              >
                                <Check className="h-4 w-4" />
                                Ha
                              </button>
                              <button
                                type="button"
                                onClick={() => setAnswer(cat.id, item.id, "no")}
                                className={cn(
                                  "inline-flex min-w-[120px] items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-semibold transition-all",
                                  item.answer === "no"
                                    ? "border-rose-600 bg-rose-600 text-white shadow-sm"
                                    : "border-slate-200 bg-white text-slate-600 hover:border-rose-300 hover:bg-rose-50",
                                )}
                              >
                                <X className="h-4 w-4" />
                                Yo‘q
                              </button>
                            </div>
                          </div>
                          {item.answer === "no" && (
                            <Input
                              className="mt-2"
                              placeholder="Kamchilik izohi (ixtiyoriy)…"
                              value={item.note || ""}
                              onChange={(e) =>
                                setItemNote(cat.id, item.id, e.target.value)
                              }
                            />
                          )}
                          {item.answer === null && (
                            <p className="mt-2 text-[11px] text-slate-400">
                              Hali tanlanmagan
                            </p>
                          )}
                        </li>
                      ))}
                    </ul>
                  </AccordionContent>
                </AccordionItem>
              );
            })}
          </Accordion>
        </div>

        <div className="flex flex-col gap-3 border-t bg-slate-50/80 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="text-sm text-slate-600">
            Joriy natija:{" "}
            <span className={cn("text-lg font-bold", scoreTone(live.scorePercent))}>
              {live.scorePercent}%
            </span>
            <span className="ml-2 text-xs text-slate-400">
              ({live.yes} Ha · {live.no} Yo‘q · {live.total - live.answered} kutilyapti)
            </span>
          </div>
          <Button
            size="lg"
            onClick={() => void handleSave()}
            disabled={createAudit.isPending || !canWrite}
            className="min-w-[160px]"
          >
            <Save className="mr-1.5 h-4 w-4" />
            {createAudit.isPending ? "Saqlanmoqda…" : "Saqlash"}
          </Button>
        </div>
      </div>

      {/* History dialog */}
      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Saqlangan auditlar</DialogTitle>
          </DialogHeader>
          {historyLoading ? (
            <p className="text-sm text-slate-500">Yuklanmoqda…</p>
          ) : history.length === 0 ? (
            <p className="rounded-xl border border-dashed p-8 text-center text-sm text-slate-500">
              Hali saqlangan cheklist yo‘q
            </p>
          ) : (
            <ul className="space-y-2">
              {history.map((a) => (
                <li
                  key={a.id}
                  className="flex flex-col gap-2 rounded-xl border bg-white p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <p className="font-semibold text-slate-800">
                      {a.branchLocation || "Filial"}
                    </p>
                    <p className="text-xs text-slate-500">
                      {a.visitDate} · {a.visitName} · {a.managerName} ·{" "}
                      {a.monthLabel || "—"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge
                      className={cn(
                        "font-bold",
                        a.scorePercent >= 85
                          ? "bg-emerald-100 text-emerald-700"
                          : a.scorePercent >= 70
                            ? "bg-amber-100 text-amber-700"
                            : "bg-rose-100 text-rose-700",
                      )}
                    >
                      {a.scorePercent}%
                    </Badge>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setViewing(a)}
                    >
                      Ko‘rish
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-rose-600"
                      onClick={() => {
                        void deleteAudit.mutateAsync(a.id).then(() => {
                          toast({ title: "O‘chirildi" });
                        });
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setHistoryOpen(false)}>
              Yopish
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View saved */}
      <Dialog open={!!viewing} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {viewing?.branchLocation} — {viewing?.scorePercent}%
            </DialogTitle>
          </DialogHeader>
          {viewing && (
            <div className="space-y-4 text-sm">
              <Progress value={viewing.scorePercent} className="h-2" />
              <p className="text-slate-500">
                {viewing.visitDate} · {viewing.visitName} · Mudir:{" "}
                {viewing.managerName}
              </p>
              {viewing.generalNote && (
                <p className="rounded-lg bg-slate-50 p-3">{viewing.generalNote}</p>
              )}
              {viewing.categories?.map((cat) => (
                <div key={cat.id}>
                  <p className="mb-1 font-semibold">{cat.title}</p>
                  <ul className="space-y-1">
                    {cat.items.map((it) => (
                      <li
                        key={it.id}
                        className="flex items-start justify-between gap-2 rounded-md border px-2 py-1.5"
                      >
                        <span>{it.label}</span>
                        <Badge
                          variant="secondary"
                          className={
                            it.answer === "yes"
                              ? "bg-emerald-100 text-emerald-700"
                              : it.answer === "no"
                                ? "bg-rose-100 text-rose-700"
                                : ""
                          }
                        >
                          {it.answer === "yes"
                            ? "Ha"
                            : it.answer === "no"
                              ? "Yo‘q"
                              : "—"}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ScoreCard({
  icon,
  label,
  value,
  valueClass,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="rounded-2xl border bg-white px-4 py-3 shadow-sm">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-500">
        {icon}
        {label}
      </div>
      <p className={cn("mt-1 text-2xl font-bold tabular-nums text-slate-900", valueClass)}>
        {value}
      </p>
    </div>
  );
}
