import React, { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useGetDepartments,
  useUpdateEmployee,
  getGetEmployeesQueryKey,
  type Employee,
} from "@workspace/api-client-react";
import { FileSpreadsheet, Loader2, Search, Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { Skeleton } from "../../components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "../../components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import { useToast } from "../../hooks/use-toast";
import { useAuth } from "../../contexts/AuthContext";
import { cn } from "../../lib/utils";
import { canViewEmployees } from "../../lib/roles";
import { fetchStaff, staffQueryKey, type StaffGroup } from "../../lib/staff-api";
import { formatPersonName } from "../../lib/person-name";
import { EmployeesTabs } from "./employees-tabs";

const ORG_ROLE_UZ: Record<string, string> = {
  coordinator: "Koordinator",
  manager: "Mudir",
  pharmacist: "Farmasevt",
  intern: "Stajyor",
  supervisor: "Nazoratchi",
};

const STAFF_STATUSES = [
  { value: "working", label: "Ishlayapti" },
  { value: "dismissed", label: "Bo‘shatilgan" },
  { value: "on_leave", label: "Ta’tilda" },
] as const;

const STATUS_UZ: Record<string, string> = {
  working: "Ishlayapti",
  new: "Yangi",
  dismissed: "Bo‘shatilgan",
  on_leave: "Ta’tilda",
  need_hire: "Yollash kerak",
  searching: "Qidiruvda",
  no_manager: "Mudir yo‘q",
  closed: "Yopilgan",
};

const STATUS_STYLE: Record<string, string> = {
  working: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300",
  new: "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-300",
  dismissed: "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300",
  on_leave: "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300",
  need_hire: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300",
  searching: "border-violet-200 bg-violet-50 text-violet-800 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-300",
  no_manager: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300",
  closed: "border-border bg-muted text-muted-foreground",
};

type StaffRow = Employee & { phone?: string | null; login?: string | null };

function staffContact(e: Employee): StaffRow {
  return e as StaffRow;
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

function StaffAvatar({ employee }: { employee: Employee }) {
  const [open, setOpen] = useState(false);
  const name = formatPersonName(employee.fullName) || "?";
  const photoUrl = employee.photoUrl?.trim() || null;
  const hasPhoto = Boolean(photoUrl);

  const avatar = (
    <Avatar
      className={cn(
        "h-10 w-10 shrink-0 border border-border bg-card",
        hasPhoto && "cursor-zoom-in transition hover:ring-2 hover:ring-primary/25",
      )}
    >
      {photoUrl ? <AvatarImage src={photoUrl} alt={name} className="object-cover" /> : null}
      <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
        {initials(name)}
      </AvatarFallback>
    </Avatar>
  );

  if (!hasPhoto) return avatar;

  return (
    <>
      <button
        type="button"
        className="rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        aria-label={`${name} rasmini kattalashtirish`}
        onClick={() => setOpen(true)}
      >
        {avatar}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm gap-0 overflow-hidden border-0 p-0 sm:max-w-md">
          <DialogHeader className="sr-only">
            <DialogTitle>{name}</DialogTitle>
            <DialogDescription>Xodim rasmi</DialogDescription>
          </DialogHeader>
          <img
            src={photoUrl}
            alt={name}
            className="max-h-[75vh] w-full bg-slate-950 object-contain"
          />
          <div className="border-t bg-card px-4 py-3 text-center">
            <p className="font-semibold text-foreground">{name}</p>
            {employee.position ? <p className="text-sm text-muted-foreground">{employee.position}</p> : null}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function canEditEmploymentStatus(role?: string | null) {
  return [
    "admin",
    "director",
    "hr_direktor",
    "hr_menejer",
    "hr",
    "moliya",
    "koordinator",
    "mudir",
  ].includes(role || "");
}

function shiftLabel(e: Employee): string {
  if (e.shiftType === "custom" && e.shiftLabel) return e.shiftLabel;
  if (e.shiftType === "one") return "1 smena";
  if (e.shiftType === "two") return "2 smena";
  return e.shiftType || "—";
}

function formatHired(d?: string | null) {
  if (!d) return "—";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString("uz-UZ", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function StatusControl({
  employee,
  canEdit,
  pendingId,
  onChange,
}: {
  employee: Employee;
  canEdit: boolean;
  pendingId: number | null;
  onChange: (id: number, status: string) => void;
}) {
  const st = employee.employmentStatus || "working";
  const known = STAFF_STATUSES.some((s) => s.value === st);
  if (!canEdit) {
    return (
      <span
        className={cn(
          "inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-semibold",
          STATUS_STYLE[st] || "border-border bg-muted text-foreground",
        )}
      >
        {STATUS_UZ[st] || st}
      </span>
    );
  }
  return (
    <Select
      value={known ? st : st}
      disabled={pendingId === employee.id}
      onValueChange={(v) => onChange(employee.id, v)}
    >
      <SelectTrigger
        className={cn(
          "h-8 w-[148px] rounded-full border text-[11px] font-semibold shadow-none",
          STATUS_STYLE[st] || "border-border",
        )}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {STAFF_STATUSES.map((s) => (
          <SelectItem key={s.value} value={s.value}>
            {s.label}
          </SelectItem>
        ))}
        {!known ? <SelectItem value={st}>{STATUS_UZ[st] || st}</SelectItem> : null}
      </SelectContent>
    </Select>
  );
}

const PAGE_META: Record<
  StaffGroup,
  { title: string; subtitle: string; empty: string }
> = {
  active: {
    title: "Faol xodimlar",
    subtitle: "Foydalanuvchilar bazasidan — faqat faol holatdagilar",
    empty: "Faol xodimlar topilmadi",
  },
  other: {
    title: "Boshqa holatdagi xodimlar",
    subtitle: "Ta’til, bo‘sh, tugatilgan va boshqa holatlar",
    empty: "Boshqa holatdagi xodimlar topilmadi",
  },
};

export function EmployeesDirectory({ group }: { group: StaffGroup }) {
  const meta = PAGE_META[group];
  const { toast } = useToast();
  const { user } = useAuth();
  const allowed = canViewEmployees(user?.role);
  const qc = useQueryClient();
  const canEdit = canEditEmploymentStatus(user?.role);
  const [search, setSearch] = useState("");
  const [deptFilter, setDeptFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [exporting, setExporting] = useState(false);
  const [pendingId, setPendingId] = useState<number | null>(null);

  const { data: departments } = useGetDepartments();
  const updateEmp = useUpdateEmployee();

  const {
    data: employees,
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: staffQueryKey(group, search, deptFilter),
    queryFn: () => fetchStaff(group, { search, departmentId: deptFilter }),
    staleTime: 30_000,
  });

  const counts = useMemo(() => {
    const all = employees ?? [];
    return {
      total: all.length,
      working: all.filter((e) => (e.employmentStatus || "working") === "working").length,
      on_leave: all.filter((e) => e.employmentStatus === "on_leave").length,
      dismissed: all.filter((e) => e.employmentStatus === "dismissed").length,
    };
  }, [employees]);

  const list = useMemo(() => {
    const q = search.trim().toLowerCase();
    return [...(employees ?? [])]
      .filter((e) => {
        if (deptFilter !== "all" && e.departmentId !== Number(deptFilter)) return false;
        if (statusFilter !== "all" && (e.employmentStatus || "working") !== statusFilter) return false;
        if (!q) return true;
        const hay = [
          e.fullName,
          e.position,
          e.departmentName,
          e.location,
          e.mentorName,
          e.orgRole && ORG_ROLE_UZ[e.orgRole],
          staffContact(e).phone,
          staffContact(e).login,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return hay.includes(q);
      })
      .sort((a, b) => a.fullName.localeCompare(b.fullName, "uz"));
  }, [employees, search, deptFilter, statusFilter]);

  const setStatus = (id: number, employmentStatus: string) => {
    setPendingId(id);
    updateEmp.mutate(
      { id, data: { employmentStatus: employmentStatus as Employee["employmentStatus"] } },
      {
        onSuccess: () => {
          void qc.invalidateQueries({ queryKey: staffQueryKey(group, search, deptFilter) });
          void qc.invalidateQueries({ queryKey: getGetEmployeesQueryKey() });
          void qc.invalidateQueries({ queryKey: ["staff"] });
          toast({ title: "Holat saqlandi" });
        },
        onError: (err) => {
          toast({
            title: "Holat o‘zgarmadi",
            description: (err as Error)?.message || "Qayta urinib ko‘ring",
            variant: "destructive",
          });
        },
        onSettled: () => setPendingId(null),
      },
    );
  };

  const onExportExcel = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const params = new URLSearchParams();
      params.set("group", group);
      if (search.trim()) params.set("search", search.trim());
      if (deptFilter !== "all") params.set("departmentId", deptFilter);
      const res = await fetch(`/api/employees/export?${params.toString()}`, {
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error || "Excel yuklanmadi");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `xodimlar_${group}_${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast({ title: "Excel yuklandi" });
    } catch (err) {
      toast({
        title: "Excel yuklanmadi",
        description: (err as Error)?.message || "Qayta urinib ko‘ring",
        variant: "destructive",
      });
    } finally {
      setExporting(false);
    }
  };

  if (!allowed) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-10 text-center text-sm text-amber-900">
        Xodimlar ro‘yxatini ko‘rish uchun ruxsat yo‘q.
      </div>
    );
  }

  return (
    <div className="w-full space-y-4">
      <div className="surface-brand flex flex-col gap-4 rounded-2xl px-4 py-4 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight sm:text-2xl">
            <Users className="h-6 w-6 opacity-90" />
            {meta.title}
          </h1>
          <p className="surface-brand-subtle mt-1 text-sm">
            {meta.subtitle} · {isLoading ? "…" : `${list.length} ta ko‘rsatilmoqda`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
          <EmployeesTabs />
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="gap-1.5 bg-card text-primary hover:bg-card/90"
            disabled={exporting || isLoading || list.length === 0}
            onClick={() => void onExportExcel()}
          >
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
            Excel
          </Button>
        </div>
      </div>

      {group === "active" ? (
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          {[
            { l: "Jami", n: counts.total, filter: "all", accent: "border-l-primary" },
            { l: "Ishlayapti", n: counts.working, filter: "working", accent: "border-l-emerald-500" },
            { l: "Ta’tilda", n: counts.on_leave, filter: "on_leave", accent: "border-l-amber-500" },
            { l: "Bo‘shatilgan", n: counts.dismissed, filter: "dismissed", accent: "border-l-rose-500" },
          ].map((c) => (
            <button
              key={c.l}
              type="button"
              onClick={() => setStatusFilter(c.filter)}
              className={cn(
                "rounded-xl border border-border bg-card px-3 py-2.5 text-left shadow-sm transition hover:bg-muted/50",
                "border-l-[3px]",
                c.accent,
                statusFilter === c.filter && "ring-1 ring-primary/20",
              )}
            >
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{c.l}</p>
              <p className="text-xl font-semibold tabular-nums text-foreground">{isLoading ? "…" : c.n}</p>
            </button>
          ))}
        </div>
      ) : null}

      <Card className="overflow-hidden rounded-2xl border-border shadow-sm">
        <CardHeader className="space-y-3 border-b bg-muted/40 px-3 py-3 sm:px-5">
          <CardTitle className="text-sm font-medium text-foreground">Ro‘yxat</CardTitle>
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
            <div className="relative min-w-0 flex-1">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Ism, lavozim, filial…"
                className="h-9 border-border bg-background pl-8 text-sm"
              />
            </div>
            <Select value={deptFilter} onValueChange={setDeptFilter}>
              <SelectTrigger className="h-9 w-full text-sm lg:w-[200px]">
                <SelectValue placeholder="Bo‘lim" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Barcha bo‘limlar</SelectItem>
                {(departments ?? []).map((d) => (
                  <SelectItem key={d.id} value={String(d.id)}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {group === "active" ? (
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="h-9 w-full text-sm lg:w-[180px]">
                  <SelectValue placeholder="Holat" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Barcha holat</SelectItem>
                  {STAFF_STATUSES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : isError ? (
            <div className="space-y-3 px-4 py-10 text-center">
              <p className="text-sm text-red-600">{(error as Error)?.message || "Xodimlar yuklanmadi"}</p>
              <Button type="button" size="sm" variant="outline" disabled={isFetching} onClick={() => void refetch()}>
                {isFetching ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                Qayta urinish
              </Button>
            </div>
          ) : list.length === 0 ? (
            <div className="px-4 py-12 text-center text-sm text-muted-foreground">{meta.empty}</div>
          ) : (
            <>
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full min-w-[1150px] text-left text-sm">
                  <thead>
                    <tr className="surface-brand border-b text-[11px] uppercase tracking-wide">
                      <th className="w-10 px-3 py-3 font-medium">№</th>
                      <th className="w-14 px-2 py-3 font-medium">Rasm</th>
                      <th className="px-3 py-3 font-medium">F.I.Sh.</th>
                      <th className="px-3 py-3 font-medium">Lavozim</th>
                      <th className="px-3 py-3 font-medium">Rol</th>
                      <th className="px-3 py-3 font-medium">Bo‘lim</th>
                      <th className="px-3 py-3 font-medium">Filial</th>
                      <th className="px-3 py-3 font-medium">Holat</th>
                      <th className="px-3 py-3 font-medium">Smena</th>
                      <th className="px-3 py-3 font-medium">Ishga olingan</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((e, i) => (
                      <tr
                        key={`${e.userId ?? e.id}`}
                        className={cn(
                          "border-b border-border transition hover:bg-muted/60",
                          i % 2 === 0 ? "bg-card" : "bg-muted/30",
                        )}
                      >
                        <td className="px-3 py-2.5 text-xs text-muted-foreground">{i + 1}</td>
                        <td className="px-2 py-2">
                          <StaffAvatar employee={e} />
                        </td>
                        <td className="px-3 py-2.5 font-medium text-foreground">
                          <div>{formatPersonName(e.fullName)}</div>
                          {staffContact(e).phone ? (
                            <div className="text-xs font-normal text-muted-foreground">{staffContact(e).phone}</div>
                          ) : null}
                        </td>
                        <td className="px-3 py-2.5 text-foreground">{e.position}</td>
                        <td className="px-3 py-2.5 text-muted-foreground">
                          {(e.orgRole && ORG_ROLE_UZ[e.orgRole]) || e.orgRole || "—"}
                        </td>
                        <td className="px-3 py-2.5 text-muted-foreground">{e.departmentName || "—"}</td>
                        <td className="max-w-[180px] truncate px-3 py-2.5 text-muted-foreground">{e.location || "—"}</td>
                        <td className="px-3 py-2">
                          <StatusControl employee={e} canEdit={canEdit} pendingId={pendingId} onChange={setStatus} />
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground">{shiftLabel(e)}</td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground">{formatHired(e.hiredAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="divide-y md:hidden">
                {list.map((e, i) => (
                  <div key={`${e.userId ?? e.id}`} className="flex gap-3 px-3 py-3">
                    <StaffAvatar employee={e} />
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-[11px] text-muted-foreground">#{i + 1}</p>
                          <p className="truncate font-semibold text-foreground">{formatPersonName(e.fullName)}</p>
                          {staffContact(e).phone ? (
                            <p className="text-xs text-muted-foreground">{staffContact(e).phone}</p>
                          ) : null}
                          <p className="text-xs text-muted-foreground">{e.position}</p>
                        </div>
                        <StatusControl employee={e} canEdit={canEdit} pendingId={pendingId} onChange={setStatus} />
                      </div>
                      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                        <span>Rol: {(e.orgRole && ORG_ROLE_UZ[e.orgRole]) || "—"}</span>
                        <span>Smena: {shiftLabel(e)}</span>
                        <span className="truncate">Bo‘lim: {e.departmentName || "—"}</span>
                        <span>Ishga: {formatHired(e.hiredAt)}</span>
                        <span className="col-span-2 truncate">Filial: {e.location || "—"}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
