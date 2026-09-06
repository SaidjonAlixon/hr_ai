import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Clock3, MapPin, Search, Users, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { useToast } from "../../hooks/use-toast";
import { useI18n } from "../../i18n/I18nProvider";
import { cn } from "../../lib/utils";
import {
  assignSmenaBranch,
  fetchSmenaMe,
  saveMySmena,
  shiftLabelShort,
  type ShiftPick,
  type SmenaAssignable,
  type SmenaBranch,
} from "../../lib/smena-api";

const SHIFT_OPTIONS: { value: ShiftPick; label: string }[] = [
  { value: "one", label: "1-smena" },
  { value: "two", label: "2-smena" },
  { value: "three", label: "3-smena" },
  { value: "one+two", label: "1+2" },
  { value: "two+three", label: "2+3" },
];

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

function CompactList({ children }: { children: React.ReactNode }) {
  return <div className="max-h-44 overflow-y-auto rounded-lg border border-border bg-card">{children}</div>;
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
  );
}

export default function SmenaFilialPage() {
  const { toast } = useToast();
  const { t } = useI18n();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["smena-me"], queryFn: fetchSmenaMe });
  const data = q.data;

  const [branchQ, setBranchQ] = useState("");
  const [peopleQ, setPeopleQ] = useState("");
  const [pickedBranchId, setPickedBranchId] = useState<number | null>(null);
  const [pickedPersonId, setPickedPersonId] = useState<number | null>(null);
  const [pickedShift, setPickedShift] = useState<ShiftPick>("one");

  const staff = useMemo(
    () => (data?.assignable ?? []).filter((p) => p.orgRole === "pharmacist" || p.orgRole === "intern"),
    [data?.assignable],
  );

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

  const picked = staff.find((p) => p.id === pickedPersonId) ?? null;
  const pickedBranch = (data?.branches ?? []).find((b) => b.id === pickedBranchId) ?? null;

  const saveMine = useMutation({
    mutationFn: (body: { shiftType?: ShiftPick; assignedBranchId?: number }) => saveMySmena(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["smena-me"] });
      toast({ title: "Saqlandi" });
    },
    onError: (e: Error) => toast({ title: "Saqlanmadi", description: e.message, variant: "destructive" }),
  });

  const saveAssign = useMutation({
    mutationFn: (p: { id: number; assignedBranchId: number; shiftType: ShiftPick }) =>
      assignSmenaBranch(p.id, p.assignedBranchId, p.shiftType),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["smena-me"] });
      toast({ title: "Saqlandi", description: r.assignedBranchName });
      cancelEdit();
    },
    onError: (e: Error) => toast({ title: "Saqlanmadi", description: e.message, variant: "destructive" }),
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

  function onSaveTeam() {
    if (!pickedPersonId || !pickedBranchId) {
      toast({ title: "Tanlang", description: "Xodim va filialni tanlang.", variant: "destructive" });
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
          "flex w-full items-center justify-between gap-2 border-b border-slate-50 px-3 py-1.5 text-left last:border-0",
          on ? "bg-sky-50" : "hover:bg-muted",
        )}
      >
        <span className="min-w-0 truncate text-sm text-foreground">{b.name}</span>
        {on ? <Check className="h-4 w-4 shrink-0 text-sky-600" /> : null}
      </button>
    );
  }

  if (q.isLoading) return <p className="p-6 text-sm text-muted-foreground">Yuklanmoqda…</p>;
  if (!data) return <p className="p-6 text-sm text-rose-600">Ma’lumot yuklanmadi</p>;

  const myShift = normalizePick(data.shift.type);

  return (
    <div className="mx-auto max-w-lg space-y-4 p-4 pb-28">
      <div>
        <h1 className="text-xl font-semibold text-foreground">{t("smena.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("smena.subtitle")}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {data.rules.eligible || "Smena faqat mudir, farmasevt va stajyor uchun"}
        </p>
      </div>

      {data.canPickShift ? (
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Clock3 className="h-4 w-4" />
              Mening smenam
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
              Ofis ish vaqti
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 pt-0">
            <p className="text-sm font-medium text-foreground">
              {data.shift.start}–{data.shift.end}
            </p>
            <p className="text-xs text-muted-foreground">
              {data.rules.office || data.shift.hoursNote || "Ofis xodimlarida smena yo‘q — faqat belgilangan vaqt."}
            </p>
          </CardContent>
        </Card>
      )}

      {data.canAssignOthers ? (
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="h-4 w-4" />
              Farmasevt va stajyorlar
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pt-0">
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
                      "flex w-full items-center justify-between gap-2 border-b border-slate-50 px-3 py-2 text-left last:border-0",
                      on ? "bg-sky-50" : "hover:bg-muted",
                    )}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-foreground">{p.fullName}</span>
                      <span className="text-[11px] text-muted-foreground">
                        {orgLabel(p.orgRole)} · {shiftLabelShort(p.shiftType)} ·{" "}
                        {p.assignedBranchName || "filial yo‘q"}
                      </span>
                    </span>
                    {on ? <Check className="h-4 w-4 shrink-0 text-sky-600" /> : null}
                  </button>
                );
              })}
              {people.length === 0 ? <p className="px-3 py-4 text-center text-sm text-muted-foreground">Xodim topilmadi</p> : null}
            </CompactList>

            {picked ? (
              <div className="space-y-3 rounded-xl border border-border bg-muted p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-foreground">{picked.fullName}</p>
                    <p className="text-[11px] text-muted-foreground">{orgLabel(picked.orgRole)}</p>
                  </div>
                </div>

                <div className="space-y-2">
                  <p className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                    <MapPin className="h-3.5 w-3.5" />
                    Filial {pickedBranch ? `· ${pickedBranch.name}` : ""}
                  </p>
                  <SearchBox value={branchQ} onChange={setBranchQ} placeholder={t("smena.searchBranch")} />
                  <CompactList>
                    {branches.map(renderBranchRow)}
                    {branches.length === 0 ? (
                      <p className="px-3 py-3 text-center text-xs text-muted-foreground">Filial topilmadi</p>
                    ) : null}
                  </CompactList>
                </div>

                <ShiftButtons value={pickedShift} onChange={setPickedShift} />

                <div className="grid grid-cols-2 gap-2">
                  <Button type="button" variant="outline" onClick={cancelEdit}>
                    <X className="mr-1 h-4 w-4" />
                    Bekor qilish
                  </Button>
                  <Button type="button" disabled={saveAssign.isPending} onClick={onSaveTeam}>
                    Saqlash
                  </Button>
                </div>
              </div>
            ) : (
              <p className="text-center text-xs text-muted-foreground">{t("smena.pickHint")}</p>
            )}
          </CardContent>
        </Card>
      ) : data.canPickOwnBranch ? (
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <MapPin className="h-4 w-4" />
              Mening filiali
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 pt-0">
            <p className="text-xs text-muted-foreground">
              Face ID: <b className="text-foreground">{data.employee?.assignedBranchName || "—"}</b>
            </p>
            <SearchBox value={branchQ} onChange={setBranchQ} placeholder={t("smena.searchBranch")} />
            <CompactList>{branches.map(renderBranchRow)}</CompactList>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" onClick={() => { setPickedBranchId(data.employee?.assignedBranchId ?? null); setBranchQ(""); }}>
                Bekor qilish
              </Button>
              <Button
                disabled={!pickedBranchId || saveMine.isPending}
                onClick={() => pickedBranchId && saveMine.mutate({ assignedBranchId: pickedBranchId })}
              >
                Saqlash
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <p className="text-sm text-muted-foreground">
          Filialingiz: <b>{data.employee?.assignedBranchName || "belgilanmagan"}</b>
        </p>
      )}
    </div>
  );
}
