import React from "react";
import { Link, useLocation } from "wouter";
import { cn } from "../../lib/utils";
import { useI18n } from "../../i18n/I18nProvider";

export function EmployeesTabs() {
  const [loc] = useLocation();
  const { t } = useI18n();
  const items = [
    { href: "/employees", label: t("emp.active") },
    { href: "/employees/other", label: t("emp.other") },
    { href: "/employees/duplicates", label: t("emp.duplicates") },
  ];
  return (
    <div className="flex flex-wrap gap-1 rounded-xl bg-primary-foreground/10 p-1">
      {items.map((it) => {
        const active =
          it.href === "/employees"
            ? loc === "/employees"
            : loc === it.href || loc.startsWith(`${it.href}/`);
        return (
          <Link
            key={it.href}
            href={it.href}
            className={cn(
              "rounded-lg px-3 py-1.5 text-xs font-medium transition",
              active
                ? "bg-card text-primary shadow-sm"
                : "text-primary-foreground/85 hover:bg-primary-foreground/10 hover:text-primary-foreground",
            )}
          >
            {it.label}
          </Link>
        );
      })}
    </div>
  );
}
