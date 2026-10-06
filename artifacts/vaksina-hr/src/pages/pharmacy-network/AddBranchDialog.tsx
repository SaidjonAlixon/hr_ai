import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PhoneInput } from "@/components/ui/phone-input";
import { isCompleteUzPhone, normalizeUzPhone, UZ_PHONE_HINT } from "@/lib/phone";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  gpsInputError,
  parseGpsText,
  useBranchInputCheck,
  type ActiveBranchInfo,
  type BranchAccount,
  type BranchInputCheck,
} from "@/lib/pharmacy-staff-api";
import { cn } from "@/lib/utils";

function holderText(h: ActiveBranchInfo): string {
  const parts = [h.mudirName ? `mudir: ${h.mudirName}` : "mudiri yo‘q"];
  if (h.coordinatorName) parts.push(`koordinator: ${h.coordinatorName}`);
  return parts.join(" · ");
}

type Person = { firstName: string; lastName: string; phone: string };
type Extra = Person & { key: string; role: "farmasevt" | "stajyor" };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  coordinators: Array<{ id: number; fullName: string }>;
  pending: boolean;
  onSubmit: (payload: {
    coordinatorEmployeeId: number;
    branchName: string;
    branchNo: number;
    coordinates: string;
    mudir: Person;
    staff: Array<{ role: "farmasevt" | "stajyor"; firstName: string; lastName: string; phone: string }>;
  }) => void;
  created: { branchName: string; coordinatorName: string; accounts: BranchAccount[] } | null;
};

const emptyPerson = (): Person => ({ firstName: "", lastName: "", phone: "" });

function BranchInputHints({
  branchNo,
  branchName,
  data,
  noInfo,
  loading,
  onPickNo,
  onPickName,
}: {
  branchNo: string;
  branchName: string;
  data: BranchInputCheck | null;
  noInfo: BranchInputCheck["no"];
  loading: boolean;
  onPickNo: (n: number) => void;
  onPickName: (name: string) => void;
}) {
  const typedNo = branchNo.trim();
  const sameName = (data?.sameName ?? []).filter((b) => b.employeeId !== noInfo?.holder?.employeeId);
  const catalogNo = data?.catalogNoForName ?? null;
  const showCatalogNo =
    catalogNo != null &&
    (typedNo === "" || Number(typedNo) !== catalogNo) &&
    !(data?.sameName ?? []).some((b) => b.branchNo === catalogNo);

  const pickBtn = (label: string, onClick: () => void) => (
    <button
      type="button"
      onClick={onClick}
      className="ml-1 rounded-md bg-background px-1.5 py-0.5 text-[11px] font-semibold text-primary ring-1 ring-inset ring-primary/30 hover:bg-primary/10"
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-1.5 text-[11px] leading-snug">
      {loading ? (
        <p className="flex items-center gap-1 text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> Tekshirilmoqda…
        </p>
      ) : null}

      {typedNo === "" ? (
        <p className="text-muted-foreground">
          Raqam nomdan oldin turadi. Asosiy filial uchun 0.
          {data ? (
            <>
              {" "}Keyingi bo‘sh raqam: <b>№{data.nextFreeNo}</b>
              {pickBtn("Qo‘yish", () => onPickNo(data.nextFreeNo))}
            </>
          ) : null}
        </p>
      ) : noInfo?.holder ? (
        <div className="rounded-lg border border-rose-300 bg-rose-50 px-2.5 py-2 text-rose-900 dark:border-rose-500/40 dark:bg-rose-950/40 dark:text-rose-200">
          <p className="flex items-start gap-1.5 font-semibold">
            <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
            {noInfo.label} band — «{noInfo.holder.branchName}»
          </p>
          <p className="mt-0.5 pl-5">{holderText(noInfo.holder)}</p>
          <p className="mt-1 pl-5">
            Bu filial allaqachon bor. Yangi filial uchun boshqa raqam yozing
            {data ? (
              <>
                {" "}— bo‘sh: <b>№{data.nextFreeNo}</b>
                {pickBtn(`№${data.nextFreeNo} qo‘yish`, () => onPickNo(data.nextFreeNo))}
              </>
            ) : null}
          </p>
        </div>
      ) : noInfo ? (
        <div className="rounded-lg border border-emerald-300 bg-emerald-50 px-2.5 py-2 text-emerald-900 dark:border-emerald-500/40 dark:bg-emerald-950/40 dark:text-emerald-200">
          <p className="flex items-start gap-1.5 font-semibold">
            <CheckCircle2 className="mt-px h-3.5 w-3.5 shrink-0" />
            {noInfo.label} bo‘sh — shu raqam bilan yangi filial ochiladi
          </p>
          {noInfo.catalogName ? (
            <p className="mt-0.5 pl-5">
              Rasmiy ro‘yxatda {noInfo.label}: «{noInfo.catalogName}»
              {branchName.trim() === "" ? pickBtn("Nomini qo‘yish", () => onPickName(noInfo.catalogName!)) : null}
            </p>
          ) : null}
        </div>
      ) : null}

      {sameName.length ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-2 text-amber-900 dark:border-amber-500/40 dark:bg-amber-950/40 dark:text-amber-200">
          <p className="flex items-start gap-1.5 font-semibold">
            <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
            Bu nomli filial allaqachon bor
          </p>
          <ul className="mt-0.5 space-y-0.5 pl-5">
            {sameName.slice(0, 3).map((b) => (
              <li key={b.employeeId}>
                «{b.branchName}»{b.branchNo != null ? ` №${b.branchNo}` : " (raqamsiz)"} · {holderText(b)}
              </li>
            ))}
          </ul>
          <p className="mt-1 pl-5">Ikkinchi nusxa ochmang — mavjud filialga mudir yoki xodim qo‘shing.</p>
        </div>
      ) : null}

      {showCatalogNo ? (
        <p className="text-muted-foreground">
          Rasmiy ro‘yxat bo‘yicha bu filial raqami: <b>№{catalogNo}</b>
          {pickBtn(`№${catalogNo} qo‘yish`, () => onPickNo(catalogNo!))}
        </p>
      ) : null}
    </div>
  );
}

export function AddBranchDialog({ open, onOpenChange, coordinators, pending, onSubmit, created }: Props) {
  const [coordinatorId, setCoordinatorId] = useState("");
  const [branchNo, setBranchNo] = useState("");
  const [branchName, setBranchName] = useState("");
  const [coordinates, setCoordinates] = useState("");
  const [mudir, setMudir] = useState<Person>(emptyPerson);
  const [staff, setStaff] = useState<Extra[]>([]);
  const [error, setError] = useState("");
  const [debouncedNo, setDebouncedNo] = useState("");
  const [debouncedName, setDebouncedName] = useState("");

  useEffect(() => {
    const t = window.setTimeout(() => {
      setDebouncedNo(branchNo.trim());
      setDebouncedName(branchName.trim());
    }, 350);
    return () => window.clearTimeout(t);
  }, [branchNo, branchName]);

  const check = useBranchInputCheck(debouncedNo, debouncedName, open && !created);
  const checkData = check.data;
  const checkFresh = debouncedNo === branchNo.trim() && debouncedName === branchName.trim() && !check.isFetching;
  const noInfo = checkData?.no && String(checkData.no.value) === String(Number(branchNo.trim())) ? checkData.no : null;
  const noTaken = !!noInfo?.holder;

  const reset = () => {
    setCoordinatorId("");
    setBranchNo("");
    setBranchName("");
    setCoordinates("");
    setMudir(emptyPerson());
    setStaff([]);
    setError("");
  };

  const submit = () => {
    if (!coordinatorId) {
      setError("Koordinatorni tanlang");
      return;
    }
    const no = Number(branchNo.trim());
    if (!Number.isInteger(no) || no < 0 || no > 999) {
      setError("Filial raqamini kiriting. Asosiy filial uchun 0");
      return;
    }
    if (noTaken && noInfo?.holder) {
      setError(
        `${noInfo.label} band — «${noInfo.holder.branchName}». Boshqa raqam yozing (bo‘sh: ${checkData?.nextFreeNo ?? "—"})`,
      );
      return;
    }
    if (branchName.trim().length < 2) {
      setError("Filial nomini kiriting");
      return;
    }
    const gpsError = gpsInputError(coordinates);
    if (gpsError || !parseGpsText(coordinates)) {
      setError(gpsError || "Koordinata noto‘g‘ri");
      return;
    }
    if (!mudir.firstName.trim() || !mudir.lastName.trim()) {
      setError("Zavedushi ismi va familiyasini kiriting");
      return;
    }
    if (!isCompleteUzPhone(mudir.phone)) {
      setError(`Zavedushi telefoni: ${UZ_PHONE_HINT}`);
      return;
    }
    for (const row of staff) {
      if (!row.firstName.trim() || !row.lastName.trim()) {
        setError("Qo‘shilgan xodimning ismi va familiyasi to‘liq bo‘lsin");
        return;
      }
      if (!isCompleteUzPhone(row.phone)) {
        setError(`Xodim telefoni: ${UZ_PHONE_HINT}`);
        return;
      }
    }
    setError("");
    onSubmit({
      coordinatorEmployeeId: Number(coordinatorId),
      branchName: branchName.trim(),
      branchNo: Number(branchNo.trim()),
      coordinates: coordinates.trim(),
      mudir: {
        firstName: mudir.firstName.trim(),
        lastName: mudir.lastName.trim(),
        phone: normalizeUzPhone(mudir.phone),
      },
      staff: staff.map((s) => ({
        role: s.role,
        firstName: s.firstName.trim(),
        lastName: s.lastName.trim(),
        phone: normalizeUzPhone(s.phone),
      })),
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[90vh] w-[calc(100%-1.25rem)] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{created ? "Filial qo‘shildi" : "Filial qo‘shish"}</DialogTitle>
          <DialogDescription>
            {created
              ? "Login va parolni saqlab oling. Filial xarita, davomat va botda ko‘rinadi."
              : "Koordinatorni tanlang, filial nomi va koordinatasini yozing, zavedushi va kerak bo‘lsa jamoani qo‘shing."}
          </DialogDescription>
        </DialogHeader>

        {created ? (
          <ul className="space-y-2">
            <li className="rounded-xl border border-border bg-muted/30 px-3 py-2 text-sm">
              <span className="font-semibold">{created.branchName}</span>
              <span className="text-muted-foreground"> · {created.coordinatorName}</span>
            </li>
            {created.accounts.map((a) => (
              <li key={a.employeeId} className="rounded-xl border border-border px-3 py-2 text-sm">
                <p className="font-semibold">
                  {a.fullName}{" "}
                  <span className="text-xs font-medium uppercase text-muted-foreground">
                    {a.role === "mudir" ? "Zavedushi" : a.role === "farmasevt" ? "Farmasevt" : "Stajyor"}
                  </span>
                </p>
                <p className="mt-1 font-mono text-xs">
                  {a.login} · {a.temporaryPassword}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Koordinator</Label>
              <Select value={coordinatorId} onValueChange={setCoordinatorId}>
                <SelectTrigger>
                  <SelectValue placeholder="Koordinatorni tanlang" />
                </SelectTrigger>
                <SelectContent>
                  {coordinators.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.fullName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Filial raqami va nomi</Label>
              <div className="flex items-center gap-2">
                <span className="inline-flex h-10 min-w-[4.5rem] shrink-0 items-center justify-center rounded-md bg-rose-600 px-2 text-sm font-bold text-white">
                  {Number.isInteger(Number(branchNo)) && branchNo.trim() !== "" && Number(branchNo) >= 0
                    ? Number(branchNo) === 0
                      ? "Asosiy"
                      : `№${Number(branchNo)}`
                    : "№"}
                </span>
                <Input
                  value={branchNo}
                  onChange={(e) => {
                    setBranchNo(e.target.value.replace(/[^\d]/g, "").slice(0, 3));
                    setError("");
                  }}
                  inputMode="numeric"
                  placeholder={checkData ? String(checkData.nextFreeNo) : "12"}
                  className={cn(
                    "w-20 shrink-0 text-center font-semibold",
                    noTaken && "border-rose-500 focus-visible:ring-rose-500",
                    noInfo && !noTaken && "border-emerald-500 focus-visible:ring-emerald-500",
                  )}
                  aria-label="Filial raqami"
                  aria-invalid={noTaken}
                />
                <Input
                  value={branchName}
                  onChange={(e) => setBranchName(e.target.value)}
                  placeholder="Filial nomi, yozilganidek"
                  className="min-w-0 flex-1"
                />
              </div>
              <BranchInputHints
                branchNo={branchNo}
                branchName={branchName}
                data={checkData ?? null}
                noInfo={noInfo}
                loading={!checkFresh && (branchNo.trim() !== "" || branchName.trim().length >= 2)}
                onPickNo={(n) => {
                  setBranchNo(String(n));
                  setError("");
                }}
                onPickName={(name) => setBranchName(name)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Koordinata (GPS)</Label>
              <textarea
                value={coordinates}
                onChange={(e) => setCoordinates(e.target.value)}
                rows={2}
                placeholder={'41.311081, 69.279737'}
                className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 font-mono text-sm"
              />
              <p className="text-[11px] text-muted-foreground">
                Google Maps dan nusxa. 41.311081, 69.279737 yoki 41°18'23.3"N 69°18'28.0"E
              </p>
            </div>
            <div className="space-y-2 rounded-xl border border-border p-3">
              <p className="text-sm font-semibold">Zavedushi</p>
              <div className="grid grid-cols-2 gap-2">
                <Input placeholder="Familiya" value={mudir.lastName} onChange={(e) => setMudir({ ...mudir, lastName: e.target.value })} />
                <Input placeholder="Ism" value={mudir.firstName} onChange={(e) => setMudir({ ...mudir, firstName: e.target.value })} />
              </div>
              <PhoneInput value={mudir.phone} onChange={(value) => setMudir({ ...mudir, phone: value })} />
            </div>
            {staff.map((row) => (
              <div key={row.key} className="space-y-2 rounded-xl border border-border p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold">{row.role === "farmasevt" ? "Farmasevt" : "Stajyor"}</p>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8"
                    onClick={() => setStaff((list) => list.filter((s) => s.key !== row.key))}
                  >
                    <Trash2 className="h-3.5 w-3.5 text-rose-600" />
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    placeholder="Familiya"
                    value={row.lastName}
                    onChange={(e) =>
                      setStaff((list) => list.map((s) => (s.key === row.key ? { ...s, lastName: e.target.value } : s)))
                    }
                  />
                  <Input
                    placeholder="Ism"
                    value={row.firstName}
                    onChange={(e) =>
                      setStaff((list) => list.map((s) => (s.key === row.key ? { ...s, firstName: e.target.value } : s)))
                    }
                  />
                </div>
                <PhoneInput
                  value={row.phone}
                  onChange={(value) =>
                    setStaff((list) => list.map((s) => (s.key === row.key ? { ...s, phone: value } : s)))
                  }
                />
              </div>
            ))}
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                className="rounded-xl"
                onClick={() =>
                  setStaff((list) => [
                    ...list,
                    { key: `${Date.now()}-f`, role: "farmasevt", ...emptyPerson() },
                  ])
                }
              >
                <Plus className="mr-1.5 h-4 w-4" />
                Farmasevt
              </Button>
              <Button
                type="button"
                variant="outline"
                className="rounded-xl"
                onClick={() =>
                  setStaff((list) => [
                    ...list,
                    { key: `${Date.now()}-s`, role: "stajyor", ...emptyPerson() },
                  ])
                }
              >
                <Plus className="mr-1.5 h-4 w-4" />
                Stajyor
              </Button>
            </div>
            {error ? <p className="text-sm text-rose-600">{error}</p> : null}
          </div>
        )}

        <DialogFooter>
          {created ? (
            <Button type="button" onClick={() => onOpenChange(false)}>
              Yopish
            </Button>
          ) : (
            <Button type="button" onClick={submit} disabled={pending || noTaken}>
              {pending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
              Saqlash
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
