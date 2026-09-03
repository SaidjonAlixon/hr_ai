import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Trash2, UserRoundMinus, Users } from "lucide-react";
import { getGetEmployeesQueryKey } from "@workspace/api-client-react";
import { Button } from "../../components/ui/button";
import { Card, CardContent } from "../../components/ui/card";
import { Skeleton } from "../../components/ui/skeleton";
import { useToast } from "../../hooks/use-toast";
import { useAuth } from "../../contexts/AuthContext";
import { cn } from "../../lib/utils";
import { EmployeesTabs } from "./employees-tabs";
import { useI18n } from "../../i18n/I18nProvider";

type DuplicateMember = {
  id: number;
  fullName: string;
  position: string;
  orgRole: string | null;
  employmentStatus: string;
  location: string | null;
  shiftType: string | null;
  shiftLabel: string | null;
  hiredAt: string;
  departmentName: string | null;
  userId: number | null;
  userLogin: string | null;
  userPhone: string | null;
  userStatus: string | null;
  hasTelegram: boolean;
  hasFace: boolean;
  attendanceCount: number;
  usedSystem: boolean;
  suggestedKeep: boolean;
};

type DuplicateGroup = {
  key: string;
  keepId: number;
  members: DuplicateMember[];
};

type TFn = (key: string, fallback?: string) => string;

function orgRoleLabel(t: TFn, role?: string | null) {
  if (!role) return "—";
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

function canCleanupDuplicates(role?: string | null) {
  return ["admin", "hr", "hr_direktor", "hr_kadr_rahbar", "hr_menejer", "hr_auditor"].includes(role || "");
}

function shiftText(m: DuplicateMember, t: TFn) {
  if (m.shiftType === "custom" && m.shiftLabel) return m.shiftLabel;
  if (m.shiftType === "one") return t("emp.shift1");
  if (m.shiftType === "two") return t("emp.shift2");
  return m.shiftType || "—";
}

async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: "include", ...init });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error || "Xatolik");
  return body;
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-sm font-medium text-foreground">{value || "—"}</p>
    </div>
  );
}

export default function EmployeeDuplicatesPage() {
  const { t } = useI18n();
  const { toast } = useToast();
  const { user } = useAuth();
  const qc = useQueryClient();
  const allowed = canCleanupDuplicates(user?.role);
  const [busy, setBusy] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ["employees", "duplicates"],
    queryFn: () =>
      apiJson<{ groups: DuplicateGroup[]; groupCount: number; extraCount: number }>("/api/employees/duplicates"),
    enabled: allowed,
  });

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ["employees", "duplicates"] });
    await qc.invalidateQueries({ queryKey: getGetEmployeesQueryKey() });
    await q.refetch();
  };

  const cleanAll = async () => {
    if (busy) return;
    if (!window.confirm("Barcha dublikatlarda tavsiya etilgan yozuv qoladi, qolganlari o‘chiriladi. Davom etasizmi?")) {
      return;
    }
    setBusy("all");
    try {
      const body = await apiJson<{ removedCount?: number; groups?: number }>("/api/employees/cleanup-duplicates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      await refresh();
      toast({
        title: t("emp.dupCleaned"),
        description: `${body.removedCount ?? 0} ta akkount o‘chirildi (${body.groups ?? 0} ta guruh)`,
      });
    } catch (err) {
      toast({ title: t("emp.dupCleanFail"), description: (err as Error).message, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  const cleanOne = async (keepId: number, dropId: number, name: string, isSuggestedKeep: boolean) => {
    if (busy) return;
    const msg = isSuggestedKeep
      ? `${name} (ID ${dropId}) yashil “qoladi” yozuvi. O‘chirilsinmi? ID ${keepId} qoladi.`
      : `${name} (ID ${dropId}) o‘chirilsinmi? ID ${keepId} qoladi.`;
    if (!window.confirm(msg)) return;
    setBusy(`${keepId}-${dropId}`);
    try {
      await apiJson("/api/employees/cleanup-duplicates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keepId, dropId }),
      });
      await refresh();
      toast({ title: t("emp.dupDeleted"), description: `${name} dublikati olib tashlandi` });
    } catch (err) {
      toast({ title: t("emp.dupDeleteFail"), description: (err as Error).message, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  if (!allowed) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <h1 className="text-xl font-bold">{t("emp.duplicates")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("emp.dupHrOnly")}</p>
      </div>
    );
  }

  const groups = q.data?.groups ?? [];

  return (
    <div className="w-full space-y-4">
      <div className="surface-brand flex flex-col gap-4 rounded-2xl px-4 py-4 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight sm:text-2xl">
            <Users className="h-6 w-6 opacity-90" />
            {t("emp.duplicates")}
          </h1>
          <p className="surface-brand-subtle mt-1 text-sm">
            {t("emp.dupSubtitle")} · {q.isLoading ? "…" : `${q.data?.groupCount ?? 0} ${t("emp.dupGroups")}, ${q.data?.extraCount ?? 0} ${t("emp.dupExtra")}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <EmployeesTabs />
          <Button
            type="button"
            size="sm"
            className="gap-1.5 bg-card text-primary hover:bg-card/90"
            disabled={!!busy || q.isLoading || groups.length === 0}
            onClick={() => void cleanAll()}
          >
            {busy === "all" ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserRoundMinus className="h-4 w-4" />}
            {t("emp.dupCleanAll")}
          </Button>
        </div>
      </div>

      {q.isLoading ? (
        <Skeleton className="h-64 rounded-2xl" />
      ) : q.isError ? (
        <p className="text-sm text-rose-700">{(q.error as Error).message}</p>
      ) : groups.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            {t("emp.dupEmpty")}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            <Card key={g.key} className="overflow-hidden rounded-2xl border-border shadow-sm">
              <div className="border-b bg-muted px-4 py-3">
                <p className="text-sm font-semibold text-foreground">{g.members[0]?.fullName}</p>
                <p className="text-xs text-muted-foreground">{g.members.length} ta akkount · qolishi tavsiya: ID {g.keepId}</p>
              </div>
              <div className="grid gap-3 p-4 lg:grid-cols-2">
                {g.members.map((m) => (
                  <div
                    key={m.id}
                    className={cn(
                      "rounded-xl border p-3",
                      m.suggestedKeep ? "border-emerald-300 bg-emerald-50/60" : "border-border bg-card",
                    )}
                  >
                    <div className="mb-2 flex items-start justify-between gap-2">
                      <div>
                        <p className="font-semibold text-[#0b3a5c]">{m.fullName}</p>
                        <p className="text-xs text-muted-foreground">ID {m.id}</p>
                      </div>
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase",
                          m.suggestedKeep ? "bg-emerald-600 text-white" : "bg-rose-100 text-rose-800 dark:bg-rose-500/15 dark:text-rose-300",
                        )}
                      >
                        {m.suggestedKeep ? t("emp.dupKeep") : t("emp.dupLabel")}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <Fact label={t("emp.col.position")} value={m.position} />
                      <Fact label={t("emp.col.role")} value={orgRoleLabel(t, m.orgRole)} />
                      <Fact label={t("emp.col.status")} value={statusLabel(t, m.employmentStatus)} />
                      <Fact label={t("emp.col.dept")} value={m.departmentName} />
                      <Fact label={t("emp.col.branch")} value={m.location} />
                      <Fact label={t("emp.col.shift")} value={shiftText(m, t)} />
                      <Fact label={t("emp.col.hired")} value={m.hiredAt} />
                      <Fact label={t("emp.col.login")} value={m.userLogin || (m.userId ? `user #${m.userId}` : t("emp.noAccount"))} />
                      <Fact label={t("emp.col.phone")} value={m.userPhone} />
                      <Fact label={t("emp.col.userStatus")} value={m.userStatus} />
                      <Fact label={t("emp.col.telegram")} value={m.hasTelegram ? t("emp.has") : t("ui.no")} />
                      <Fact label={t("emp.col.face")} value={m.hasFace ? t("emp.has") : t("ui.no")} />
                      <Fact label={t("emp.col.attendance")} value={`${m.attendanceCount} ta`} />
                      <Fact label={t("emp.col.usedSystem")} value={m.usedSystem ? t("ui.yes") : t("ui.no")} />
                    </div>
                    {g.members.length > 1 ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="mt-3 h-8 gap-1.5 text-rose-700"
                        disabled={!!busy}
                        onClick={() => {
                          const keepId =
                            m.id === g.keepId
                              ? g.members.find((x) => x.id !== m.id)!.id
                              : g.keepId;
                          void cleanOne(keepId, m.id, m.fullName, m.suggestedKeep);
                        }}
                      >
                        {busy && busy !== "all" && busy.endsWith(`-${m.id}`) ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                        {t("emp.dupDeleteOne")}
                      </Button>
                    ) : null}
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
