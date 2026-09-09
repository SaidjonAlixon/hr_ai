import React, { useEffect, useState } from "react";
import {
  FileSpreadsheet,
  KeyRound,
  Loader2,
  Plus,
  UserPlus,
} from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  downloadDeptStaffExcel,
  useDeptStaffMeta,
  useCreateDeptStaff,
  type DeptStaffResult,
} from "@/lib/dept-staff-api";
import { PhoneInput } from "../ui/phone-input";
import { isOptionalUzPhoneValid, normalizeUzPhone, UZ_PHONE_HINT } from "@/lib/phone";
import { StaffLoginCredsPanel } from "./StaffLoginCredsPanel";
import { cn } from "@/lib/utils";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  enabled?: boolean;
};

export function AddDeptStaffDialog({ open, onOpenChange, enabled = true }: Props) {
  const { toast } = useToast();
  const meta = useDeptStaffMeta(enabled && open);
  const create = useCreateDeptStaff();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState("");
  const [position, setPosition] = useState("");
  const [created, setCreated] = useState<DeptStaffResult | null>(null);
  const [excelBusy, setExcelBusy] = useState(false);

  const roles = meta.data?.roles ?? [];
  const singleRole = roles.length === 1 ? roles[0] : null;

  useEffect(() => {
    if (!open) return;
    const first = meta.data?.roles?.[0]?.value;
    if (first && !role) setRole(first);
  }, [open, meta.data?.roles, role]);

  const resetForm = () => {
    setFirstName("");
    setLastName("");
    setPhone("");
    setRole(meta.data?.roles?.[0]?.value || "");
    setPosition("");
    setCreated(null);
  };

  const onClose = (next: boolean) => {
    if (!next) resetForm();
    onOpenChange(next);
  };

  const downloadExcel = async () => {
    if (excelBusy) return;
    setExcelBusy(true);
    try {
      await downloadDeptStaffExcel();
      toast({ title: "Excel yuklandi", description: "Barcha xodimlar login/paroli" });
    } catch (e) {
      toast({
        title: "Excel yuklanmadi",
        description: (e as Error).message,
        variant: "destructive",
      });
    } finally {
      setExcelBusy(false);
    }
  };

  const submit = () => {
    if (!firstName.trim() || !lastName.trim()) {
      toast({ title: "Ism va familiya kiriting", variant: "destructive" });
      return;
    }
    if (!isOptionalUzPhoneValid(phone)) {
      toast({ title: UZ_PHONE_HINT, variant: "destructive" });
      return;
    }
    const staffRole = singleRole?.value || role;
    if (!staffRole) {
      toast({ title: "Rolni tanlang", variant: "destructive" });
      return;
    }
    if (!position.trim()) {
      toast({ title: "Lavozimni yozing", variant: "destructive" });
      return;
    }
    create.mutate(
      {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        phone: normalizeUzPhone(phone),
        role: staffRole,
        position: position.trim(),
      },
      {
        onSuccess: (data) => {
          setCreated(data);
          toast({ title: "Xodim qo‘shildi", description: data.message });
        },
        onError: (e: Error) => {
          toast({ title: "Qo‘shilmadi", description: e.message, variant: "destructive" });
        },
      },
    );
  };

  if (!meta.data?.canAdd && open && !meta.isLoading) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="w-[calc(100%-1.25rem)] max-w-md gap-0 overflow-hidden p-0 sm:rounded-2xl">
        <DialogHeader className="space-y-1 border-b border-border/70 bg-gradient-to-br from-primary/10 via-background to-sky-500/5 px-5 py-4 text-left">
          <DialogTitle className="flex items-center gap-2 text-base sm:text-lg">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/15 text-primary">
              {created ? <KeyRound className="h-4 w-4" /> : <UserPlus className="h-4 w-4" />}
            </span>
            {created ? "Login va parol tayyor" : "Bo‘limga xodim qo‘shish"}
          </DialogTitle>
          <DialogDescription className="text-xs sm:text-sm">
            {created
              ? "Ma’lumotlarni nusxalang yoki Excelga yuklab oling"
              : meta.data?.departmentName
                ? `${meta.data.departmentName} — login/parol avtomatik yaratiladi`
                : "Login va parol avtomatik yaratiladi"}
          </DialogDescription>
        </DialogHeader>

        <div className="px-5 py-4">
          {created ? (
            <StaffLoginCredsPanel
              fullName={created.fullName}
              subtitle={[created.departmentName, created.position].filter(Boolean).join(" · ")}
              login={created.login}
              password={created.temporaryPassword}
            />
          ) : (
            <div className="space-y-3.5">
              <div className="rounded-xl border border-sky-500/20 bg-sky-500/5 px-3 py-2.5 text-[11px] leading-relaxed text-sky-950 dark:text-sky-100">
                <p className="font-semibold">Qo‘shishdan oldin</p>
                <p className="mt-0.5 text-sky-900/80 dark:text-sky-100/80">
                  Ism, familiya, telefon va lavozimni to‘ldiring. Tizim login va vaqtinchalik parol
                  yaratadi — ularni darhol nusxalashingiz yoki Exceldan olishingiz mumkin.
                </p>
              </div>

              {meta.data?.departmentName ? (
                <p className="rounded-xl border border-primary/15 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
                  Bo‘lim:{" "}
                  <span className="font-semibold text-foreground">{meta.data.departmentName}</span>
                </p>
              ) : null}

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Ism</Label>
                  <Input
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    className="h-10 rounded-xl"
                    placeholder="Ism"
                    autoComplete="off"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Familiya</Label>
                  <Input
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    className="h-10 rounded-xl"
                    placeholder="Familiya"
                    autoComplete="off"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Telefon</Label>
                <PhoneInput value={phone} onChange={setPhone} />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Lavozim</Label>
                <Input
                  value={position}
                  onChange={(e) => setPosition(e.target.value)}
                  className="h-10 rounded-xl"
                  placeholder="Masalan: Hisobchi, Omborchi…"
                />
              </div>

              {roles.length > 1 ? (
                <div className="space-y-1.5">
                  <Label className="text-xs">Rol</Label>
                  <Select value={role || undefined} onValueChange={setRole}>
                    <SelectTrigger className="h-10 rounded-xl">
                      <SelectValue placeholder="Rolni tanlang" />
                    </SelectTrigger>
                    <SelectContent>
                      {roles.map((r) => (
                        <SelectItem key={r.value} value={r.value}>
                          {r.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : singleRole ? (
                <p className="rounded-xl border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                  Rol: <span className="font-semibold text-foreground">{singleRole.label}</span>
                </p>
              ) : null}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 border-t border-border/70 bg-muted/20 px-5 py-3.5 sm:justify-between">
          {created ? (
            <>
              <Button
                type="button"
                variant="outline"
                className="h-10 gap-1.5 rounded-xl"
                disabled={excelBusy}
                onClick={() => void downloadExcel()}
              >
                {excelBusy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <FileSpreadsheet className="h-4 w-4" />
                )}
                Excel yuklash
              </Button>
              <Button type="button" className="h-10 rounded-xl px-5" onClick={() => onClose(false)}>
                Tayyor
              </Button>
            </>
          ) : (
            <>
              <Button type="button" variant="ghost" className="h-10 rounded-xl" onClick={() => onClose(false)}>
                Bekor
              </Button>
              <Button
                type="button"
                className="h-10 gap-1.5 rounded-xl px-5"
                onClick={submit}
                disabled={create.isPending || meta.isLoading}
              >
                {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                {create.isPending ? "Yaratilmoqda…" : "Qo‘shish"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AddDeptStaffButton({
  enabled,
  className,
  size = "sm",
  showExcel = true,
}: {
  enabled: boolean;
  className?: string;
  size?: "sm" | "default";
  showExcel?: boolean;
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [excelBusy, setExcelBusy] = useState(false);

  if (!enabled) return null;

  const onExcel = async () => {
    if (excelBusy) return;
    setExcelBusy(true);
    try {
      await downloadDeptStaffExcel();
      toast({ title: "Excel yuklandi", description: "Bo‘lim xodimlari — login/parol" });
    } catch (e) {
      toast({
        title: "Excel yuklanmadi",
        description: (e as Error).message,
        variant: "destructive",
      });
    } finally {
      setExcelBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" size={size} className={cn("gap-1.5", className)} onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" />
        Xodim qo‘shish
      </Button>
      {showExcel ? (
        <Button
          type="button"
          size={size}
          variant="secondary"
          className="gap-1.5"
          disabled={excelBusy}
          onClick={() => void onExcel()}
        >
          {excelBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
          Login Excel
        </Button>
      ) : null}
      <AddDeptStaffDialog open={open} onOpenChange={setOpen} enabled={enabled} />
    </div>
  );
}
