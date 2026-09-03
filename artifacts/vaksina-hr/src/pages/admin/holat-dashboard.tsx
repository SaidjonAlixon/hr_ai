import React, { useMemo, useState } from "react";
import { ChevronDown, Pencil, Phone, Search, Store, Users } from "lucide-react";
import { Input } from "../../components/ui/input";
import { Button } from "../../components/ui/button";
import { Label } from "../../components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import { cn } from "../../lib/utils";
import type { HolatMudirNode, HolatPerson, HolatReport } from "../../lib/holat-api";
import { useAuth } from "../../contexts/AuthContext";
import { isHrRole } from "../../lib/roles";
import { usePatchEmployeeProfile } from "../../lib/pharmacy-staff-api";
import { useToast } from "../../hooks/use-toast";
import { useI18n } from "../../i18n/I18nProvider";

function matchesQuery(parts: Array<string | null | undefined>, q: string) {
  if (!q) return true;
  return parts.filter(Boolean).join(" ").toLowerCase().includes(q);
}

function splitStaff(staff: HolatPerson[]) {
  const farmasevts = staff.filter(
    (s) => s.orgRole === "pharmacist" || s.orgRole === "supervisor" || s.loginRole === "farmasevt",
  );
  const farmIds = new Set(farmasevts.map((s) => s.employeeId));
  const interns = staff.filter(
    (s) =>
      !farmIds.has(s.employeeId) &&
      (s.orgRole === "intern" ||
        s.loginRole === "stajyor" ||
        /staj/i.test(s.orgRoleLabel || s.position || "")),
  );
  const internIds = new Set(interns.map((s) => s.employeeId));
  const other = staff.filter((s) => !farmIds.has(s.employeeId) && !internIds.has(s.employeeId));
  return { farmasevts, interns, other };
}

function splitName(fullName: string) {
  const parts = String(fullName || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { firstName: fullName || "", lastName: "" };
  return { firstName: parts.slice(0, -1).join(" "), lastName: parts[parts.length - 1] };
}

function applyName(p: HolatPerson, fullName: string, phone: string): HolatPerson {
  const n = splitName(fullName);
  return { ...p, fullName, firstName: n.firstName, lastName: n.lastName, phone };
}

function PersonCard({
  p,
  role,
  canEdit,
  onEdit,
}: {
  p: HolatPerson;
  role: string;
  canEdit?: boolean;
  onEdit?: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-[#0b3a5c]">{role}</p>
        {canEdit && p.employeeId != null && onEdit ? (
          <button
            type="button"
            onClick={onEdit}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-[#0b3a5c] hover:bg-muted"
          >
            <Pencil className="h-3 w-3" />
            {t("admin.holatDash.edit")}
          </button>
        ) : null}
      </div>
      <p className="mt-1 font-semibold text-foreground">{p.fullName}</p>
      <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
        <Phone className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        {p.phone || t("admin.holatDash.noPhone")}
      </p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {p.login ? `${t("admin.holatDash.login")} ${p.login}` : t("admin.holatDash.noLogin")}
        {p.employmentStatusLabel && p.employmentStatusLabel !== "—"
          ? ` · ${p.employmentStatusLabel}`
          : ""}
      </p>
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
  const { t } = useI18n();
  const { user } = useAuth();
  const { toast } = useToast();
  const patchProfile = usePatchEmployeeProfile();
  const canEditPeople =
    user?.role === "koordinator" ||
    user?.role === "mudir" ||
    user?.role === "admin" ||
    user?.role === "director" ||
    isHrRole(user?.role);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [branchOpen, setBranchOpen] = useState(false);
  const [openMudir, setOpenMudir] = useState<HolatMudirNode | null>(null);
  const [openCoordName, setOpenCoordName] = useState("");
  const [coordSearch, setCoordSearch] = useState("");
  const [editPerson, setEditPerson] = useState<HolatPerson | null>(null);
  const [editRole, setEditRole] = useState("");
  const [editFirstName, setEditFirstName] = useState("");
  const [editLastName, setEditLastName] = useState("");
  const [editPhone, setEditPhone] = useState("");

  const coords = useMemo(() => {
    const s = coordSearch.trim().toLowerCase();
    const list = (data.coordinators ?? []).filter((c) => c.employeeId != null);
    if (!s) return list;
    return list.filter((c) => matchesQuery([c.fullName, c.phone], s));
  }, [data.coordinators, coordSearch]);

  const allCoords = useMemo(
    () => (data.coordinators ?? []).filter((c) => c.employeeId != null),
    [data.coordinators],
  );

  const effectiveKey = useMemo(() => {
    if (coordKey === "all") return "all";
    if (coordKey && allCoords.some((c) => String(c.employeeId) === coordKey)) return coordKey;
    if (data.scoped && allCoords[0]?.employeeId != null) return String(allCoords[0].employeeId);
    return "";
  }, [coordKey, data.scoped, allCoords]);

  const selected =
    effectiveKey && effectiveKey !== "all"
      ? allCoords.find((c) => String(c.employeeId) === effectiveKey) ?? null
      : null;

  const branches = useMemo(() => {
    if (!effectiveKey) return [] as Array<{ coordName: string; mudir: HolatMudirNode }>;
    if (effectiveKey === "all") {
      return allCoords.flatMap((c) =>
        (c.mudirs ?? []).map((m) => ({ coordName: c.fullName, mudir: m })),
      );
    }
    if (!selected) return [];
    return (selected.mudirs ?? []).map((m) => ({ coordName: selected.fullName, mudir: m }));
  }, [allCoords, effectiveKey, selected]);

  const withTeam = branches.filter((b) => (b.mudir.staffCount ?? 0) > 0).length;
  const farm = branches.reduce((n, b) => n + (b.mudir.pharmacistCount ?? 0), 0);
  const intern = branches.reduce((n, b) => n + (b.mudir.internCount ?? 0), 0);

  const pickerLabel = selected
    ? selected.fullName
    : effectiveKey === "all"
      ? t("admin.holatDash.allCoords")
      : t("admin.holatDash.pickCoord");

  function pickCoord(key: string) {
    onCoordKey(key);
    setPickerOpen(false);
    setCoordSearch("");
    setOpenMudir(null);
    setBranchOpen(false);
  }

  function openBranch(mudir: HolatMudirNode, coordName: string) {
    setOpenMudir(mudir);
    setOpenCoordName(coordName);
    setBranchOpen(true);
  }

  function openPersonEdit(p: HolatPerson, role: string) {
    if (p.employeeId == null) return;
    const n = splitName(p.fullName);
    setEditPerson(p);
    setEditRole(role);
    setEditFirstName(n.firstName);
    setEditLastName(n.lastName);
    setEditPhone(p.phone || "");
  }

  function savePersonEdit() {
    if (!editPerson?.employeeId) return;
    const fullName = `${editFirstName.trim()} ${editLastName.trim()}`.replace(/\s+/g, " ").trim();
    if (!fullName) {
      toast({ title: t("admin.holatDash.needName"), variant: "destructive" });
      return;
    }
    patchProfile.mutate(
      {
        employeeId: editPerson.employeeId,
        firstName: editFirstName.trim(),
        lastName: editLastName.trim(),
        fullName,
        phone: editPhone.trim(),
      },
      {
        onSuccess: () => {
          const phone = editPhone.trim();
          setOpenMudir((cur) => {
            if (!cur) return cur;
            if (cur.employeeId === editPerson.employeeId) return { ...applyName(cur, fullName, phone), staff: cur.staff } as HolatMudirNode;
            return {
              ...cur,
              staff: (cur.staff ?? []).map((s) =>
                s.employeeId === editPerson.employeeId ? applyName(s, fullName, phone) : s,
              ),
            };
          });
          setEditPerson(null);
          toast({ title: t("ui.saved"), description: `${fullName} ${t("admin.holatDash.updated")}` });
        },
        onError: (err: Error) => {
          toast({ title: t("ui.saveFailed"), description: err.message, variant: "destructive" });
        },
      },
    );
  }

  const detail = openMudir ? splitStaff(openMudir.staff ?? []) : null;

  return (
    <div className="space-y-4">
      <section className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t("admin.holatDash.coord")}</p>
          <p className="truncate text-lg font-semibold text-foreground">{pickerLabel}</p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {t("admin.holatDash.hint")}
          </p>
        </div>
        <Button
          type="button"
          className="h-11 shrink-0 gap-2 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90"
          onClick={() => setPickerOpen(true)}
        >
          {t("admin.holatDash.pickCoord")}
          <ChevronDown className="h-4 w-4" />
        </Button>
      </section>

      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent className="w-[calc(100%-1.25rem)] max-w-md">
          <DialogHeader>
            <DialogTitle>{t("admin.holatDash.pickCoordTitle")}</DialogTitle>
          </DialogHeader>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder={t("admin.holatDash.searchName")}
              value={coordSearch}
              onChange={(e) => setCoordSearch(e.target.value)}
              autoFocus
            />
          </div>
          <div className="max-h-[50vh] space-y-1 overflow-y-auto pr-1">
            {!data.scoped && (
              <button
                type="button"
                onClick={() => pickCoord("all")}
                className={cn(
                  "flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm",
                  effectiveKey === "all" ? "bg-primary text-primary-foreground" : "hover:bg-muted",
                )}
              >
                <span className="font-medium">{t("admin.holatDash.allCoords")}</span>
                <span className="text-xs opacity-80">{allCoords.length} {t("oylik.count")}</span>
              </button>
            )}
            {coords.map((c) => {
              const key = String(c.employeeId);
              const active = effectiveKey === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => pickCoord(key)}
                  className={cn(
                    "flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm",
                    active ? "bg-primary text-primary-foreground" : "hover:bg-muted",
                  )}
                >
                  <span className="min-w-0 truncate font-medium">{c.fullName}</span>
                  <span className={cn("shrink-0 text-xs", active ? "text-white/80" : "text-muted-foreground")}>
                    {c.mudirCount ?? 0} {t("admin.holatDash.branchCount")}
                  </span>
                </button>
              );
            })}
            {!coords.length ? <p className="px-2 py-6 text-center text-sm text-muted-foreground">{t("admin.holatDash.notFound")}</p> : null}
          </div>
        </DialogContent>
      </Dialog>

      {!effectiveKey ? (
        <div className="rounded-2xl border border-dashed bg-muted px-4 py-12 text-center">
          <Users className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
          <p className="font-medium text-foreground">{t("admin.holatDash.pickFirst")}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t("admin.holatDash.pickFirstHint")}</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-xl border bg-card p-3">
              <p className="text-[10px] font-semibold uppercase text-muted-foreground">{t("admin.holatDash.stat.branch")}</p>
              <p className="mt-0.5 text-2xl font-semibold tabular-nums">{branches.length}</p>
            </div>
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3">
              <p className="text-[10px] font-semibold uppercase text-emerald-700">{t("admin.holatDash.stat.hasTeam")}</p>
              <p className="mt-0.5 text-2xl font-semibold tabular-nums text-emerald-900">{withTeam}</p>
            </div>
            <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3">
              <p className="text-[10px] font-semibold uppercase text-amber-800">{t("admin.holatDash.stat.noTeam")}</p>
              <p className="mt-0.5 text-2xl font-semibold tabular-nums text-amber-950">{branches.length - withTeam}</p>
            </div>
            <div className="rounded-xl border bg-card p-3">
              <p className="text-[10px] font-semibold uppercase text-muted-foreground">{t("admin.holatDash.stat.staff")}</p>
              <p className="mt-0.5 text-2xl font-semibold tabular-nums">{farm + intern}</p>
              <p className="text-[11px] text-muted-foreground">{farm} {t("admin.holatDash.staffMix")} {intern} {t("admin.holatDash.interns")}</p>
            </div>
          </div>

          <section>
            <h2 className="mb-1 flex items-center gap-2 text-base font-semibold">
              <Store className="h-4 w-4" /> {t("admin.holatDash.branches")}
            </h2>
            <p className="mb-3 text-sm text-muted-foreground">
              {t("admin.holatDash.branchesHint")}
            </p>
            {branches.length === 0 ? (
              <p className="rounded-2xl border bg-card py-10 text-center text-sm text-muted-foreground">
                {t("admin.holatDash.noBranches")}
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
                {branches.map(({ coordName, mudir }, i) => {
                  const has = (mudir.staffCount ?? 0) > 0;
                  return (
                    <button
                      key={mudir.employeeId ?? `${coordName}-${i}`}
                      type="button"
                      onClick={() => openBranch(mudir, coordName)}
                      className={cn(
                        "rounded-xl border p-3.5 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md",
                        has
                          ? "border-emerald-200 bg-card hover:border-emerald-400"
                          : "border-amber-200 bg-amber-50/50 hover:border-amber-400",
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-semibold leading-snug text-foreground">
                          {mudir.branch || t("ui.branch")}
                        </p>
                        <span
                          className={cn(
                            "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold",
                            has ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-900",
                          )}
                        >
                          {has ? t("admin.holatDash.stat.hasTeam") : t("admin.holatDash.stat.noTeam")}
                        </span>
                      </div>
                      {effectiveKey === "all" ? (
                        <p className="mt-1 text-[11px] text-muted-foreground">{coordName}</p>
                      ) : null}
                      <p className="mt-1.5 text-xs text-muted-foreground">{t("admin.holatDash.mudir")}: {mudir.fullName}</p>
                      <p className="mt-2 text-[11px] font-medium text-muted-foreground">
                        {t("admin.holatDash.role.pharm")} {mudir.pharmacistCount ?? 0} · {t("admin.holatDash.role.intern")} {mudir.internCount ?? 0} · {t("admin.holatDash.tapOpen")}
                      </p>
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        </>
      )}

      <Dialog open={branchOpen} onOpenChange={setBranchOpen}>
        <DialogContent className="w-[calc(100%-1.25rem)] max-w-2xl">
          <DialogHeader>
            <DialogTitle>{openMudir?.branch || t("ui.branch")}</DialogTitle>
          </DialogHeader>
          {openMudir && detail ? (
            <div className="space-y-4">
              {effectiveKey === "all" ? (
                <p className="text-xs text-muted-foreground">{t("admin.holatDash.coordLabel")} {openCoordName}</p>
              ) : null}
              <PersonCard
                p={openMudir}
                role={t("admin.holatDash.role.mudir")}
                canEdit={canEditPeople}
                onEdit={() => openPersonEdit(openMudir, t("admin.holatDash.role.mudir"))}
              />
              <div>
                <p className="mb-2 text-sm font-semibold text-foreground">
                  {t("admin.holatDash.pharmSection")} ({detail.farmasevts.length})
                </p>
                {detail.farmasevts.length ? (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {detail.farmasevts.map((s) => (
                      <PersonCard
                        key={s.employeeId ?? s.fullName}
                        p={s}
                        role={t("admin.holatDash.role.pharm")}
                        canEdit={canEditPeople}
                        onEdit={() => openPersonEdit(s, t("admin.holatDash.role.pharm"))}
                      />
                    ))}
                  </div>
                ) : (
                  <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">
                    {t("admin.holatDash.noPharm")}
                  </p>
                )}
              </div>
              <div>
                <p className="mb-2 text-sm font-semibold text-foreground">
                  {t("admin.holatDash.internSection")} ({detail.interns.length})
                </p>
                {detail.interns.length ? (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {detail.interns.map((s) => (
                      <PersonCard
                        key={s.employeeId ?? s.fullName}
                        p={s}
                        role={t("admin.holatDash.role.intern")}
                        canEdit={canEditPeople}
                        onEdit={() => openPersonEdit(s, t("admin.holatDash.role.intern"))}
                      />
                    ))}
                  </div>
                ) : (
                  <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">
                    {t("admin.holatDash.noIntern")}
                  </p>
                )}
              </div>
              {detail.other.length ? (
                <div>
                  <p className="mb-2 text-sm font-semibold text-foreground">{t("admin.holatDash.otherStaff")}</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {detail.other.map((s) => (
                      <PersonCard
                        key={s.employeeId ?? s.fullName}
                        p={s}
                        role={s.orgRoleLabel || t("admin.holatDash.role.staff")}
                        canEdit={canEditPeople}
                        onEdit={() => openPersonEdit(s, s.orgRoleLabel || t("admin.holatDash.role.staff"))}
                      />
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={!!editPerson} onOpenChange={(open) => !open && setEditPerson(null)}>
        <DialogContent className="w-[calc(100%-1.25rem)] max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editRole} {t("admin.holatDash.editTitle")}
            </DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>{t("admin.holatDash.firstName")}</Label>
              <Input value={editFirstName} onChange={(e) => setEditFirstName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("admin.holatDash.lastName")}</Label>
              <Input value={editLastName} onChange={(e) => setEditLastName(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>{t("admin.holatDash.phone")}</Label>
            <Input
              value={editPhone}
              onChange={(e) => setEditPhone(e.target.value)}
              placeholder="+998 90 123 45 67"
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditPerson(null)}>
              {t("ui.cancelFull")}
            </Button>
            <Button onClick={savePersonEdit} disabled={patchProfile.isPending}>
              {t("ui.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
