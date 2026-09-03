import React, { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Download,
  Loader2,
  RefreshCw,
  ScanFace,
  Search,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { canManageSettings } from "@/lib/roles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  adminResetAllFaces,
  adminResetFace,
  downloadAdminFacesExcel,
  fetchAdminFaces,
  type AdminFaceRow,
} from "@/lib/face-id";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n/I18nProvider";

function fmtDate(v: string | null | undefined) {
  if (!v) return "—";
  try {
    return new Date(v).toLocaleString("uz-UZ", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

function FaceThumb({
  row,
  onOpen,
}: {
  row: AdminFaceRow;
  onOpen?: (row: AdminFaceRow) => void;
}) {
  if (row.photoUrl) {
    return (
      <button
        type="button"
        onClick={() => onOpen?.(row)}
        className="block rounded-xl ring-1 ring-slate-200 transition hover:ring-[#0b3a5c]/40 focus:outline-none focus:ring-2 focus:ring-[#0b3a5c]"
        title="Kattalashtirish"
      >
        <img
          src={row.photoUrl}
          alt={row.fullName}
          className="h-14 w-14 rounded-xl object-cover"
        />
      </button>
    );
  }
  return (
    <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-slate-100 text-muted-foreground ring-1 ring-slate-200">
      <UserRound className="h-6 w-6" />
    </div>
  );
}

export default function AdminFacesPage() {
  const { user } = useAuth();
  const isAdmin = canManageSettings(user?.role);
  const { toast } = useToast();
  const { t } = useI18n();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "yes" | "no">("all");
  const [preview, setPreview] = useState<AdminFaceRow | null>(null);
  const [exporting, setExporting] = useState(false);
  const [confirmClearAll, setConfirmClearAll] = useState(false);

  const { data, isLoading, isFetching, refetch, error } = useQuery({
    queryKey: ["admin-faces"],
    queryFn: fetchAdminFaces,
    enabled: isAdmin,
  });

  const resetMut = useMutation({
    mutationFn: (userId: number) => adminResetFace(userId),
    onSuccess: (res) => {
      toast({ title: "Face ID tozalandi", description: res.message });
      void qc.invalidateQueries({ queryKey: ["admin-faces"] });
    },
    onError: (err: Error) => {
      toast({ title: "O‘chirilmadi", description: err.message, variant: "destructive" });
    },
  });

  const clearAllMut = useMutation({
    mutationFn: () => adminResetAllFaces(),
    onSuccess: (res) => {
      setConfirmClearAll(false);
      toast({ title: "Face ID tozalandi", description: res.message });
      void qc.invalidateQueries({ queryKey: ["admin-faces"] });
    },
    onError: (err: Error) => {
      toast({ title: "Tozalanmadi", description: err.message, variant: "destructive" });
    },
  });

  const onExportExcel = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      await downloadAdminFacesExcel({
        q,
        status: statusFilter,
      });
      toast({
        title: "Excel yuklandi",
        description: "Face ID ro‘yxati rasmlar bilan eksport qilindi",
      });
    } catch (err: unknown) {
      toast({
        title: "Xatolik",
        description: err instanceof Error ? err.message : "Export amalga oshmadi",
        variant: "destructive",
      });
    } finally {
      setExporting(false);
    }
  };

  const filtered = useMemo(() => {
    const list = data?.faces ?? [];
    const needle = q.trim().toLowerCase();
    return list.filter((f) => {
      if (statusFilter === "yes" && !f.faceRegistered) return false;
      if (statusFilter === "no" && f.faceRegistered) return false;
      if (!needle) return true;
      return (
        f.fullName.toLowerCase().includes(needle) ||
        f.login.toLowerCase().includes(needle) ||
        (f.departmentName || "").toLowerCase().includes(needle) ||
        (f.roleLabel || "").toLowerCase().includes(needle)
      );
    });
  }, [data?.faces, q, statusFilter]);

  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <h1 className="text-2xl font-bold">{t("admin.faces")}</h1>
        <p className="mt-2 text-muted-foreground">{t("admin.restricted")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight sm:text-3xl">
            <ScanFace className="h-7 w-7 text-[#0b3a5c]" />
            {t("admin.faces")}
          </h1>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            {t("admin.facesSubtitle")}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-2 border-[#0b3a5c]/25 text-[#0b3a5c] hover:bg-[#0b3a5c]/5"
            disabled={exporting || isLoading}
            onClick={() => void onExportExcel()}
          >
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {t("ui.excel")}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-2 border-red-200 text-red-700 hover:bg-red-50"
            disabled={clearAllMut.isPending || isLoading || !(data?.registered)}
            onClick={() => setConfirmClearAll(true)}
          >
            {clearAllMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            {t("admin.faces.clearAll")}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-2"
            disabled={isFetching}
            onClick={() => void refetch()}
          >
            {isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {t("ui.refresh")}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <div className="rounded-xl border bg-card p-3 shadow-sm">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{t("ui.total")}</p>
          <p className="mt-0.5 text-xl font-semibold tabular-nums">{data?.total ?? "—"}</p>
        </div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 shadow-sm">
          <p className="text-[10px] uppercase tracking-wide text-emerald-800">{t("admin.faces.passed")}</p>
          <p className="mt-0.5 text-xl font-semibold tabular-nums text-emerald-900">
            {data?.registered ?? "—"}
          </p>
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 shadow-sm">
          <p className="text-[10px] uppercase tracking-wide text-amber-800">{t("admin.faces.failed")}</p>
          <p className="mt-0.5 text-xl font-semibold tabular-nums text-amber-900">
            {data?.notRegistered ?? "—"}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("admin.faces.search")}
            className="h-9 pl-9"
          />
        </div>
        <div className="flex flex-wrap gap-1">
          {(
            [
              { id: "all" as const, labelKey: "ui.all" },
              { id: "yes" as const, labelKey: "admin.faces.passed" },
              { id: "no" as const, labelKey: "admin.faces.failed" },
            ] as const
          ).map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setStatusFilter(f.id)}
              className={cn(
                "rounded-lg px-2.5 py-1.5 text-[11px] font-medium transition-colors",
                statusFilter === f.id
                  ? "bg-primary text-primary-foreground"
                  : "bg-slate-100 text-muted-foreground hover:bg-slate-200",
              )}
            >
              {t(f.labelKey)}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center gap-2 py-14 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          Yuklanmoqda…
        </div>
      ) : error ? (
        <p className="text-sm text-red-600">{(error as Error).message}</p>
      ) : (
        <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[780px] text-left text-sm">
              <thead className="border-b bg-muted text-[10px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2.5 font-medium">Yuz</th>
                  <th className="px-3 py-2.5 font-medium">Xodim</th>
                  <th className="px-3 py-2.5 font-medium">Rol</th>
                  <th className="px-3 py-2.5 font-medium">Status</th>
                  <th className="px-3 py-2.5 font-medium">Ro‘yxat</th>
                  <th className="px-3 py-2.5 font-medium" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => (
                  <tr key={`${row.userId}-${row.id}`} className="border-b last:border-0 hover:bg-muted/80">
                    <td className="px-3 py-2.5">
                      <FaceThumb row={row} onOpen={setPreview} />
                    </td>
                    <td className="px-3 py-2.5">
                      <p className="font-medium text-foreground">{row.fullName}</p>
                      <p className="text-xs text-muted-foreground">{row.login}</p>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground">
                      <p>{row.roleLabel}</p>
                      <p className="text-muted-foreground">{row.departmentName || "—"}</p>
                    </td>
                    <td className="px-3 py-2.5">
                      {row.faceRegistered ? (
                        <span className="inline-flex rounded-md bg-emerald-500 px-2.5 py-1 text-[11px] font-semibold text-foreground dark:text-white">
                          O‘tdi
                        </span>
                      ) : (
                        <span className="inline-flex rounded-md bg-amber-400 px-2.5 py-1 text-[11px] font-semibold text-amber-950">
                          O‘tmadi
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground">
                      {row.faceRegistered ? (
                        <>
                          <p>{fmtDate(row.createdAt)}</p>
                          <p className="text-muted-foreground">oxirgi: {fmtDate(row.lastUsedAt)}</p>
                        </>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      {row.faceRegistered ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-8 gap-1 text-red-700 hover:bg-red-50"
                          disabled={resetMut.isPending}
                          onClick={() => {
                            if (window.confirm(`${row.fullName} Face ID sini o‘chirasizmi?`)) {
                              resetMut.mutate(row.userId);
                            }
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Tozalash
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
                {!filtered.length ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">
                      Natija yo‘q
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <AlertDialog open={confirmClearAll} onOpenChange={setConfirmClearAll}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("admin.clearFaces")}</AlertDialogTitle>
            <AlertDialogDescription>
              Face ID dan o‘tgan barcha xodimlarning yuz shabloni va rasmi o‘chiriladi. Ular qayta
              ro‘yxatdan o‘tishi kerak. Bu amalni qaytarib bo‘lmaydi.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={clearAllMut.isPending}>{t("ui.cancelFull")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              disabled={clearAllMut.isPending}
              onClick={(e) => {
                e.preventDefault();
                clearAllMut.mutate();
              }}
            >
              {clearAllMut.isPending ? t("admin.faces.clearing") : t("admin.faces.clearConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={Boolean(preview)} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="max-w-sm gap-3 p-4 sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">{preview?.fullName || "Yuz"}</DialogTitle>
          </DialogHeader>
          {preview?.photoUrl ? (
            <img
              src={preview.photoUrl}
              alt={preview.fullName}
              className="mx-auto max-h-[70vh] w-full rounded-2xl object-contain bg-slate-100"
            />
          ) : null}
          <p className="text-center text-xs text-muted-foreground">{preview?.login}</p>
          <Button type="button" variant="outline" className="w-full gap-1.5" onClick={() => setPreview(null)}>
            <X className="h-4 w-4" />
            Yopish
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
