import { useMemo, useState } from "react";
import { Link } from "wouter";
import {
  Briefcase,
  CheckCircle2,
  FileSpreadsheet,
  KeyRound,
  Loader2,
  Pencil,
  Plus,
  Truck,
  UserPlus,
  Users,
  XCircle,
} from "lucide-react";
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
import { cn } from "@/lib/utils";
import { isOptionalUzPhoneValid, normalizeUzPhone, UZ_PHONE_HINT } from "@/lib/phone";
import { canManageDistribyutsiya, canViewDistribyutsiya, userRoleLabel } from "@/lib/roles";
import { StaffLoginCredsPanel } from "@/components/dept/StaffLoginCredsPanel";
import {
  downloadDistribStaffExcel,
  useDistribJobTitles,
  useDistribMeta,
  useDistribMutations,
  useDistribStaff,
} from "@/lib/distribyutsiya-api";

type Tab = "hr" | "lavozimlar";

export default function DistribyutsiyaPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const canView = canViewDistribyutsiya(user?.role);
  const canManage = canManageDistribyutsiya(user?.role);
  const [tab, setTab] = useState<Tab>("hr");

  const meta = useDistribMeta(canView);
  const staffQ = useDistribStaff(canView && tab === "hr");
  const titlesQ = useDistribJobTitles(canView && (tab === "lavozimlar" || canManage));
  const mut = useDistribMutations();

  const [addOpen, setAddOpen] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [jobTitleId, setJobTitleId] = useState<string>("");
  const [staffKind, setStaffKind] = useState<"distrib" | "distrib_hr" | "distrib_rahbar">("distrib");
  const [created, setCreated] = useState<{
    login: string;
    temporaryPassword: string;
    fullName: string;
    position: string;
  } | null>(null);
  const [excelBusy, setExcelBusy] = useState(false);

  const [newTitle, setNewTitle] = useState("");
  const [editId, setEditId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState("");

  const activeTitles = useMemo(
    () => (titlesQ.data?.titles || meta.data?.titles || []).filter((t) => t.active),
    [titlesQ.data?.titles, meta.data?.titles],
  );

  const onExcel = async () => {
    if (excelBusy) return;
    setExcelBusy(true);
    try {
      await downloadDistribStaffExcel();
      toast({ title: "Excel yuklandi", description: "Distribyutsiya xodimlari — login/parol" });
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

  if (!canView) {
    return (
      <div className="mx-auto max-w-lg px-4 py-10 text-center">
        <p className="text-sm text-rose-600">Distribyutsiya bo‘limiga ruxsat yo‘q.</p>
        <Link href="/dashboard" className="mt-3 inline-block text-sm text-primary underline">
          ← Bosh sahifa
        </Link>
      </div>
    );
  }

  const resetAdd = () => {
    setFirstName("");
    setLastName("");
    setPhone("");
    setJobTitleId("");
    setStaffKind("distrib");
    setCreated(null);
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
    if (staffKind === "distrib" && !jobTitleId) {
      toast({ title: "Lavozimni tanlang", variant: "destructive" });
      return;
    }
    mut.createStaff.mutate(
      {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        phone: normalizeUzPhone(phone) || undefined,
        jobTitleId: jobTitleId ? Number(jobTitleId) : null,
        role: staffKind,
      },
      {
        onSuccess: (data) => {
          setCreated({
            login: data.login,
            temporaryPassword: data.temporaryPassword,
            fullName: data.fullName,
            position: data.position,
          });
          toast({ title: "Qo‘shildi", description: data.message });
        },
        onError: (e: Error) => {
          toast({ title: "Qo‘shilmadi", description: e.message, variant: "destructive" });
        },
      },
    );
  };

  return (
    <div className="mx-auto max-w-5xl space-y-5 px-4 py-5 pb-28 sm:px-6">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Truck className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
              Distribyutsiya · HR
            </h1>
            <p className="text-sm text-muted-foreground">
              Alohida bo‘lim — o‘z xodimlari va lavozimlari
            </p>
          </div>
          {canManage ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                className="gap-1.5 rounded-xl"
                disabled={excelBusy}
                onClick={() => void onExcel()}
              >
                {excelBusy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <FileSpreadsheet className="h-4 w-4" />
                )}
                Login Excel
              </Button>
              <Button
                type="button"
                className="gap-1.5 rounded-xl"
                onClick={() => {
                  resetAdd();
                  setAddOpen(true);
                }}
              >
                <Plus className="h-4 w-4" />
                Xodim qo‘shish
              </Button>
            </div>
          ) : null}
        </div>
      </header>

      <div className="flex gap-1 rounded-2xl border border-border bg-muted/30 p-1">
        <button
          type="button"
          onClick={() => setTab("hr")}
          className={cn(
            "flex flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold transition",
            tab === "hr" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted",
          )}
        >
          <Users className="h-4 w-4" />
          HR · Xodimlar
        </button>
        <button
          type="button"
          onClick={() => setTab("lavozimlar")}
          className={cn(
            "flex flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold transition",
            tab === "lavozimlar"
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:bg-muted",
          )}
        >
          <Briefcase className="h-4 w-4" />
          Lavozimlar
        </button>
      </div>

      {tab === "hr" ? (
        <section className="rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-5">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-base font-semibold">Xodimlar ro‘yxati</h2>
            <span className="rounded-full bg-muted px-2.5 py-1 text-[11px] font-semibold text-muted-foreground">
              {staffQ.data?.staff?.length ?? 0} ta
            </span>
          </div>
          {staffQ.isLoading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Yuklanmoqda…
            </div>
          ) : !staffQ.data?.staff?.length ? (
            <p className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
              Hali xodim yo‘q. «Xodim qo‘shish» orqali qo‘shing.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="bg-muted/50 text-[11px] uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2.5 font-semibold">#</th>
                    <th className="px-3 py-2.5 font-semibold">F.I.Sh.</th>
                    <th className="px-3 py-2.5 font-semibold">Lavozim</th>
                    <th className="px-3 py-2.5 font-semibold">Rol</th>
                    <th className="px-3 py-2.5 font-semibold">Login</th>
                    <th className="px-3 py-2.5 font-semibold">Holat</th>
                  </tr>
                </thead>
                <tbody>
                  {staffQ.data.staff.map((row, i) => (
                    <tr key={row.userId} className="border-t border-border/70">
                      <td className="px-3 py-2.5 tabular-nums text-muted-foreground">{i + 1}</td>
                      <td className="px-3 py-2.5 font-medium">{row.fullName}</td>
                      <td className="px-3 py-2.5">{row.position || "—"}</td>
                      <td className="px-3 py-2.5 text-muted-foreground">{userRoleLabel(row.role)}</td>
                      <td className="px-3 py-2.5 font-mono text-xs">{row.login}</td>
                      <td className="px-3 py-2.5">
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-[11px] font-semibold",
                            row.status === "active"
                              ? "bg-emerald-500/15 text-emerald-700"
                              : "bg-muted text-muted-foreground",
                          )}
                        >
                          {row.status === "active" ? "Faol" : row.status || "—"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : (
        <section className="rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold">Lavozimlar</h2>
              <p className="text-xs text-muted-foreground">Qo‘shish, tahrirlash yoki nofaol qilish</p>
            </div>
          </div>

          {canManage ? (
            <div className="mb-4 flex flex-col gap-2 sm:flex-row">
              <Input
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="Yangi lavozim nomi…"
                className="rounded-xl"
              />
              <Button
                type="button"
                className="shrink-0 gap-1.5 rounded-xl"
                disabled={!newTitle.trim() || mut.createTitle.isPending}
                onClick={() => {
                  mut.createTitle.mutate(newTitle.trim(), {
                    onSuccess: () => {
                      setNewTitle("");
                      toast({ title: "Lavozim qo‘shildi" });
                    },
                    onError: (e: Error) =>
                      toast({ title: "Saqlanmadi", description: e.message, variant: "destructive" }),
                  });
                }}
              >
                {mut.createTitle.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Qo‘shish
              </Button>
            </div>
          ) : null}

          {titlesQ.isLoading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Yuklanmoqda…
            </div>
          ) : (
            <ul className="space-y-1.5">
              {(titlesQ.data?.titles || []).map((t, idx) => (
                <li
                  key={t.id}
                  className={cn(
                    "flex items-center gap-3 rounded-xl border px-3 py-2.5",
                    t.active ? "border-border bg-background" : "border-dashed border-border/70 bg-muted/20 opacity-70",
                  )}
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-xs font-bold tabular-nums">
                    {idx + 1}
                  </span>
                  {editId === t.id ? (
                    <Input
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      className="h-9 flex-1 rounded-lg"
                      autoFocus
                    />
                  ) : (
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{t.title}</span>
                  )}
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase",
                      t.active
                        ? "bg-emerald-500/15 text-emerald-700"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    {t.active ? "Faol" : "Nofaol"}
                  </span>
                  {canManage ? (
                    <div className="flex shrink-0 items-center gap-1">
                      {editId === t.id ? (
                        <>
                          <Button
                            type="button"
                            size="sm"
                            className="h-8 rounded-lg"
                            disabled={mut.updateTitle.isPending}
                            onClick={() => {
                              mut.updateTitle.mutate(
                                { id: t.id, title: editTitle.trim() },
                                {
                                  onSuccess: () => {
                                    setEditId(null);
                                    toast({ title: "Saqlandi" });
                                  },
                                  onError: (e: Error) =>
                                    toast({
                                      title: "Xato",
                                      description: e.message,
                                      variant: "destructive",
                                    }),
                                },
                              );
                            }}
                          >
                            Saqlash
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-8 rounded-lg"
                            onClick={() => setEditId(null)}
                          >
                            Bekor
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8"
                            onClick={() => {
                              setEditId(t.id);
                              setEditTitle(t.title);
                            }}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8"
                            disabled={mut.updateTitle.isPending || mut.deactivateTitle.isPending}
                            onClick={() => {
                              if (t.active) {
                                mut.deactivateTitle.mutate(t.id, {
                                  onSuccess: () => toast({ title: "Nofaol qilindi" }),
                                });
                              } else {
                                mut.updateTitle.mutate(
                                  { id: t.id, active: true },
                                  { onSuccess: () => toast({ title: "Faollashtirildi" }) },
                                );
                              }
                            }}
                          >
                            {t.active ? (
                              <XCircle className="h-3.5 w-3.5 text-rose-500" />
                            ) : (
                              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                            )}
                          </Button>
                        </>
                      )}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <Dialog
        open={addOpen}
        onOpenChange={(o) => {
          if (!o) resetAdd();
          setAddOpen(o);
        }}
      >
        <DialogContent className="w-[calc(100%-1.25rem)] max-w-md gap-0 overflow-hidden p-0 sm:rounded-2xl">
          <DialogHeader className="space-y-1 border-b border-border/70 bg-gradient-to-br from-primary/10 via-background to-amber-500/5 px-5 py-4 text-left">
            <DialogTitle className="flex items-center gap-2 text-base sm:text-lg">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/15 text-primary">
                {created ? <KeyRound className="h-4 w-4" /> : <UserPlus className="h-4 w-4" />}
              </span>
              {created ? "Login va parol tayyor" : "Distribyutsiya xodimi"}
            </DialogTitle>
            <DialogDescription className="text-xs sm:text-sm">
              {created
                ? "Nusxalang yoki barcha xodimlarni Excelga yuklab oling"
                : "Login/parol avtomatik yaratiladi — keyin Exceldan ham olishingiz mumkin"}
            </DialogDescription>
          </DialogHeader>

          <div className="px-5 py-4">
            {created ? (
              <StaffLoginCredsPanel
                fullName={created.fullName}
                subtitle={created.position}
                login={created.login}
                password={created.temporaryPassword}
              />
            ) : (
              <div className="space-y-3.5">
                <div className="rounded-xl border border-sky-500/20 bg-sky-500/5 px-3 py-2.5 text-[11px] leading-relaxed text-sky-950 dark:text-sky-100">
                  <p className="font-semibold">Qo‘shishdan oldin</p>
                  <p className="mt-0.5 text-sky-900/80 dark:text-sky-100/80">
                    To‘liq ism, telefon va tur/lavozimni kiriting. Tizim login va vaqtinchalik parol
                    yaratadi.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Familiya</Label>
                    <Input
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      className="h-10 rounded-xl"
                      placeholder="Familiya"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Ism</Label>
                    <Input
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      className="h-10 rounded-xl"
                      placeholder="Ism"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Telefon</Label>
                  <PhoneInput value={phone} onChange={setPhone} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Tur</Label>
                  <Select value={staffKind} onValueChange={(v) => setStaffKind(v as typeof staffKind)}>
                    <SelectTrigger className="h-10 rounded-xl">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="distrib">Xodim (lavozim bilan)</SelectItem>
                      <SelectItem value="distrib_hr">Distribyutsiya HR</SelectItem>
                      <SelectItem value="distrib_rahbar">Distribyutsiya rahbari</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {staffKind === "distrib" ? (
                  <div className="space-y-1.5">
                    <Label className="text-xs">Lavozim</Label>
                    <Select value={jobTitleId} onValueChange={setJobTitleId}>
                      <SelectTrigger className="h-10 rounded-xl">
                        <SelectValue placeholder="Lavozimni tanlang" />
                      </SelectTrigger>
                      <SelectContent>
                        {activeTitles.map((t) => (
                          <SelectItem key={t.id} value={String(t.id)}>
                            {t.title}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
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
                  onClick={() => void onExcel()}
                >
                  {excelBusy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <FileSpreadsheet className="h-4 w-4" />
                  )}
                  Excel yuklash
                </Button>
                <Button
                  type="button"
                  className="h-10 rounded-xl px-5"
                  onClick={() => {
                    resetAdd();
                    setAddOpen(false);
                  }}
                >
                  Tayyor
                </Button>
              </>
            ) : (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  className="h-10 rounded-xl"
                  onClick={() => {
                    resetAdd();
                    setAddOpen(false);
                  }}
                >
                  Bekor
                </Button>
                <Button
                  type="button"
                  className="h-10 gap-1.5 rounded-xl px-5"
                  disabled={mut.createStaff.isPending}
                  onClick={submitStaff}
                >
                  {mut.createStaff.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="h-4 w-4" />
                  )}
                  Qo‘shish
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
