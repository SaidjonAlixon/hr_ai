import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowRight, Check, Info, Loader2, MapPin, Search, Shuffle, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { filialNumberLabel } from "@/lib/filial-number";
import { useMovePharmacyStaff, type PharmacyOrgRole } from "@/lib/pharmacy-staff-api";

export type MoveBranchOption = {
  id: number;
  label: string;
  branchNo: number | null;
  coordinatorName: string | null;
  /** null — filialda mudir yo‘q (bo‘sh o‘rin) */
  mudir: { employeeId: number; fullName: string } | null;
};

export type MovePersonOption = {
  id: number;
  fullName: string;
  orgRole: PharmacyOrgRole;
  /** Mudir uchun — o‘z filiali (o‘zining id si) */
  branchId: number | null;
};

type DisplacedMode = "stay_pharmacist" | "stay_intern" | "swap" | "other";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  branches: MoveBranchOption[];
  people: MovePersonOption[];
  initialPersonId?: number | null;
  initialBranchId?: number | null;
  initialRole?: PharmacyOrgRole;
  onDone: (message: string) => void;
};

const ROLE_LABEL: Record<PharmacyOrgRole, string> = {
  manager: "Mudir",
  pharmacist: "Farmasevt",
  intern: "Stajyor",
};

const ROLE_HINT: Record<PharmacyOrgRole, string> = {
  manager: "Filialni boshqaradi",
  pharmacist: "Filial xodimi",
  intern: "O‘rganuvchi",
};

function roleWord(role: PharmacyOrgRole) {
  return ROLE_LABEL[role].toLowerCase();
}

function norm(s: string) {
  return s.toLowerCase().replace(/[ʻʼ’'`]/g, "").replace(/\s+/g, " ").trim();
}

function BranchNo({ no }: { no: number | null }) {
  const label = filialNumberLabel(no);
  if (!label) return null;
  return (
    <span className="mr-1.5 inline-flex shrink-0 items-center rounded bg-rose-600 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">
      {label}
    </span>
  );
}

function SearchList<T extends { id: number }>({
  items,
  selectedId,
  onSelect,
  placeholder,
  match,
  render,
  emptyText,
}: {
  items: T[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  placeholder: string;
  match: (item: T, q: string) => boolean;
  render: (item: T) => ReactNode;
  emptyText: string;
}) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const nq = norm(q);
    const list = nq ? items.filter((it) => match(it, nq)) : items;
    return list.slice(0, 80);
  }, [items, q, match]);

  return (
    <div className="rounded-lg border border-border">
      <div className="relative border-b border-border">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={placeholder}
          className="h-9 border-0 pl-8 shadow-none focus-visible:ring-0"
        />
      </div>
      <div className="max-h-48 overflow-y-auto overscroll-contain p-1">
        {filtered.length === 0 ? (
          <p className="px-2 py-3 text-center text-xs text-muted-foreground">{emptyText}</p>
        ) : (
          filtered.map((it) => (
            <button
              key={it.id}
              type="button"
              onClick={() => onSelect(it.id)}
              className={cn(
                "flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted",
                selectedId === it.id && "bg-sky-50 ring-1 ring-sky-300 dark:bg-sky-950/40 dark:ring-sky-500/40",
              )}
            >
              <span className="min-w-0 flex-1">{render(it)}</span>
              {selectedId === it.id ? <Check className="mt-0.5 h-4 w-4 shrink-0 text-sky-600" /> : null}
            </button>
          ))
        )}
      </div>
    </div>
  );
}

function RolePicker({
  value,
  onChange,
  disabled,
}: {
  value: PharmacyOrgRole;
  onChange: (r: PharmacyOrgRole) => void;
  disabled?: Partial<Record<PharmacyOrgRole, string>>;
}) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {(["manager", "pharmacist", "intern"] as const).map((r) => {
        const why = disabled?.[r];
        return (
          <button
            key={r}
            type="button"
            disabled={!!why}
            title={why}
            onClick={() => onChange(r)}
            className={cn(
              "rounded-lg border px-2 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-45",
              value === r
                ? "border-sky-500 bg-sky-50 ring-1 ring-sky-400 dark:bg-sky-950/40"
                : "border-border hover:bg-muted",
            )}
          >
            <span className="block text-sm font-semibold">{ROLE_LABEL[r]}</span>
            <span className="block text-[11px] text-muted-foreground">{why || ROLE_HINT[r]}</span>
          </button>
        );
      })}
    </div>
  );
}

export function MoveStaffDialog({
  open,
  onOpenChange,
  branches,
  people,
  initialPersonId,
  initialBranchId,
  initialRole,
  onDone,
}: Props) {
  const move = useMovePharmacyStaff();
  const [personId, setPersonId] = useState<number | null>(null);
  const [targetId, setTargetId] = useState<number | null>(null);
  const [role, setRole] = useState<PharmacyOrgRole>("pharmacist");
  const [mode, setMode] = useState<DisplacedMode>("stay_pharmacist");
  const [otherId, setOtherId] = useState<number | null>(null);
  const [otherRole, setOtherRole] = useState<PharmacyOrgRole>("pharmacist");
  const [pickPerson, setPickPerson] = useState(false);
  const [pickBranch, setPickBranch] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    const p = people.find((x) => x.id === initialPersonId) ?? null;
    setPersonId(p?.id ?? null);
    setTargetId(initialBranchId ?? null);
    setRole(initialRole ?? (p?.orgRole === "intern" ? "intern" : "pharmacist"));
    setMode("stay_pharmacist");
    setOtherId(null);
    setOtherRole("pharmacist");
    setPickPerson(!p);
    setPickBranch(initialBranchId == null);
    setError("");
    // faqat dialog ochilganda boshlang‘ich qiymatlar
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const branchById = useMemo(() => new Map(branches.map((b) => [b.id, b])), [branches]);
  const person = people.find((p) => p.id === personId) ?? null;
  const fromBranch = person?.branchId != null ? branchById.get(person.branchId) ?? null : null;
  const target = targetId != null ? branchById.get(targetId) ?? null : null;
  const personIsMudir = person?.orgRole === "manager";

  const occupant =
    role === "manager" && target?.mudir && target.mudir.employeeId !== person?.id ? target.mudir : null;
  const canSwap = !!occupant && personIsMudir && !!fromBranch && fromBranch.id !== target?.id;

  useEffect(() => {
    if (occupant) setMode(canSwap ? "swap" : "stay_pharmacist");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [occupant?.employeeId, canSwap]);

  const vacantAfterPersonLeaves = (b: MoveBranchOption) =>
    !b.mudir || (personIsMudir && b.id === person?.branchId);

  const otherBranches = useMemo(
    () => branches.filter((b) => b.id !== target?.id),
    [branches, target?.id],
  );
  const other = otherId != null ? branchById.get(otherId) ?? null : null;
  const otherMudirBlocked = other ? !vacantAfterPersonLeaves(other) : false;

  useEffect(() => {
    if (otherMudirBlocked && otherRole === "manager") setOtherRole("pharmacist");
  }, [otherMudirBlocked, otherRole]);

  const noChange = !!person && !!target && person.branchId === target.id && person.orgRole === role;

  const displaced = (() => {
    if (!occupant || !target) return null;
    if (mode === "stay_pharmacist") return { targetBranchId: target.id, newOrgRole: "pharmacist" as const };
    if (mode === "stay_intern") return { targetBranchId: target.id, newOrgRole: "intern" as const };
    if (mode === "swap" && fromBranch) return { targetBranchId: fromBranch.id, newOrgRole: "manager" as const };
    if (mode === "other" && other) return { targetBranchId: other.id, newOrgRole: otherRole };
    return null;
  })();

  const plan = useMemo(() => {
    if (!person || !target) return [] as Array<{ tone: "main" | "warn" | "ok"; text: string }>;
    const steps: Array<{ tone: "main" | "warn" | "ok"; text: string }> = [];
    const fromText = fromBranch
      ? `«${fromBranch.label}» ${roleWord(person.orgRole)}i`
      : roleWord(person.orgRole);
    steps.push({
      tone: "main",
      text:
        fromBranch?.id === target.id
          ? `${person.fullName}: «${target.label}» filialida ${roleWord(person.orgRole)} → endi ${roleWord(role)}`
          : `${person.fullName}: ${fromText} → «${target.label}» filialiga ${roleWord(role)}`,
    });
    if (occupant && displaced) {
      const dest = branchById.get(displaced.targetBranchId);
      steps.push({
        tone: "main",
        text:
          displaced.targetBranchId === target.id
            ? `${occupant.fullName}: «${target.label}» mudiri → shu filialda ${roleWord(displaced.newOrgRole)} bo‘lib qoladi`
            : `${occupant.fullName}: «${target.label}» mudiri → «${dest?.label ?? "—"}» filialiga ${roleWord(displaced.newOrgRole)}`,
      });
    }
    const refilled =
      !!displaced && displaced.newOrgRole === "manager" && displaced.targetBranchId === fromBranch?.id;
    if (personIsMudir && fromBranch && !refilled && !(fromBranch.id === target.id && role === "manager")) {
      steps.push({
        tone: "warn",
        text: `«${fromBranch.label}» filiali o‘chmaydi — mudirsiz holda ${fromBranch.coordinatorName ? `${fromBranch.coordinatorName}da` : "koordinatorda"} qoladi. Keyin yangi mudir qo‘yasiz.`,
      });
    }
    steps.push({
      tone: "ok",
      text: "Login, parol, Face ID, davomat va oylik tarixi o‘zgarmaydi. Filial jamoasi, QR va smenalar joyida qoladi.",
    });
    return steps;
  }, [person, target, role, fromBranch, occupant, displaced, personIsMudir, branchById]);

  const validationError = (() => {
    if (!person) return "Kimni ko‘chirishni tanlang";
    if (!target) return "Qaysi filialga o‘tkazishni tanlang";
    if (noChange) return "Xodim allaqachon shu filialda shu lavozimda";
    if (occupant && !displaced) return `${occupant.fullName} uchun yangi joyni tanlang`;
    return "";
  })();

  const submit = () => {
    if (validationError || !person || !target) {
      setError(validationError);
      return;
    }
    setError("");
    move.mutate(
      { employeeId: person.id, targetBranchId: target.id, newOrgRole: role, displaced },
      {
        onSuccess: (data) => {
          onOpenChange(false);
          onDone(data.message);
        },
        onError: (err: Error) => setError(err.message || "Ko‘chirilmadi"),
      },
    );
  };

  const matchBranch = (b: MoveBranchOption, q: string) =>
    norm(`${filialNumberLabel(b.branchNo) ?? ""} ${b.label} ${b.coordinatorName ?? ""} ${b.mudir?.fullName ?? ""}`).includes(q);
  const matchPerson = (p: MovePersonOption, q: string) => {
    const b = p.branchId != null ? branchById.get(p.branchId) : null;
    return norm(`${p.fullName} ${b?.label ?? ""}`).includes(q);
  };

  const renderBranch = (b: MoveBranchOption) => (
    <>
      <span className="flex items-center font-medium text-foreground">
        <BranchNo no={b.branchNo} />
        <span className="truncate">{b.label}</span>
      </span>
      <span className="mt-0.5 block text-[11px] text-muted-foreground">
        {b.coordinatorName ? `${b.coordinatorName} · ` : ""}
        {b.mudir ? (
          `Mudir: ${b.mudir.fullName}`
        ) : (
          <span className="font-semibold text-amber-700 dark:text-amber-400">Mudir yo‘q</span>
        )}
      </span>
    </>
  );

  const renderPerson = (p: MovePersonOption) => {
    const b = p.branchId != null ? branchById.get(p.branchId) : null;
    return (
      <>
        <span className="block truncate font-medium text-foreground">{p.fullName}</span>
        <span className="mt-0.5 block text-[11px] text-muted-foreground">
          {ROLE_LABEL[p.orgRole]}
          {b ? ` · ${b.label}` : ""}
        </span>
      </>
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !move.isPending && onOpenChange(o)}>
      <DialogContent className="flex max-h-[92vh] w-[calc(100%-1.25rem)] max-w-lg flex-col overflow-hidden p-0">
        <DialogHeader className="border-b border-border px-5 pb-3 pt-5">
          <DialogTitle className="flex items-center gap-2">
            <Shuffle className="h-4 w-4 text-sky-700" />
            Xodimni ko‘chirish / lavozimini almashtirish
          </DialogTitle>
          <DialogDescription>
            Mudir, farmasevt yoki stajyorni boshqa filialga yoki boshqa lavozimga o‘tkazing. Mudir ketgan
            filial hech qachon o‘chmaydi — bo‘sh holda koordinatorda qoladi.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <section className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">1. Kimni?</Label>
            {person && !pickPerson ? (
              <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/50 px-3 py-2">
                <UserRound className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1 text-sm">{renderPerson(person)}</div>
                <Button type="button" size="sm" variant="ghost" onClick={() => setPickPerson(true)}>
                  O‘zgartirish
                </Button>
              </div>
            ) : (
              <SearchList
                items={people}
                selectedId={personId}
                onSelect={(id) => {
                  setPersonId(id);
                  setPickPerson(false);
                  const p = people.find((x) => x.id === id);
                  if (p && initialRole == null) setRole(p.orgRole === "intern" ? "intern" : "pharmacist");
                }}
                placeholder="Ism yoki filial bo‘yicha qidiring"
                match={matchPerson}
                render={renderPerson}
                emptyText="Xodim topilmadi"
              />
            )}
          </section>

          <section className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">2. Qaysi filialga?</Label>
            {target && !pickBranch ? (
              <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/50 px-3 py-2">
                <MapPin className="h-4 w-4 shrink-0 text-sky-700" />
                <div className="min-w-0 flex-1 text-sm">{renderBranch(target)}</div>
                <Button type="button" size="sm" variant="ghost" onClick={() => setPickBranch(true)}>
                  O‘zgartirish
                </Button>
              </div>
            ) : (
              <SearchList
                items={branches}
                selectedId={targetId}
                onSelect={(id) => {
                  setTargetId(id);
                  setPickBranch(false);
                }}
                placeholder="Filial nomi, raqami yoki koordinator"
                match={matchBranch}
                render={renderBranch}
                emptyText="Filial topilmadi"
              />
            )}
            {person && fromBranch && target?.id === fromBranch.id ? (
              <p className="text-[11px] text-muted-foreground">Shu filialning o‘zida faqat lavozim almashadi.</p>
            ) : null}
          </section>

          <section className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">3. Kim bo‘lib?</Label>
            <RolePicker value={role} onChange={setRole} />
          </section>

          {occupant && target ? (
            <section className="space-y-2 rounded-lg border border-amber-300 bg-amber-50/70 p-3 dark:border-amber-500/40 dark:bg-amber-950/30">
              <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                «{target.label}» filialida mudir bor: {occupant.fullName}
              </p>
              <p className="text-xs text-amber-800 dark:text-amber-300">
                Bir filialda bitta mudir bo‘ladi. {occupant.fullName}ni qayerga, kim qilib o‘tkazamiz?
              </p>
              <div className="space-y-1.5">
                {canSwap && fromBranch ? (
                  <ModeOption
                    checked={mode === "swap"}
                    onSelect={() => setMode("swap")}
                    title={`O‘rin almashish — «${fromBranch.label}»ga mudir`}
                    hint={`${person?.fullName} ketayotgan filialga mudir bo‘ladi`}
                  />
                ) : null}
                <ModeOption
                  checked={mode === "stay_pharmacist"}
                  onSelect={() => setMode("stay_pharmacist")}
                  title="Shu filialda farmasevt bo‘lib qoladi"
                />
                <ModeOption
                  checked={mode === "stay_intern"}
                  onSelect={() => setMode("stay_intern")}
                  title="Shu filialda stajyor bo‘lib qoladi"
                />
                <ModeOption
                  checked={mode === "other"}
                  onSelect={() => setMode("other")}
                  title="Boshqa filialga o‘tkazish"
                  hint="Filial va lavozimni o‘zingiz tanlaysiz"
                />
              </div>
              {mode === "other" ? (
                <div className="space-y-2 pt-1">
                  <SearchList
                    items={otherBranches}
                    selectedId={otherId}
                    onSelect={setOtherId}
                    placeholder={`${occupant.fullName} qaysi filialga?`}
                    match={matchBranch}
                    render={renderBranch}
                    emptyText="Filial topilmadi"
                  />
                  <RolePicker
                    value={otherRole}
                    onChange={setOtherRole}
                    disabled={otherMudirBlocked ? { manager: "U yerda mudir bor" } : undefined}
                  />
                </div>
              ) : null}
            </section>
          ) : null}

          {plan.length ? (
            <section className="space-y-1.5 rounded-lg border border-border bg-card p-3">
              <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <Info className="h-3.5 w-3.5" />
                Nima bo‘ladi
              </p>
              <ul className="space-y-1.5">
                {plan.map((s, i) => (
                  <li
                    key={i}
                    className={cn(
                      "flex items-start gap-2 text-[13px] leading-snug",
                      s.tone === "warn" && "text-amber-800 dark:text-amber-300",
                      s.tone === "ok" && "text-emerald-700 dark:text-emerald-400",
                    )}
                  >
                    {s.tone === "main" ? (
                      <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-600" />
                    ) : s.tone === "warn" ? (
                      <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    ) : (
                      <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    )}
                    <span>{s.text}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {error ? <p className="text-sm font-medium text-rose-600">{error}</p> : null}
        </div>

        <DialogFooter className="border-t border-border px-5 py-3">
          <Button type="button" variant="outline" disabled={move.isPending} onClick={() => onOpenChange(false)}>
            Bekor
          </Button>
          <Button type="button" disabled={move.isPending || !!validationError} onClick={submit}>
            {move.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
            {move.isPending ? "Ko‘chirilmoqda…" : "Tasdiqlash"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ModeOption({
  checked,
  onSelect,
  title,
  hint,
}: {
  checked: boolean;
  onSelect: () => void;
  title: string;
  hint?: string;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-2 rounded-md border bg-card px-2.5 py-2 text-sm",
        checked ? "border-amber-500 ring-1 ring-amber-400" : "border-amber-200 dark:border-amber-500/30",
      )}
    >
      <input type="radio" className="mt-1" checked={checked} onChange={onSelect} />
      <span>
        <span className="font-medium text-foreground">{title}</span>
        {hint ? <span className="mt-0.5 block text-[11px] text-muted-foreground">{hint}</span> : null}
      </span>
    </label>
  );
}
