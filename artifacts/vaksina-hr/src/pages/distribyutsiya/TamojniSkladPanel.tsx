import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, MapPin, Plus, UserPlus, Warehouse } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PhoneInput } from "@/components/ui/phone-input";
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
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { isOptionalUzPhoneValid, normalizeUzPhone, UZ_PHONE_HINT } from "@/lib/phone";
import { canManageTamojni, isHrRole, userRoleLabel } from "@/lib/roles";
import { VerifiedName } from "@/components/VerifiedBadge";
import { gpsInputError, parseGpsText } from "@/lib/pharmacy-staff-api";
import { useTamojniDesk, useTamojniMutations, type TamojniStaffRow } from "@/lib/distribyutsiya-api";
import { DavomatSitePicker } from "./DavomatSitePicker";

const TAMOJNI_RADIUS_M = 150;

const SHIFTS = [
  { key: "office", label: "Kunduzgi", start: "09:00", end: "18:00" },
  { key: "one", label: "1-smena", start: "08:00", end: "17:00" },
  { key: "two", label: "2-smena", start: "17:00", end: "23:45" },
  { key: "three", label: "3-smena", start: "23:00", end: "07:00" },
] as const;

const SHIFT_ORDER = ["office", "one", "two", "three"] as const;

/** Ketdim bosilmasa kun «kelmagan» deb yopiladi */
function ketdimRule(shiftKey: string): string {
  if (shiftKey === "two") {
    return "Ketdim ertasi kun soat 02:00 gacha. 23:55 bu smenaga tegishli emas. Shu vaqtgacha Ketdim bo‘lmasa, bu kun kelmagan deb yopiladi.";
  }
  if (shiftKey === "three") {
    return "Ketdim ertalab soat 10:00 gacha. Shu vaqtgacha Ketdim bo‘lmasa, bu kun kelmagan deb yopiladi.";
  }
  return "Ketdim shu kun soat 23:55 gacha. Shu vaqtgacha Ketdim bo‘lmasa, bu kun kelmagan deb yopiladi.";
}

export function TamojniSkladPanel() {
  const { toast } = useToast();
  const { user } = useAuth();
  const desk = useTamojniDesk(true);
  const mut = useTamojniMutations();
  const canManage = Boolean(
    desk.data?.canManage ||
      user?.role === "admin" ||
      user?.role === "director" ||
      user?.role === "asoschi" ||
      user?.role === "distrib_hr" ||
      user?.role === "distrib_rahbar" ||
      user?.role === "tamojni_rahbar" ||
      isHrRole(user?.role) ||
      canManageTamojni(user?.role),
  );

  const [name, setName] = useState("");
  const [gps, setGps] = useState("");
  const [locating, setLocating] = useState(false);

  const [addOpen, setAddOpen] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [position, setPosition] = useState("");
  const [role, setRole] = useState("tamojni");
  const [shiftFilter, setShiftFilter] = useState("all");
  const [created, setCreated] = useState<{ login: string; temporaryPassword: string; fullName: string } | null>(null);

  useEffect(() => {
    const site = desk.data?.site;
    if (!site) return;
    setName(site.name);
    setGps(`${site.latitude}, ${site.longitude}`);
  }, [desk.data?.site]);

  const useHere = () => {
    if (!navigator.geolocation) {
      toast({ title: "Brauzer lokatsiyani bermayapti", variant: "destructive" });
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGps(`${pos.coords.latitude}, ${pos.coords.longitude}`);
        setLocating(false);
        if (!name.trim()) setName("Tamojni sklad");
      },
      () => {
        setLocating(false);
        toast({ title: "Lokatsiya olinmadi", description: "Ruxsat bering yoki koordinatani qo‘lda yozing", variant: "destructive" });
      },
      { enableHighAccuracy: true, timeout: 12000 },
    );
  };

  const saveSite = () => {
    if (name.trim().length < 2) {
      toast({ title: "Joy nomini kiriting", variant: "destructive" });
      return;
    }
    const gpsError = gpsInputError(gps);
    const point = parseGpsText(gps);
    if (gpsError || !point) {
      toast({
        title: "Koordinata noto‘g‘ri",
        description: gpsError || `Google Mapsdan nusxa qiling: 41.311081, 69.279737`,
        variant: "destructive",
      });
      return;
    }
    mut.saveSite.mutate(
      { name: name.trim(), latitude: point.lat, longitude: point.lng, radiusM: TAMOJNI_RADIUS_M },
      {
        onSuccess: () =>
          toast({
            title: "🟢 Kiritildi!",
            description: `Tamojni sklad lokatsiyasi muvaffaqiyatli saqlandi. Davomat shu nuqtadan ${TAMOJNI_RADIUS_M} metr ichida ishlaydi.`,
            className: "border-emerald-500 bg-emerald-50 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100",
          }),
        onError: (e: Error) => toast({ title: "Saqlanmadi", description: e.message, variant: "destructive" }),
      },
    );
  };

  const submitStaff = () => {
    if (!firstName.trim() || !lastName.trim()) {
      toast({ title: "Ism va familiya kiriting", variant: "destructive" });
      return;
    }
    if (!isOptionalUzPhoneValid(phone)) {
      toast({ title: UZ_PHONE_HINT, variant: "destructive" });
      return;
    }
    mut.createStaff.mutate(
      {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        phone: normalizeUzPhone(phone) || undefined,
        position: position.trim() || undefined,
        role,
      },
      {
        onSuccess: (data) => {
          setCreated({ login: data.login, temporaryPassword: data.temporaryPassword, fullName: data.fullName });
          toast({ title: "Qo‘shildi", description: data.message });
        },
        onError: (e: Error) => toast({ title: "Qo‘shilmadi", description: e.message, variant: "destructive" }),
      },
    );
  };

  if (desk.isLoading) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Tamojni sklad yuklanmoqda
      </div>
    );
  }

  const staff = desk.data?.staff || [];
  const creatable = desk.data?.creatableRoles || [];
  const site = desk.data?.site;

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-5">
        <div className="mb-3 flex items-start gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-500/10 text-sky-700">
            <MapPin className="h-5 w-5" />
          </span>
          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold">Davomat joyi</h2>
              {site ? (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300 bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                  Kiritildi
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800 dark:border-amber-700 dark:bg-amber-950/60 dark:text-amber-300">
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                  Hali kiritilmagan
                </span>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              Google Mapsdan koordinatani nusxa qilib qo‘ying. Saqlangach davomat shu nuqtadan 150 metr ichida ishlaydi.
            </p>
          </div>
        </div>
        <div className="grid gap-3">
          <div className="space-y-1.5">
            <Label>Joy nomi</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Masalan: Tamojni sklad" disabled={!canManage} />
          </div>
          <div className="space-y-1.5">
            <Label>Koordinata (GPS)</Label>
            <textarea
              value={gps}
              onChange={(e) => setGps(e.target.value)}
              placeholder={'41.311081, 69.279737'}
              rows={2}
              disabled={!canManage}
              className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 font-mono text-sm leading-snug disabled:opacity-60"
            />
            <p className="text-[11px] leading-snug text-muted-foreground">
              Google Maps dan nusxa. 41.311081, 69.279737 yoki 41°18'23.3"N 69°18'28.0"E. Saqlangach radius 150 metr.
            </p>
          </div>
        </div>
        {canManage ? (
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" variant="secondary" className="rounded-xl" onClick={useHere} disabled={locating}>
              {locating ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <MapPin className="mr-1.5 h-4 w-4" />}
              Shu joyim
            </Button>
            <Button type="button" className="rounded-xl" onClick={saveSite} disabled={mut.saveSite.isPending}>
              {mut.saveSite.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
              Joyni saqlash
            </Button>
          </div>
        ) : null}
        {site ? (
          <div className="mt-4 rounded-xl border border-emerald-300 bg-emerald-50/90 p-4 text-sm text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2 py-0.5 text-xs font-bold text-white shadow-sm">
                    ✓ Kiritildi
                  </span>
                  <span className="font-semibold text-emerald-900 dark:text-emerald-200">
                    Davomat joyi faol: {site.name}
                  </span>
                </div>
                <p className="text-xs leading-relaxed text-emerald-800 dark:text-emerald-300">
                  Koordinata: <span className="font-mono font-bold text-emerald-950 dark:text-emerald-100">{site.latitude}, {site.longitude}</span> · Radius: <strong>{site.radiusM || TAMOJNI_RADIUS_M} metr</strong>.
                </p>
                <p className="text-xs text-emerald-700 dark:text-emerald-400">
                  Bo‘lim boshlig‘i va xodimlar aynan shu joydan bemalol davomat qila oladi. Davomatda ularga filial/joy nomi sifatida faqat <strong>«{site.name}»</strong> ko‘rinadi.
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50/90 p-4 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
              <div className="space-y-1">
                <span className="inline-flex items-center gap-1 rounded-md bg-amber-600 px-2 py-0.5 text-xs font-bold text-white shadow-sm">
                  ! Kiritilmagan
                </span>
                <p className="text-xs text-amber-800 dark:text-amber-300">
                  Joy kiritilmaguncha bo‘lim boshlig‘i va xodimlar davomat qila olmaydi. Yuqoriga koordinatani kiritib <strong>«Joyni saqlash»</strong> tugmasini bosing.
                </p>
              </div>
            </div>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-sky-200 bg-sky-50/70 p-4 text-sm leading-relaxed text-sky-950 shadow-sm sm:p-5">
        <h2 className="text-base font-semibold">Smena va Ketdim muddati</h2>
        <p className="mt-1 text-sky-900/80">
          Smenani belgilash va vaqtini o‘zgartirish — Distribyutsiya HR va bo‘lim boshlig‘i. Har bir xodimning smenasi alohida saqlanadi.
        </p>
        <ul className="mt-3 space-y-2">
          {SHIFTS.map((s) => (
            <li key={s.key} className="rounded-xl bg-white/80 px-3 py-2">
              <p className="font-medium">
                {s.label} · {s.start}–{s.end}
              </p>
              <p className="mt-0.5 text-xs text-sky-900/80">{ketdimRule(s.key)}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Warehouse className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-base font-semibold">Xodimlar · {staff.length}</h2>
          </div>
          {canManage && creatable.length > 0 ? (
            <Button
              type="button"
              className="rounded-xl"
              onClick={() => {
                setCreated(null);
                setFirstName("");
                setLastName("");
                setPhone("");
                setPosition("");
                setRole(creatable.includes("tamojni") ? "tamojni" : creatable[0] || "tamojni");
                setAddOpen(true);
              }}
            >
              <Plus className="mr-1.5 h-4 w-4" />
              Xodim qo‘shish
            </Button>
          ) : null}
        </div>
        {staff.length === 0 ? (
          <p className="text-sm text-muted-foreground">Hali xodim yo‘q. Xodimlarni HR yoki Distribyutsiya rahbari qo‘shadi.</p>
        ) : (
          <>
            <div className="mb-3 flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => setShiftFilter("all")}
                className={`rounded-full border px-3 py-1 text-xs font-medium ${shiftFilter === "all" ? "border-sky-700 bg-sky-700 text-white" : "border-border bg-background"}`}
              >
                Hammasi · {staff.length}
              </button>
              {SHIFTS.map((s) => {
                const count = staff.filter((row) => (row.shiftKey || "office") === s.key).length;
                const active = shiftFilter === s.key;
                return (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => setShiftFilter(s.key)}
                    className={`rounded-full border px-3 py-1 text-xs font-medium ${active ? "border-sky-700 bg-sky-700 text-white" : "border-border bg-background"}`}
                  >
                    {s.label} · {count}
                  </button>
                );
              })}
            </div>
            <div className="space-y-3">
              {[...staff]
                .filter((row) => shiftFilter === "all" || (row.shiftKey || "office") === shiftFilter)
                .sort((a, b) => {
                  const ai = SHIFT_ORDER.indexOf((a.shiftKey || "office") as (typeof SHIFT_ORDER)[number]);
                  const bi = SHIFT_ORDER.indexOf((b.shiftKey || "office") as (typeof SHIFT_ORDER)[number]);
                  if (ai !== bi) return ai - bi;
                  return a.fullName.localeCompare(b.fullName, "uz");
                })
                .map((row) => (
                  <StaffShiftRow
                    key={row.userId}
                    row={row}
                    canManage={canManage}
                    canChangeSite={Boolean(desk.data?.canChangeSite)}
                  />
                ))}
            </div>
          </>
        )}
      </section>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="h-4 w-4" />
              Tamojni sklad xodimi
            </DialogTitle>
            <DialogDescription>Login va vaqtinchalik parol yaratiladi. Davomat va topshiriqlar shu hisobda ochiladi.</DialogDescription>
          </DialogHeader>
          {created ? (
            <div className="space-y-2 rounded-xl bg-muted/50 p-3 text-sm">
              <p className="font-medium">{created.fullName}</p>
              <p>Login: <span className="font-mono">{created.login}</span></p>
              <p>Parol: <span className="font-mono">{created.temporaryPassword}</span></p>
            </div>
          ) : (
            <div className="grid gap-3">
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <Label>Familiya</Label>
                  <Input value={lastName} onChange={(e) => setLastName(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Ism</Label>
                  <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Lavozim</Label>
                <Input value={position} onChange={(e) => setPosition(e.target.value)} placeholder="Operator, yuk tushiruvchi…" />
              </div>
              <div className="space-y-1.5">
                <Label>Telefon</Label>
                <PhoneInput value={phone} onChange={setPhone} />
              </div>
              {creatable.length > 1 ? (
                <div className="space-y-1.5">
                  <Label>Rol</Label>
                  <Select value={role} onValueChange={setRole}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {creatable.map((r) => (
                        <SelectItem key={r} value={r}>
                          {userRoleLabel(r)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
            </div>
          )}
          <DialogFooter>
            {created ? (
              <Button type="button" className="rounded-xl" onClick={() => setAddOpen(false)}>
                Yopish
              </Button>
            ) : (
              <Button type="button" className="rounded-xl" onClick={submitStaff} disabled={mut.createStaff.isPending}>
                {mut.createStaff.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
                Qo‘shish
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StaffShiftRow({
  row,
  canManage,
  canChangeSite,
}: {
  row: TamojniStaffRow;
  canManage: boolean;
  canChangeSite: boolean;
}) {
  const { toast } = useToast();
  const mut = useTamojniMutations();
  const [shiftKey, setShiftKey] = useState(row.shiftKey || "office");
  const [startHm, setStartHm] = useState(row.startHm || "09:00");
  const [endHm, setEndHm] = useState(row.endHm || "18:00");

  useEffect(() => {
    setShiftKey(row.shiftKey || "office");
    setStartHm(row.startHm || "09:00");
    setEndHm(row.endHm || "18:00");
  }, [row.shiftKey, row.startHm, row.endHm]);

  const onShift = (key: string) => {
    const preset = SHIFTS.find((s) => s.key === key);
    setShiftKey(key);
    if (preset) {
      setStartHm(preset.start);
      setEndHm(preset.end);
    }
  };

  const save = () => {
    if (!row.employeeId) {
      toast({ title: "Xodim kartasi yo‘q", variant: "destructive" });
      return;
    }
    mut.saveShift.mutate(
      { employeeId: row.employeeId, shiftKey, startHm, endHm },
      {
        onSuccess: (data) => toast({ title: "Smena saqlandi", description: data.shiftTitle }),
        onError: (e: Error) => toast({ title: "Smena saqlanmadi", description: e.message, variant: "destructive" }),
      },
    );
  };

  return (
    <div className="rounded-xl border border-border p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <VerifiedName name={row.fullName} role={row.role} userId={row.userId} className="flex font-medium" />
          <p className="text-xs text-muted-foreground">
            {row.position || "—"} · {userRoleLabel(row.role)} · {row.login}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-sky-700">{row.shiftTitle}</span>
            <span className="text-[11px] text-muted-foreground">Davomat joyi:</span>
            <DavomatSitePicker
              userId={row.userId}
              fullName={row.fullName}
              value={row.davomatSite}
              canChange={canChangeSite}
            />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{ketdimRule(shiftKey)}</p>
        </div>
      </div>
      {canManage && row.employeeId ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-[1.2fr_0.7fr_0.7fr_auto] sm:items-end">
          <div className="space-y-1">
            <Label className="text-xs">Smena</Label>
            <Select value={shiftKey} onValueChange={onShift}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SHIFTS.map((s) => (
                  <SelectItem key={s.key} value={s.key}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Kelish</Label>
            <Input value={startHm} onChange={(e) => setStartHm(e.target.value)} placeholder="09:00" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Ketish</Label>
            <Input value={endHm} onChange={(e) => setEndHm(e.target.value)} placeholder="18:00" />
          </div>
          <Button type="button" variant="secondary" className="rounded-xl" onClick={save} disabled={mut.saveShift.isPending}>
            Saqlash
          </Button>
        </div>
      ) : null}
    </div>
  );
}
