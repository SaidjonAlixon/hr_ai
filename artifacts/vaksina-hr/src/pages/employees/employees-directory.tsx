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
import { canViewEmployees, canAddDeptStaff, canChangeStaffStatus } from "../../lib/roles";
import { AddDeptStaffButton } from "../../components/dept/AddDeptStaffDialog";
import { fetchStaff, staffQueryKey, type StaffGroup } from "../../lib/staff-api";
import { formatPersonName } from "../../lib/person-name";
import { EmployeesTabs } from "./employees-tabs";
import { useI18n } from "../../i18n/I18nProvider";

type TFn = (key: string, fallback?: string) => string;

function orgRoleLabel(t: TFn, role?: string | null) {
  if (!role) return "";
  const map: Record<string, string> = {
    coordinator: t("emp.role.coord"),
    manager: t("emp.role.manager"),
    pharmacist: t("emp.role.pharm"),
    intern: t("emp.role.intern"),
    supervisor: t("emp.role.supervisor"),
  };
  return map[role] || role;
}

function statusLabel(t: TFn, st: string) {
  const map: Record<string, string> = {
    working: t("emp.working"),
    new: t("emp.new"),
    dismissed: t("emp.dismissed"),
    on_leave: t("emp.leave"),
    need_hire: t("emp.needHire"),
    searching: t("emp.searching"),
    no_manager: t("emp.noManager"),
    closed: t("emp.closed"),
  };
  return map[st] || st;
}

function staffStatuses(t: TFn) {
  return [
    { value: "working", label: t("emp.working") },
    { value: "dismissed", label: t("emp.dismissed") },
    { value: "on_leave", label: t("emp.leave") },
  ] as const;
}

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
  const { t } = useI18n();
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
            <DialogDescription>{t("emp.photoAlt")}</DialogDescription>
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

function shiftLabel(e: Employee, t: TFn): string {
  if (e.shiftType === "custom" && e.shiftLabel) return e.shiftLabel;
  if (e.shiftType === "one") return t("emp.shift1");
  if (e.shiftType === "two") return t("emp.shift2");
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
  const { t } = useI18n();
  const statuses = staffStatuses(t);
  const st = employee.employmentStatus || "working";
  const known = statuses.some((s) => s.value === st);
  if (!canEdit) {
    return (
      <span
        className={cn(
          "inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-semibold",
          STATUS_STYLE[st] || "border-border bg-muted text-foreground",
        )}
      >
        {statusLabel(t, st)}
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
        {statuses.map((s) => (
          <SelectItem key={s.value} value={s.value}>
            {s.label}
          </SelectItem>
        ))}
        {!known ? <SelectItem value={st}>{statusLabel(t, st)}</SelectItem> : null}
      </SelectContent>
    </Select>
  );
}

export function EmployeesDirectory({ group }: { group: StaffGroup }) {
  const { t } = useI18n();
  const meta =
    group === "active"
      ? { title: t("emp.activeTitle"), subtitle: t("emp.activeSub"), empty: t("emp.activeEmpty") }
      : { title: t("emp.otherTitle"), subtitle: t("emp.otherSub"), empty: t("emp.otherEmpty") };
  const { toast } = useToast();
  const { user } = useAuth();
  const allowed = canViewEmployees(user?.role);
  const qc = useQueryClient();
  const canEdit = canChangeStaffStatus(user?.role);
  const canAddStaff = canAddDeptStaff(user?.role);
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
          e.orgRole && orgRoleLabel(t, e.orgRole),
          staffContact(e).phone,
          staffContact(e).login,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return hay.includes(q);
      })
      .sort((a, b) => a.fullName.localeCompare(b.fullName, "uz"));
  }, [employees, search, deptFilter, statusFilter, t]);

  const setStatus = (id: number, employmentStatus: string) => {
    setPendingId(id);
    updateEmp.mutate(
      { id, data: { employmentStatus: employmentStatus as Employee["employmentStatus"] } },
      {
        onSuccess: () => {
          void qc.invalidateQueries({ queryKey: staffQueryKey(group, search, deptFilter) });
          void qc.invalidateQueries({ queryKey: getGetEmployeesQueryKey() });
          void qc.invalidateQueries({ queryKey: ["staff"] });
          toast({ title: t("emp.statusSaved") });
        },
        onError: (err) => {
          toast({
            title: t("emp.statusFail"),
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
        throw new Error((body as { error?: string }).error || t("emp.excelFail"));
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
      toast({ title: t("emp.excelOk") });
    } catch (err) {
      toast({
        title: t("emp.excelFail"),
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
        {t("emp.noAccess")}
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
            {meta.subtitle} · {isLoading ? "…" : `${list.length} ${t("emp.showing")}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
          <EmployeesTabs />
          <AddDeptStaffButton enabled={canAddStaff} />
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="gap-1.5 bg-card text-primary hover:bg-card/90"
            disabled={exporting || isLoading || list.length === 0}
            onClick={() => void onExportExcel()}
          >
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
            {t("ui.excel")}
          </Button>
        </div>
      </div>

      {group === "active" ? (
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          {[
            { l: t("ui.total"), n: counts.total, filter: "all", accent: "border-l-primary" },
            { l: t("emp.working"), n: counts.working, filter: "working", accent: "border-l-emerald-500" },
            { l: t("emp.leave"), n: counts.on_leave, filter: "on_leave", accent: "border-l-amber-500" },
            { l: t("emp.dismissed"), n: counts.dismissed, filter: "dismissed", accent: "border-l-rose-500" },
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
          <CardTitle className="text-sm font-medium text-foreground">{t("emp.list")}</CardTitle>
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
            <div className="relative min-w-0 flex-1">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("emp.searchPh")}
                className="h-9 border-border bg-background pl-8 text-sm"
              />
            </div>
            <Select value={deptFilter} onValueChange={setDeptFilter}>
              <SelectTrigger className="h-9 w-full text-sm lg:w-[200px]">
                <SelectValue placeholder={t("ui.department")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("ui.allDepartments")}</SelectItem>
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
                  <SelectValue placeholder={t("ui.status")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("emp.allStatuses")}</SelectItem>
                  {staffStatuses(t).map((s) => (
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
              <p className="text-sm text-red-600">{(error as Error)?.message || t("emp.loadFail")}</p>
              <Button type="button" size="sm" variant="outline" disabled={isFetching} onClick={() => void refetch()}>
                {isFetching ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                {t("emp.retry")}
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
                      <th className="w-14 px-2 py-3 font-medium">{t("emp.col.photo")}</th>
                      <th className="px-3 py-3 font-medium">{t("emp.col.name")}</th>
                      <th className="px-3 py-3 font-medium">{t("emp.col.position")}</th>
                      <th className="px-3 py-3 font-medium">{t("emp.col.role")}</th>
                      <th className="px-3 py-3 font-medium">{t("emp.col.dept")}</th>
                      <th className="px-3 py-3 font-medium">{t("emp.col.branch")}</th>
                      <th className="px-3 py-3 font-medium">{t("emp.col.status")}</th>
                      <th className="px-3 py-3 font-medium">{t("emp.col.shift")}</th>
                      <th className="px-3 py-3 font-medium">{t("emp.col.hired")}</th>
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
                          {(e.orgRole && orgRoleLabel(t, e.orgRole)) || e.orgRole || "—"}
                        </td>
                        <td className="px-3 py-2.5 text-muted-foreground">{e.departmentName || "—"}</td>
                        <td className="max-w-[180px] truncate px-3 py-2.5 text-muted-foreground">{e.location || "—"}</td>
                        <td className="px-3 py-2">
                          <StatusControl employee={e} canEdit={canEdit} pendingId={pendingId} onChange={setStatus} />
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground">{shiftLabel(e, t)}</td>
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
                        <span>{t("emp.col.role")}: {(e.orgRole && orgRoleLabel(t, e.orgRole)) || "—"}</span>
                        <span>{t("emp.col.shift")}: {shiftLabel(e, t)}</span>
                        <span className="truncate">{t("emp.col.dept")}: {e.departmentName || "—"}</span>
                        <span>{t("emp.col.hired")}: {formatHired(e.hiredAt)}</span>
                        <span className="col-span-2 truncate">{t("emp.col.branch")}: {e.location || "—"}</span>
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
