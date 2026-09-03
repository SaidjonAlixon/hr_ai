import React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, Loader2, RefreshCw, ScanFace } from "lucide-react";
import { Link } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { canManageSettings } from "@/lib/roles";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useI18n } from "@/i18n/I18nProvider";
import { adminResetFace, fetchAdminFaces } from "@/lib/face-id";

export default function AdminFacesSimilarPage() {
  const { user } = useAuth();
  const isAdmin = canManageSettings(user?.role);
  const { toast } = useToast();
  const { t } = useI18n();
  const qc = useQueryClient();

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

  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <h1 className="text-2xl font-bold">{t("admin.similarFaces")}</h1>
        <p className="mt-2 text-muted-foreground">{t("admin.restricted")}</p>
      </div>
    );
  }

  const duplicates = data?.duplicates ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Link
            href="/admin/faces"
            className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            {t("admin.faces")}
          </Link>
          <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight">
            <AlertTriangle className="h-8 w-8 text-amber-600" />
            {t("admin.similarFaces")}
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            {t("admin.similarSubtitle")}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          className="gap-2"
          disabled={isFetching}
          onClick={() => void refetch()}
        >
          {isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          {t("ui.refresh")}
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border bg-card p-4 shadow-sm">
          <p className="text-xs text-muted-foreground">{t("admin.similar.pair")}</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-amber-800">
            {data?.similarPairs ?? "—"}
          </p>
        </div>
        <div className="rounded-2xl border bg-card p-4 shadow-sm">
          <p className="text-xs text-muted-foreground">{t("admin.similar.threshold")}</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">
            ≤ {data?.enrollBlockMax ?? "—"}
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          {t("ui.loading")}
        </div>
      ) : error ? (
        <p className="text-sm text-red-600">{(error as Error).message}</p>
      ) : !duplicates.length ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50/80 px-6 py-12 text-center">
          <ScanFace className="mx-auto h-10 w-10 text-emerald-700" />
          <p className="mt-3 text-lg font-semibold text-emerald-900">{t("admin.similar.empty")}</p>
          <p className="mt-1 text-sm text-emerald-800/80">
            {t("admin.similar.emptyHint")}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-amber-200 bg-card shadow-sm">
          <div className="border-b border-amber-100 bg-amber-50/90 px-4 py-3">
            <p className="flex items-center gap-2 text-sm font-semibold text-amber-950">
              <AlertTriangle className="h-4 w-4" />
              {t("admin.similar.warn")}
            </p>
          </div>
          <ul className="divide-y">
            {duplicates.map((d, idx) => (
              <li
                key={`${d.a.userId}-${d.b.userId}`}
                className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    #{idx + 1} · masofa {d.distance}
                  </p>
                  <p className="mt-1 text-base font-semibold text-foreground">
                    {d.a.fullName}
                    <span className="mx-2 font-normal text-muted-foreground">↔</span>
                    {d.b.fullName}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {d.a.login} · {d.b.login}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={resetMut.isPending}
                    onClick={() => {
                      if (
                        window.confirm(
                          `${d.a.fullName} Face ID sini o‘chirasizmi? Keyin qayta ro‘yxatdan o‘tadi.`,
                        )
                      ) {
                        resetMut.mutate(d.a.userId);
                      }
                    }}
                  >
                    {d.a.fullName.split(/\s+/)[0]} tozalash
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={resetMut.isPending}
                    onClick={() => {
                      if (
                        window.confirm(
                          `${d.b.fullName} Face ID sini o‘chirasizmi? Keyin qayta ro‘yxatdan o‘tadi.`,
                        )
                      ) {
                        resetMut.mutate(d.b.userId);
                      }
                    }}
                  >
                    {d.b.fullName.split(/\s+/)[0]} tozalash
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
