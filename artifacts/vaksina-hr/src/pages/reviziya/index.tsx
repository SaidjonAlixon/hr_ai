import React from "react";
import { Lock } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { canViewReviziya, isReviziyaRole, userRoleLabel, canAddDeptStaff } from "@/lib/roles";
import { AddDeptStaffButton } from "@/components/dept/AddDeptStaffDialog";
import { useI18n } from "../../i18n/I18nProvider";
import { ReviziyaCyclePanel } from "./cycle-panel";

export default function ReviziyaPage() {
  const { t } = useI18n();
  const { user } = useAuth();
  const allowed = canViewReviziya(user?.role);

  if (!allowed) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center p-8">
        <div className="max-w-sm rounded-2xl border bg-card p-8 text-center shadow-sm">
          <Lock className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 font-semibold text-foreground">{t("reviziya.noAccess")}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t("reviziya.noAccessHint")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="dept-page">
      <div className="dept-hero dept-hero-violet">
        <div className="dept-hero-glow" />
        <div className="dept-hero-glow2" />
        <div className="dept-hero-body">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="dept-eyebrow">{t("reviziya.eyebrow")}</p>
              <h1 className="dept-title">{t("reviziya.title")}</h1>
              <p className="dept-desc">{t("reviziya.desc")}</p>
            </div>
            <div className="flex flex-col items-end gap-2">
              <div className="flex flex-wrap items-center justify-end gap-2">
                {canAddDeptStaff(user?.role) && user?.role === "reviziya_rahbar" ? (
                  <AddDeptStaffButton enabled className="h-9 bg-white text-slate-900 hover:bg-white/90" />
                ) : null}
                <span className="dept-badge">
                {isReviziyaRole(user?.role)
                  ? user?.role === "reviziya_rahbar"
                      ? t("reviziya.role.head")
                      : t("reviziya.role.revizor")
                  : userRoleLabel(user?.role)}
              </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="dept-page-inner !max-w-none w-full px-3 sm:px-4 md:px-6">
        <ReviziyaCyclePanel />
      </div>
    </div>
  );
}
