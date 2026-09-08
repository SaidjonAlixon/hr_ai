import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRightLeft,
  CalendarDays,
  Check,
  Clock3,
  MapPin,
  Search,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { startOfDay } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Calendar } from "../../components/ui/calendar";
import { useToast } from "../../hooks/use-toast";
import { useI18n } from "../../i18n/I18nProvider";
import { cn } from "../../lib/utils";
import { dateToYmd, formatYmdDisplay } from "../../lib/javob-olish-api";
import {
  assignSmenaBranch,
  createDayRotation,
  deleteDayRotation,
  fetchRotationsForDates,
  fetchSmenaMe,
  saveMySmena,
  shiftLabelShort,
  todayTashkentYmd,
  type ShiftPick,
  type SmenaAssignable,
  type SmenaBranch,
} from "../../lib/smena-api";

const SHIFT_OPTIONS: { value: ShiftPick; label: string; hint: string }[] = [
  { value: "one", label: "1-smena", hint: "08:00–17:00" },
  { value: "two", label: "2-smena", hint: "17:00–23:45" },
  { value: "three", label: "3-smena", hint: "23:00–07:00" },
  { value: "one+two", label: "1+2", hint: "kelish 08:00 · ketish 23:45" },
  { value: "two+three", label: "2+3", hint: "kelish 17:00 · ketish 07:00" },
];

type Mode = "permanent" | "rotation";

function orgLabel(org: string | null) {
  if (org === "pharmacist") return "Farmasevt";
  if (org === "intern") return "Stajyor";
  if (org === "manager") return "Mudir";
  return "Xodim";
}

function normalizePick(raw?: string | null): ShiftPick {
  const s = String(raw || "").toLowerCase();
  if (s === "one+two" || s.includes("one+two")) return "one+two";
  if (s === "two+three" || s.includes("two+three")) return "two+three";
  if (s === "three" || s.endsWith("three")) return "three";
  if (s === "two" || s.startsWith("two")) return "two";
  return "one";
}

function shiftHint(value: ShiftPick): string {
  return SHIFT_OPTIONS.find((o) => o.value === value)?.hint || "";
}

function SearchBox({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="h-9 pl-8" />
    </div>
  );
}

function CompactList({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("max-h-48 overflow-y-auto rounded-xl border border-border bg-card", className)}>
      {children}
    </div>
  );
}

function ShiftButtons({
  value,
  onChange,
  disabled,
}: {
  value: ShiftPick;
  onChange: (v: ShiftPick) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
        {SHIFT_OPTIONS.map((opt) => (
          <Button
            key={opt.value}
            size="sm"
            type="button"
            variant={value === opt.value ? "default" : "outline"}
            disabled={disabled}
            onClick={() => onChange(opt.value)}
          >
            {opt.label}
          </Button>
        ))}
      </div>
      <p className="text-[11px] leading-snug text-muted-foreground">{shiftHint(value)}</p>
    </div>
  );
}

export default function SmenaFilialPage() {
  const { toast } = useToast();
  const { t } = useI18n();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["smena-me"], queryFn: fetchSmenaMe });
  const data = q.data;

  const [mode, setMode] = useState<Mode>("rotation");
  const [branchQ, setBranchQ] = useState("");
  const [peopleQ, setPeopleQ] = useState("");
  const [pickedBranchId, setPickedBranchId] = useState<number | null>(null);
  const [pickedPersonId, setPickedPersonId] = useState<number | null>(null);
  const [pickedShift, setPickedShift] = useState<ShiftPick>("one");
  const [selectedDates, setSelectedDates] = useState<Date[]>(() => {
    const [y, m, d] = todayTashkentYmd().split("-").map(Number);
    return [new Date(y!, m! - 1, d!, 12, 0, 0)];
  });

  const workDates = useMemo(
    () => selectedDates.map(dateToYmd).sort((a, b) => a.localeCompare(b)),
    [selectedDates],
  );
  const workDatesKey = workDates.join(",");

  const canRotate = Boolean(data?.canDayRotate);
  const canAssign = Boolean(data?.canAssignOthers);

  useEffect(() => {
    if (!data) return;
    if (!canRotate && canAssign) setMode("permanent");
  }, [data, canRotate, canAssign]);

  const staff = useMemo(() => {
    const list = data?.assignable ?? [];
    if (mode === "rotation") {
      return list.filter(
        (p) => p.orgRole === "pharmacist" || p.orgRole === "intern" || p.orgRole === "manager",
      );
    }
    return list.filter((p) => p.orgRole === "pharmacist" || p.orgRole === "intern" || p.orgRole === "manager");
  }, [data?.assignable, mode]);

  const branches = useMemo(() => {
    const list = data?.branches ?? [];
    const s = branchQ.trim().toLowerCase();
    if (!s) return list;
    return list.filter((b) => `${b.name} ${b.managerName}`.toLowerCase().includes(s));
  }, [data?.branches, branchQ]);

  const people = useMemo(() => {
    const s = peopleQ.trim().toLowerCase();
    if (!s) return staff;
    return staff.filter((p) =>
      `${p.fullName} ${orgLabel(p.orgRole)} ${p.assignedBranchName || ""}`.toLowerCase().includes(s),
    );
  }, [staff, peopleQ]);

  const rotationsQ = useQuery({
    queryKey: ["smena-rotations", workDatesKey],
    queryFn: () => fetchRotationsForDates(workDates),
    enabled: Boolean(canRotate && mode === "rotation" && workDates.length > 0),
  });

  const picked = staff.find((p) => p.id === pickedPersonId) ?? null;
  const pickedBranch = (data?.branches ?? []).find((b) => b.id === pickedBranchId) ?? null;

  const datesLabel =
    workDates.length === 0
      ? "—"
      : workDates.length === 1
        ? formatYmdDisplay(workDates[0]!)
        : `${workDates.length} kun (${formatYmdDisplay(workDates[0]!)} … ${formatYmdDisplay(workDates[workDates.length - 1]!)})`;

  const saveMine = useMutation({
    mutationFn: (body: { shiftType?: ShiftPick; assignedBranchId?: number }) => saveMySmena(body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["smena-me"] });
      toast({ title: t("smena.saved") });
    },
    onError: (e: Error) => toast({ title: t("smena.saveFail"), description: e.message, variant: "destructive" }),
  });

  const saveAssign = useMutation({
    mutationFn: (p: { id: number; assignedBranchId?: number | null; shiftType: ShiftPick }) =>
      assignSmenaBranch(p.id, p.assignedBranchId, p.shiftType),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ["smena-me"] });
      toast({
        title: r.shiftOnly ? t("smena.shiftOnlySaved") : t("smena.saved"),
        description: r.assignedBranchName,
      });
      cancelEdit();
    },
    onError: (e: Error) => toast({ title: t("smena.saveFail"), description: e.message, variant: "destructive" }),
  });

  const saveRotation = useMutation({
    mutationFn: (p: { employeeId: number; branchId: number; shiftType: ShiftPick }) => {
      if (!workDates.length) throw new Error(t("smena.pickDates"));
      return createDayRotation({
        employeeId: p.employeeId,
        branchId: p.branchId,
        workDates,
        shiftType: p.shiftType,
      });
    },
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ["smena-rotations"] });
      toast({
        title: t("smena.rotationOk"),
        description: `${r.count} kun · ${r.branchLabel}`,
      });
      cancelEdit();
    },
    onError: (e: Error) =>
      toast({ title: t("smena.rotationFail"), description: e.message, variant: "destructive" }),
  });

  const removeRotation = useMutation({
    mutationFn: (id: number) => deleteDayRotation(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["smena-rotations"] });
      toast({ title: t("smena.rotationRemoved") });
    },
    onError: (e: Error) => toast({ title: t("smena.saveFail"), description: e.message, variant: "destructive" }),
  });

  function pickPerson(p: SmenaAssignable) {
    setPickedPersonId(p.id);
    setPickedShift(normalizePick(p.shiftType));
    setPickedBranchId(p.assignedBranchId);
    setBranchQ("");
  }

  function cancelEdit() {
    setPickedPersonId(null);
    setPickedBranchId(null);
    setPickedShift("one");
    setBranchQ("");
  }

  function onSaveShiftOnly() {
    if (!pickedPersonId) {
      toast({ title: t("smena.pickTitle"), description: t("smena.pickPerson"), variant: "destructive" });
      return;
    }
    if (!workDates.length) {
      toast({ title: t("smena.pickTitle"), description: t("smena.pickDates"), variant: "destructive" });
      return;
    }
    if (mode === "rotation") {
      const branchId = pickedBranchId || picked?.assignedBranchId;
      if (!branchId) {
        toast({
          title: t("smena.pickTitle"),
          description: t("smena.needBranchForDay"),
          variant: "destructive",
        });
        return;
      }
      saveRotation.mutate({ employeeId: pickedPersonId, branchId, shiftType: pickedShift });
      return;
    }
    saveAssign.mutate({
      id: pickedPersonId,
      assignedBranchId: null,
      shiftType: pickedShift,
    });
  }

  function onSaveTeam() {
    if (!pickedPersonId) {
      toast({ title: t("smena.pickTitle"), description: t("smena.pickPerson"), variant: "destructive" });
      return;
    }
    if (mode === "rotation") {
      if (!workDates.length) {
        toast({ title: t("smena.pickTitle"), description: t("smena.pickDates"), variant: "destructive" });
        return;
      }
      const branchId = pickedBranchId || picked?.assignedBranchId;
      if (!branchId) {
        toast({ title: t("smena.pickTitle"), description: t("smena.pickPersonBranch"), variant: "destructive" });
        return;
      }
      saveRotation.mutate({ employeeId: pickedPersonId, branchId, shiftType: pickedShift });
      return;
    }
    if (!pickedBranchId) {
      // Filial tanlanmasa — joriy filialda faqat smena
      onSaveShiftOnly();
      return;
    }
    saveAssign.mutate({ id: pickedPersonId, assignedBranchId: pickedBranchId, shiftType: pickedShift });
  }

  function renderBranchRow(b: SmenaBranch) {
    const on = pickedBranchId === b.id;
    return (
      <button
        key={b.id}
        type="button"
        onClick={() => setPickedBranchId(b.id)}
        className={cn(
          "flex w-full items-center justify-between gap-2 border-b border-border/60 px-3 py-2 text-left last:border-0",
          on ? "bg-primary/10" : "hover:bg-muted/70",
        )}
      >
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-foreground">{b.name}</span>
          <span className="text-[11px] text-muted-foreground">{b.managerName}</span>
        </span>
        {on ? <Check className="h-4 w-4 shrink-0 text-primary" /> : null}
      </button>
    );
  }

  if (q.isLoading) return <p className="p-6 text-sm text-muted-foreground">{t("ui.loading")}</p>;
  if (!data) return <p className="p-6 text-sm text-rose-600">{t("smena.loadFail")}</p>;

  const myShift = normalizePick(data.shift.type);
  const showAssignPanel = (mode === "rotation" && canRotate) || (mode === "permanent" && canAssign);

  return (
    <div className="mx-auto max-w-lg space-y-4 p-4 pb-28">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">{t("smena.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("smena.subtitle")}</p>
      </div>

      {(canRotate || canAssign) && (
        <div className="grid grid-cols-2 gap-1 rounded-2xl border border-border bg-muted/40 p-1">
          <button
            type="button"
            disabled={!canRotate}
            onClick={() => {
              setMode("rotation");
              cancelEdit();
            }}
            className={cn(
              "flex items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-sm font-semibold transition",
              mode === "rotation" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground",
              !canRotate && "opacity-40",
            )}
          >
            <CalendarDays className="h-4 w-4" />
            {t("smena.tabRotation")}
          </button>
          <button
            type="button"
            disabled={!canAssign}
            onClick={() => {
              setMode("permanent");
              cancelEdit();
            }}
            className={cn(
              "flex items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-sm font-semibold transition",
              mode === "permanent" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground",
              !canAssign && "opacity-40",
            )}
          >
            <ArrowRightLeft className="h-4 w-4" />
            {t("smena.tabPermanent")}
          </button>
        </div>
      )}

      {mode === "rotation" && canRotate ? (
        <Card className="overflow-hidden border-primary/20 shadow-sm">
          <CardHeader className="space-y-3 border-b bg-gradient-to-br from-primary/10 via-card to-card py-4">
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarDays className="h-4 w-4 text-primary" />
              {t("smena.rotationTitle")}
            </CardTitle>
            <p className="text-xs leading-relaxed text-muted-foreground">{t("smena.rotationHint")}</p>
            <div>
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {t("smena.workDates")}
              </label>
              <div className="overflow-hidden rounded-xl border border-border bg-card">
                <Calendar
                  mode="multiple"
                  selected={selectedDates}
                  onSelect={(days) => setSelectedDates(days ?? [])}
                  disabled={(day) => day < startOfDay(new Date())}
                  className="w-full"
                />
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {t("smena.selectedDates")}:{" "}
                <span className="font-medium text-foreground">{datesLabel}</span>
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">{t("smena.autoRevertHint")}</p>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 pt-4">
            <p className="text-xs font-medium text-foreground">{t("smena.pickStaff")}</p>
            <SearchBox value={peopleQ} onChange={setPeopleQ} placeholder={t("smena.searchName")} />
            <CompactList>
              {people.map((p) => {
                const on = pickedPersonId === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => pickPerson(p)}
                    className={cn(
                      "flex w-full items-center justify-between gap-2 border-b border-border/60 px-3 py-2.5 text-left last:border-0",
                      on ? "bg-primary/10" : "hover:bg-muted/70",
                    )}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-foreground">{p.fullName}</span>
                      <span className="text-[11px] text-muted-foreground">
                        {orgLabel(p.orgRole)} · {shiftLabelShort(p.shiftType)} ·{" "}
                        {p.assignedBranchName || t("smena.noBranch")}
                      </span>
                    </span>
                    {on ? <Check className="h-4 w-4 shrink-0 text-primary" /> : null}
                  </button>
                );
              })}
              {people.length === 0 ? (
                <p className="px-3 py-4 text-center text-sm text-muted-foreground">{t("smena.noPeople")}</p>
              ) : null}
            </CompactList>

            {picked ? (
              <div className="space-y-3 rounded-2xl border border-border bg-muted/30 p-3.5">
                <div>
                  <p className="truncate text-sm font-semibold text-foreground">{picked.fullName}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {orgLabel(picked.orgRole)} · {t("smena.onlyForDate")} {datesLabel}
                  </p>
                </div>

                <div className="space-y-2">
                  <p className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                    <MapPin className="h-3.5 w-3.5" />
                    {t("smena.targetBranch")}
                    {pickedBranch ? ` · ${pickedBranch.name}` : ""}
                  </p>
                  <SearchBox value={branchQ} onChange={setBranchQ} placeholder={t("smena.searchBranch")} />
                  <CompactList className="max-h-40">{branches.map(renderBranchRow)}</CompactList>
                </div>

                <div className="space-y-2">
                  <p className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                    <Clock3 className="h-3.5 w-3.5" />
                    {t("smena.dayShift")}
                  </p>
                  <ShiftButtons value={pickedShift} onChange={setPickedShift} />
                </div>

                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <Button type="button" variant="outline" onClick={cancelEdit}>
                      <X className="mr-1 h-4 w-4" />
                      {t("ui.cancel")}
                    </Button>
                    <Button
                      type="button"
                      disabled={saveRotation.isPending || workDates.length === 0}
                      onClick={onSaveTeam}
                    >
                      {t("smena.applyRotation")}
                    </Button>
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    className="w-full"
                    disabled={
                      saveRotation.isPending ||
                      workDates.length === 0 ||
                      !(pickedBranchId || picked.assignedBranchId)
                    }
                    onClick={onSaveShiftOnly}
                  >
                    {t("smena.keepBranchChangeShift")}
                  </Button>
                  <p className="text-[11px] text-muted-foreground">{t("smena.keepBranchHint")}</p>
                </div>
              </div>
            ) : (
              <p className="text-center text-xs text-muted-foreground">{t("smena.pickHint")}</p>
            )}

            <div className="space-y-2 border-t border-border pt-3">
              <p className="text-xs font-semibold text-foreground">
                {t("smena.rotationsFor")} {datesLabel}
              </p>
              {rotationsQ.isLoading ? (
                <p className="text-xs text-muted-foreground">{t("ui.loading")}</p>
              ) : (rotationsQ.data?.items.length ?? 0) === 0 ? (
                <p className="rounded-xl border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
                  {t("smena.noRotations")}
                </p>
              ) : (
                <div className="space-y-2">
                  {rotationsQ.data!.items.map((r) => (
                    <div
                      key={`${r.id}-${r.workDate || ""}`}
                      className="flex items-start justify-between gap-2 rounded-xl border border-border bg-card px-3 py-2.5"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">{r.fullName}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {r.workDate ? `${formatYmdDisplay(r.workDate)} · ` : ""}
                          {orgLabel(r.orgRole)} → {r.branchLabel || `#${r.branchId}`}
                          {r.shiftKeys?.length
                            ? ` · ${r.shiftKeys.map((k) => shiftLabelShort(k)).join("+")}`
                            : ""}
                        </p>
                      </div>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 shrink-0 text-rose-600"
                        disabled={removeRotation.isPending}
                        onClick={() => {
                          if (window.confirm(t("smena.confirmRemoveRotation"))) {
                            removeRotation.mutate(r.id);
                          }
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {data.canPickShift ? (
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Clock3 className="h-4 w-4" />
              {t("smena.myShift")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 pt-0">
            <p className="text-xs text-muted-foreground">{data.shift.hoursNote}</p>
            <ShiftButtons
              value={myShift}
              disabled={saveMine.isPending}
              onChange={(v) => saveMine.mutate({ shiftType: v })}
            />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Clock3 className="h-4 w-4" />
              {t("smena.officeHours")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 pt-0">
            <p className="text-sm font-medium text-foreground">
              {data.shift.start}–{data.shift.end}
            </p>
            <p className="text-xs text-muted-foreground">
              {data.rules.office || data.shift.hoursNote}
            </p>
          </CardContent>
        </Card>
      )}

      {mode === "permanent" && showAssignPanel ? (
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="h-4 w-4" />
              {t("smena.permanentTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pt-0">
            <p className="text-xs text-muted-foreground">{t("smena.permanentHint")}</p>
            <SearchBox value={peopleQ} onChange={setPeopleQ} placeholder={t("smena.searchName")} />
            <CompactList>
              {people.map((p) => {
                const on = pickedPersonId === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => pickPerson(p)}
                    className={cn(
                      "flex w-full items-center justify-between gap-2 border-b border-border/60 px-3 py-2 text-left last:border-0",
                      on ? "bg-sky-50 dark:bg-sky-950/30" : "hover:bg-muted",
                    )}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-foreground">{p.fullName}</span>
                      <span className="text-[11px] text-muted-foreground">
                        {orgLabel(p.orgRole)} · {shiftLabelShort(p.shiftType)} ·{" "}
                        {p.assignedBranchName || t("smena.noBranch")}
                      </span>
                    </span>
                    {on ? <Check className="h-4 w-4 shrink-0 text-sky-600" /> : null}
                  </button>
                );
              })}
              {people.length === 0 ? (
                <p className="px-3 py-4 text-center text-sm text-muted-foreground">{t("smena.noPeople")}</p>
              ) : null}
            </CompactList>

            {picked ? (
              <div className="space-y-3 rounded-xl border border-border bg-muted p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-foreground">{picked.fullName}</p>
                  <p className="text-[11px] text-muted-foreground">{orgLabel(picked.orgRole)}</p>
                </div>
                <div className="space-y-2">
                  <p className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                    <MapPin className="h-3.5 w-3.5" />
                    {t("ui.branch")} {pickedBranch ? `· ${pickedBranch.name}` : ""}
                  </p>
                  <SearchBox value={branchQ} onChange={setBranchQ} placeholder={t("smena.searchBranch")} />
                  <CompactList>{branches.map(renderBranchRow)}</CompactList>
                </div>
                <ShiftButtons value={pickedShift} onChange={setPickedShift} />
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <Button type="button" variant="outline" onClick={cancelEdit}>
                      <X className="mr-1 h-4 w-4" />
                      {t("ui.cancel")}
                    </Button>
                    <Button type="button" disabled={saveAssign.isPending} onClick={onSaveTeam}>
                      {pickedBranchId && pickedBranchId !== picked.assignedBranchId
                        ? t("smena.saveBranchAndShift")
                        : t("ui.save")}
                    </Button>
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    className="w-full"
                    disabled={saveAssign.isPending}
                    onClick={onSaveShiftOnly}
                  >
                    {t("smena.keepBranchChangeShift")}
                  </Button>
                  <p className="text-[11px] text-muted-foreground">{t("smena.keepBranchHint")}</p>
                </div>
              </div>
            ) : (
              <p className="text-center text-xs text-muted-foreground">{t("smena.pickHint")}</p>
            )}
          </CardContent>
        </Card>
      ) : null}

      {data.canPickOwnBranch && !showAssignPanel ? (
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <MapPin className="h-4 w-4" />
              {t("smena.myBranch")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 pt-0">
            <p className="text-sm text-foreground">
              {data.employee?.assignedBranchName || t("smena.noBranch")}
            </p>
            <SearchBox value={branchQ} onChange={setBranchQ} placeholder={t("smena.searchBranch")} />
            <CompactList>
              {branches.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => saveMine.mutate({ assignedBranchId: b.id })}
                  className="flex w-full items-center justify-between gap-2 border-b border-border/60 px-3 py-2 text-left last:border-0 hover:bg-muted"
                >
                  <span className="truncate text-sm">{b.name}</span>
                  {data.employee?.assignedBranchId === b.id ? (
                    <Check className="h-4 w-4 text-primary" />
                  ) : null}
                </button>
              ))}
            </CompactList>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
