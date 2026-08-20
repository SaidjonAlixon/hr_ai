import React, { useMemo, useState } from "react";
import { Search, Store, Users } from "lucide-react";
import { Input } from "../../components/ui/input";
import { cn } from "../../lib/utils";
import type { HolatMudirNode, HolatPerson, HolatReport } from "../../lib/holat-api";

function matchesQuery(parts: Array<string | null | undefined>, q: string) {
  if (!q) return true;
  return parts.filter(Boolean).join(" ").toLowerCase().includes(q);
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: number;
  hint?: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{value}</p>
      {hint ? <p className="mt-1 text-xs leading-snug text-slate-500">{hint}</p> : null}
    </div>
  );
}

function personBits(p: Pick<HolatPerson, "fullName" | "phone" | "login" | "employmentStatusLabel">) {
  return (
    <div>
      <p className="font-semibold text-slate-900">{p.fullName}</p>
      <p className="mt-0.5 text-xs text-slate-500">
        {p.phone || "Telefon yo‘q"}
        {p.login ? ` · login: ${p.login}` : " · login yo‘q"}
      </p>
      {p.employmentStatusLabel && p.employmentStatusLabel !== "—" ? (
        <p className="mt-0.5 text-[11px] text-slate-400">{p.employmentStatusLabel}</p>
      ) : null}
    </div>
  );
}

export function HolatDashboardPanel({
  data,
  coordKey,
  onCoordKey,
}: {
  data: HolatReport;
  coordKey: string;
  onCoordKey: (v: string) => void;
}) {
  const [openBranchId, setOpenBranchId] = useState<number | null>(null);
  const [coordSearch, setCoordSearch] = useState("");

  const coords = useMemo(() => {
    const s = coordSearch.trim().toLowerCase();
    const list = (data.coordinators ?? []).filter((c) => c.employeeId != null);
    if (!s) return list;
    return list.filter((c) => matchesQuery([c.fullName, c.phone], s));
  }, [data.coordinators, coordSearch]);

  const effectiveKey = useMemo(() => {
    if (coordKey === "all" || (coordKey && coords.some((c) => String(c.employeeId) === coordKey))) {
      return coordKey;
    }
    if (data.scoped && coords[0]?.employeeId != null) {
      return String(coords[0].employeeId);
    }
    return "";
  }, [coordKey, data.scoped, coords]);

  const selected =
    effectiveKey && effectiveKey !== "all"
      ? data.coordinators.find((c) => String(c.employeeId) === effectiveKey) ?? null
      : null;

  const branches = useMemo(() => {
    if (!effectiveKey) return [] as Array<{ coordName: string; mudir: HolatMudirNode }>;
    if (effectiveKey === "all") {
      return (data.coordinators ?? []).flatMap((c) =>
        (c.mudirs ?? []).map((m) => ({ coordName: c.fullName, mudir: m })),
      );
    }
    if (!selected) return [];
    return (selected.mudirs ?? []).map((m) => ({ coordName: selected.fullName, mudir: m }));
  }, [data.coordinators, effectiveKey, selected]);

  const open = branches.find((b) => b.mudir.employeeId === openBranchId)?.mudir ?? null;
  const withTeam = branches.filter((b) => b.mudir.staffCount > 0).length;
  const farm = branches.reduce((n, b) => n + b.mudir.pharmacistCount, 0);
  const intern = branches.reduce((n, b) => n + b.mudir.internCount, 0);

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <h2 className="text-base font-semibold text-slate-800">Koordinatorni tanlang</h2>
        <p className="mt-1 text-sm text-slate-500">
          Tanlangan koordinatorning nechta filiali borligi chiqadi. Kartani bosing — mudir, farmasevt va stajyor.
        </p>
          <div className="mt-4 space-y-3">
          <div className="relative w-full sm:max-w-xs">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
            <Input
              className="pl-8"
              placeholder="Koordinator qidirish…"
              value={coordSearch}
              onChange={(e) => setCoordSearch(e.target.value)}
            />
          </div>
          <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
            {!data.scoped && (
              <button
                type="button"
                onClick={() => {
                  onCoordKey("all");
                  setOpenBranchId(null);
                }}
                className={cn(
                  "rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ring-inset",
                  effectiveKey === "all"
                    ? "bg-[#0b3a5c] text-white ring-[#0b3a5c]"
                    : "bg-white text-slate-700 ring-slate-200 hover:bg-slate-50",
                )}
              >
                Barchasi
              </button>
            )}
            {coords.map((c) => {
              const key = String(c.employeeId);
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    onCoordKey(key);
                    setOpenBranchId(null);
                  }}
                  className={cn(
                    "rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ring-inset",
                    effectiveKey === key
                      ? "bg-[#0b3a5c] text-white ring-[#0b3a5c]"
                      : "bg-white text-slate-700 ring-slate-200 hover:bg-slate-50",
                  )}
                >
                  {c.fullName}
                  <span className="ml-1 opacity-80">· {c.mudirCount ?? 0}</span>
                </button>
              );
            })}
            {!coords.length ? (
              <p className="px-1 py-2 text-sm text-slate-400">Koordinator topilmadi</p>
            ) : null}
          </div>
        </div>
      </section>

      {!effectiveKey ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-12 text-center">
          <Users className="mx-auto mb-2 h-8 w-8 text-slate-300" />
          <p className="font-medium text-slate-700">Hali koordinator tanlanmagan</p>
          <p className="mt-1 text-sm text-slate-500">Yuqoridagi ro‘yxatdan ismni tanlang.</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Stat
              label="Koordinator"
              value={effectiveKey === "all" ? data.coordinators.length : 1}
              hint={selected?.fullName || "Barchasi"}
            />
            <Stat label="Filial" value={branches.length} hint="Shu tarmoqdagi aptekalar" />
            <Stat label="Jamoa bor" value={withTeam} hint="Farmasevt yoki stajyor qo‘shilgan" />
            <Stat label="Jamoa yo‘q" value={branches.length - withTeam} hint="Faqat mudir" />
            <Stat label="Farmasevt / stajyor" value={farm + intern} hint={`${farm} farmasevt · ${intern} stajyor`} />
          </div>

          <section>
            <h2 className="mb-1 flex items-center gap-2 text-base font-semibold text-slate-800">
              <Store className="h-4 w-4" /> Filiallar
            </h2>
            <p className="mb-3 text-sm text-slate-500">
              Yashil — xodim qo‘shilgan. Sariq — hali farmasevt/stajyor yo‘q. Kartani bosing.
            </p>
            {branches.length === 0 ? (
              <p className="rounded-2xl border bg-white py-10 text-center text-sm text-slate-400">
                Bu koordinatorda filial yo‘q
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {branches.map(({ coordName, mudir }, i) => {
                  const has = (mudir.staffCount ?? 0) > 0;
                  const branchKey = mudir.employeeId ?? `${coordName}-${mudir.fullName}-${i}`;
                  const isOpen = openBranchId != null && mudir.employeeId === openBranchId;
                  return (
                    <button
                      key={branchKey}
                      type="button"
                      onClick={() =>
                        setOpenBranchId(isOpen || mudir.employeeId == null ? null : mudir.employeeId)
                      }
                      className={cn(
                        "rounded-2xl border p-4 text-left shadow-sm transition-all",
                        isOpen
                          ? "border-[#0b3a5c] ring-2 ring-[#0b3a5c]/20"
                          : has
                            ? "border-emerald-200 bg-white hover:border-emerald-300"
                            : "border-amber-200 bg-amber-50/40 hover:border-amber-300",
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-semibold leading-snug text-slate-900">
                          {mudir.branch || "Filial"}
                        </p>
                        <span
                          className={cn(
                            "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold",
                            has ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-900",
                          )}
                        >
                          {has ? "Jamoa bor" : "Jamoa yo‘q"}
                        </span>
                      </div>
                      {effectiveKey === "all" ? (
                        <p className="mt-1 text-[11px] text-slate-500">Koordinator: {coordName}</p>
                      ) : null}
                      <p className="mt-2 text-xs text-slate-600">Mudir: {mudir.fullName}</p>
                      <div className="mt-3 flex flex-wrap gap-1.5 text-[11px]">
                        <span className="rounded-md bg-slate-100 px-2 py-0.5 font-medium text-slate-700">
                          Farmasevt: {mudir.pharmacistCount}
                        </span>
                        <span className="rounded-md bg-slate-100 px-2 py-0.5 font-medium text-slate-700">
                          Stajyor: {mudir.internCount}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          {open ? (
            <section className="rounded-2xl border border-[#0b3a5c]/20 bg-white p-4 shadow-md sm:p-5">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Filial tafsiloti</p>
              <h3 className="mt-1 text-lg font-semibold text-slate-900">{open.branch || "Filial"}</h3>
              <div className="mt-4 grid gap-3 md:grid-cols-3">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-[#0b3a5c]">Mudir</p>
                  <div className="mt-1.5">{personBits(open)}</div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-[#0b3a5c]">
                    Farmasevtlar ({open.pharmacistCount})
                  </p>
                  <div className="mt-2 space-y-2">
                    {(open.staff ?? [])
                      .filter((s) => s.orgRole === "pharmacist")
                      .map((s) => (
                        <div key={s.employeeId ?? s.fullName} className="rounded-lg bg-white p-2 ring-1 ring-slate-100">
                          {personBits(s)}
                        </div>
                      ))}
                    {open.pharmacistCount === 0 ? (
                      <p className="text-sm text-amber-800">Hali farmasevt qo‘shilmagan</p>
                    ) : null}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-[#0b3a5c]">
                    Stajyorlar ({open.internCount})
                  </p>
                  <div className="mt-2 space-y-2">
                    {(open.staff ?? [])
                      .filter((s) => s.orgRole === "intern")
                      .map((s) => (
                        <div key={s.employeeId ?? s.fullName} className="rounded-lg bg-white p-2 ring-1 ring-slate-100">
                          {personBits(s)}
                        </div>
                      ))}
                    {open.internCount === 0 ? (
                      <p className="text-sm text-amber-800">Hali stajyor qo‘shilmagan</p>
                    ) : null}
                  </div>
                </div>
              </div>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
