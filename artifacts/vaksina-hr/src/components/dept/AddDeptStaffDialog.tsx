import React, { useEffect, useState } from "react";
import { Plus, Copy, Eye, EyeOff } from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import {
  Dialog,
  DialogContent,
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
import { useDeptStaffMeta, useCreateDeptStaff, type DeptStaffResult } from "@/lib/dept-staff-api";
import { PhoneInput } from "../ui/phone-input";
import { isOptionalUzPhoneValid, normalizeUzPhone, UZ_PHONE_HINT } from "@/lib/phone";

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
  const [created, setCreated] = useState<DeptStaffResult | null>(null);
  const [showPwd, setShowPwd] = useState(false);

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
    setCreated(null);
    setShowPwd(false);
  };

  const onClose = (next: boolean) => {
    if (!next) resetForm();
    onOpenChange(next);
  };

  const copyCreds = async () => {
    if (!created) return;
    await navigator.clipboard.writeText(
      `Login: ${created.login}\nParol: ${created.temporaryPassword}`,
    );
    toast({ title: "Login/parol nusxalandi" });
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
    if (!role) {
      toast({ title: "Rolni tanlang", variant: "destructive" });
      return;
    }
    create.mutate(
      {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        phone: normalizeUzPhone(phone),
        role,
      },
      {
        onSuccess: (data) => {
          setCreated(data);
          toast({ title: "Qo‘shildi", description: data.message });
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
      <DialogContent className="w-[calc(100%-1.25rem)] max-w-md">
        <DialogHeader>
          <DialogTitle>
            {created ? "Xodim qo‘shildi" : "Bo‘limga xodim qo‘shish"}
          </DialogTitle>
        </DialogHeader>

        {created ? (
          <div className="space-y-3 py-1 text-sm">
            <p className="font-semibold text-foreground">{created.fullName}</p>
            <p className="text-muted-foreground">
              {meta.data?.departmentName} · login va parol avtomatik yaratildi
            </p>
            <div className="rounded-lg border bg-muted/40 p-3 font-mono text-xs">
              <p>Login: {created.login}</p>
              <p className="mt-1 flex items-center gap-2">
                Parol: {showPwd ? created.temporaryPassword : "••••••••"}
                <button type="button" onClick={() => setShowPwd((v) => !v)} className="text-muted-foreground">
                  {showPwd ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </p>
            </div>
            <Button type="button" variant="outline" className="gap-2" onClick={() => void copyCreds()}>
              <Copy className="h-4 w-4" /> Nusxalash
            </Button>
          </div>
        ) : (
          <div className="space-y-3 py-1">
            {meta.data?.departmentName ? (
              <p className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
                Bo‘lim: <span className="font-semibold text-foreground">{meta.data.departmentName}</span>
              </p>
            ) : null}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Ism</Label>
                <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Familiya</Label>
                <Input value={lastName} onChange={(e) => setLastName(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Telefon</Label>
              <PhoneInput value={phone} onChange={setPhone} />
            </div>
            <div className="space-y-1.5">
              <Label>Rol</Label>
              <Select value={role || undefined} onValueChange={setRole}>
                <SelectTrigger>
                  <SelectValue placeholder="Rolni tanlang" />
                </SelectTrigger>
                <SelectContent>
                  {(meta.data?.roles ?? []).map((r) => (
                    <SelectItem key={r.value} value={r.value}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        <DialogFooter className="gap-2">
          {created ? (
            <Button onClick={() => onClose(false)}>Yopish</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={() => onClose(false)}>
                Bekor
              </Button>
              <Button onClick={submit} disabled={create.isPending || meta.isLoading}>
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
}: {
  enabled: boolean;
  className?: string;
  size?: "sm" | "default";
}) {
  const [open, setOpen] = useState(false);
  if (!enabled) return null;
  return (
    <>
      <Button type="button" size={size} className={className} onClick={() => setOpen(true)}>
        <Plus className="mr-1.5 h-4 w-4" />
        Xodim qo‘shish
      </Button>
      <AddDeptStaffDialog open={open} onOpenChange={setOpen} enabled={enabled} />
    </>
  );
}
