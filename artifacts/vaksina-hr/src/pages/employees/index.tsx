import React, { useMemo, useState } from "react";
import { useGetEmployees, useGetDepartments, type Employee } from "@workspace/api-client-react";
import { FileSpreadsheet, Loader2, Search, Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Badge } from "../../components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { Skeleton } from "../../components/ui/skeleton";
import { useToast } from "../../hooks/use-toast";
import { cn } from "../../lib/utils";

const ORG_ROLE_UZ: Record<string, string> = {
  coordinator: "Koordinator",
  manager: "Mudir",
  pharmacist: "Farmasevt",
  intern: "Stajyor",
  supervisor: "Nazoratchi",
};

const STATUS_UZ: Record<string, string> = {
  working: "Ishlayapti",
  new: "Yangi",
  dismissed: "Bo‘shagan",
  need_hire: "Yollash kerak",
  searching: "Qidiruvda",
  no_manager: "Mudir yo‘q",
};

const STATUS_STYLE: Record<string, string> = {
  working: "bg-emerald-50 text-emerald-800 border-emerald-200",
  new: "bg-sky-50 text-sky-800 border-sky-200",
  dismissed: "bg-slate-100 text-slate-600 border-slate-200",
  need_hire: "bg-amber-50 text-amber-800 border-amber-200",
  searching: "bg-violet-50 text-violet-800 border-violet-200",
  no_manager: "bg-amber-50 text-amber-900 border-amber-300",
};

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

export default function EmployeesPage() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [deptFilter, setDeptFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [exporting, setExporting] = useState(false);

  const { data: employees, isLoading, isError, error, refetch, isFetching } = useGetEmployees();
  const { data: departments } = useGetDepartments();

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
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return hay.includes(q);
      })
      .sort((a, b) => a.fullName.localeCompare(b.fullName, "uz"));
  }, [employees, search, deptFilter, statusFilter]);

  const onExportExcel = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set("search", search.trim());
      if (deptFilter !== "all") params.set("departmentId", deptFilter);
      const qs = params.toString();
      const res = await fetch(`/api/employees/export${qs ? `?${qs}` : ""}`, {
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
      a.download = `xodimlar_${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast({ title: "Excel yuklandi", description: "Xodimlar to‘liq ro‘yxati" });
    } catch (err) {
      toast({
        title: "Xatolik",
        description: (err as Error)?.message || "Export amalga oshmadi",
        variant: "destructive",
      });
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Xodimlar</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Barcha xodimlar ro‘yxati · {isLoading ? "…" : `${list.length} ta`}
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          className="gap-1.5 self-start sm:self-auto"
          disabled={exporting || isLoading || list.length === 0}
          onClick={() => void onExportExcel()}
        >
          {exporting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <FileSpreadsheet className="h-4 w-4" />
          )}
          Excel yuklash
        </Button>
      </div>

      <Card className="overflow-hidden shadow-sm">
        <CardHeader className="space-y-3 border-b bg-slate-50/70 py-3 px-3 sm:px-4">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <Users className="h-4 w-4 text-[#0b3a5c]" />
            Ro‘yxat
          </CardTitle>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Ism, lavozim, filial…"
                className="h-9 pl-8 text-sm"
              />
            </div>
            <Select value={deptFilter} onValueChange={setDeptFilter}>
              <SelectTrigger className="h-9 w-full sm:w-[180px] text-sm">
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
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-9 w-full sm:w-[160px] text-sm">
                <SelectValue placeholder="Holat" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Barcha holat</SelectItem>
                {Object.entries(STATUS_UZ).map(([k, v]) => (
                  <SelectItem key={k} value={k}>
                    {v}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : isError ? (
            <div className="px-4 py-10 text-center space-y-3">
              <p className="text-sm text-red-600">
                {(error as Error)?.message || "Xodimlar yuklanmadi"}
              </p>
              <Button type="button" size="sm" variant="outline" disabled={isFetching} onClick={() => void refetch()}>
                {isFetching ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                Qayta urinish
              </Button>
            </div>
          ) : list.length === 0 ? (
            <div className="px-4 py-12 text-center text-sm text-muted-foreground">
              Xodimlar topilmadi
            </div>
          ) : (
            <>
              {/* Desktop table */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b bg-[#0b3a5c] text-[11px] uppercase tracking-wide text-white">
                      <th className="px-3 py-2.5 font-medium w-10">№</th>
                      <th className="px-3 py-2.5 font-medium">F.I.Sh.</th>
                      <th className="px-3 py-2.5 font-medium">Lavozim</th>
                      <th className="px-3 py-2.5 font-medium">Rol</th>
                      <th className="px-3 py-2.5 font-medium">Bo‘lim</th>
                      <th className="px-3 py-2.5 font-medium">Filial</th>
                      <th className="px-3 py-2.5 font-medium">Holat</th>
                      <th className="px-3 py-2.5 font-medium">Smena</th>
                      <th className="px-3 py-2.5 font-medium">Ishga olingan</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((e, i) => {
                      const st = e.employmentStatus || "working";
                      return (
                        <tr
                          key={e.id}
                          className={cn(
                            "border-b border-slate-100",
                            i % 2 === 0 ? "bg-white" : "bg-slate-50/60",
                          )}
                        >
                          <td className="px-3 py-2 text-xs text-slate-500">{i + 1}</td>
                          <td className="px-3 py-2 font-medium text-slate-900">{e.fullName}</td>
                          <td className="px-3 py-2 text-slate-700">{e.position}</td>
                          <td className="px-3 py-2 text-slate-600">
                            {(e.orgRole && ORG_ROLE_UZ[e.orgRole]) || e.orgRole || "—"}
                          </td>
                          <td className="px-3 py-2 text-slate-600">{e.departmentName || "—"}</td>
                          <td className="px-3 py-2 text-slate-600 max-w-[140px] truncate">
                            {e.location || "—"}
                          </td>
                          <td className="px-3 py-2">
                            <Badge
                              variant="outline"
                              className={cn("text-[10px] font-medium", STATUS_STYLE[st])}
                            >
                              {STATUS_UZ[st] || st}
                            </Badge>
                          </td>
                          <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{shiftLabel(e)}</td>
                          <td className="px-3 py-2 text-slate-600 whitespace-nowrap">
                            {formatHired(e.hiredAt)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Mobile cards */}
              <div className="md:hidden divide-y">
                {list.map((e, i) => {
                  const st = e.employmentStatus || "working";
                  return (
                    <div key={e.id} className="px-3 py-3 space-y-1.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-[11px] text-slate-400">#{i + 1}</p>
                          <p className="font-semibold text-slate-900 truncate">{e.fullName}</p>
                          <p className="text-xs text-slate-600">{e.position}</p>
                        </div>
                        <Badge
                          variant="outline"
                          className={cn("shrink-0 text-[10px]", STATUS_STYLE[st])}
                        >
                          {STATUS_UZ[st] || st}
                        </Badge>
                      </div>
                      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-slate-600">
                        <span>Rol: {(e.orgRole && ORG_ROLE_UZ[e.orgRole]) || "—"}</span>
                        <span>Smena: {shiftLabel(e)}</span>
                        <span className="truncate">Bo‘lim: {e.departmentName || "—"}</span>
                        <span>Ishga: {formatHired(e.hiredAt)}</span>
                        <span className="col-span-2 truncate">Filial: {e.location || "—"}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
