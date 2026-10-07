import { useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Award,
  Building2,
  Crown,
  Eye,
  EyeOff,
  Check,
  History,
  Info,
  Loader2,
  RefreshCw,
  RotateCcw,
  MessageSquareText,
  Search,
  Sparkles,
  Store,
  Trash2,
  UserPlus,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { userRoleLabel, verifiedTier, type VerifiedTier } from "@/lib/roles";
import { BadgeArt, BadgeInfoCard, BadgeMedal, type BadgeKind } from "@/components/VerifiedBadge";
import {
  EMPLOYEE_TITLE_ORDER,
  PRO_DESCRIPTION,
  PRO_META,
  PRO_TIER_TEXT,
  TITLE_META,
  USER_TITLES_ADMIN_KEY,
  USER_TITLES_HISTORY_KEY,
  USER_TITLES_MAP_KEY,
  fetchTitleAdmin,
  fetchTitleHistory,
  isEmployeeTitle,
  isProTier,
  saveProHidden,
  saveProTier,
  saveUserTitle,
  type EmployeeTitle,
  type TitleAdminPerson,
  type TitleHistoryRow,
} from "@/lib/user-titles";
import { staffWorkplaceOf, type StaffWorkplace } from "@/lib/staff-workplace";

type Section = "xodimlar" | "rahbarlar" | "tarix";
type TitleFilter = "all" | "with" | "without" | EmployeeTitle;
type PlaceFilter = "all" | StaffWorkplace;

const TIER_ORDER: VerifiedTier[] = ["founder", "director", "hr", "lead", "master"];
const PAGE = 60;

function placeOf(p: TitleAdminPerson): StaffWorkplace {
  return staffWorkplaceOf({ role: p.role, departmentName: p.departmentName });
}

function fold(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\u2018\u2019\u02BB\u02BC'`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function initials(name: string) {
  const p = name.trim().split(/\s+/).filter(Boolean);
  return ((p[0]?.[0] ?? "") + (p[1]?.[0] ?? "")).toUpperCase() || "?";
}

function fmtDate(v: string | null | undefined) {
  if (!v) return "";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("uz-UZ", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function titleOf(p: TitleAdminPerson): EmployeeTitle | null {
  return isEmployeeTitle(p.title) ? p.title : null;
}

function isProPerson(p: TitleAdminPerson): boolean {
  return p.isLeader || isProTier(p.proTier);
}

/** Admin bergan PRO turi, bo‘lmasa rol bo‘yicha tur. */
function tierOf(p: TitleAdminPerson): VerifiedTier {
  return isProTier(p.proTier) ? p.proTier : verifiedTier(p.role) ?? "lead";
}

export default function UnvonPanel() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [section, setSection] = useState<Section>("xodimlar");
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<TitleFilter>("all");
  const [dept, setDept] = useState("all");
  const [place, setPlace] = useState<PlaceFilter>("all");
  const [limit, setLimit] = useState(PAGE);
  const [assignFor, setAssignFor] = useState<{ person: TitleAdminPerson; initial: EmployeeTitle | null } | null>(null);
  const [proFor, setProFor] = useState<TitleAdminPerson | null>(null);
  const [addPro, setAddPro] = useState(false);
  const [info, setInfo] = useState<BadgeKind | null>(null);

  const peopleQ = useQuery({ queryKey: USER_TITLES_ADMIN_KEY, queryFn: fetchTitleAdmin, staleTime: 30_000 });
  const historyQ = useQuery({
    queryKey: USER_TITLES_HISTORY_KEY,
    queryFn: fetchTitleHistory,
    enabled: section === "tarix",
    staleTime: 15_000,
  });

  const people = peopleQ.data ?? [];
  const employees = useMemo(() => people.filter((p) => !isProPerson(p)), [people]);
  const leaders = useMemo(
    () =>
      people
        .filter(isProPerson)
        .sort((a, b) => {
          const ta = TIER_ORDER.indexOf(tierOf(a));
          const tb = TIER_ORDER.indexOf(tierOf(b));
          return ta - tb || a.fullName.localeCompare(b.fullName);
        }),
    [people],
  );

  const placeEmployees = useMemo(
    () => (place === "all" ? employees : employees.filter((p) => placeOf(p) === place)),
    [employees, place],
  );

  const titleCounts = useMemo(() => {
    const c: Record<EmployeeTitle, number> = { faol: 0, ishonchli: 0, professional: 0, premium: 0, rivojlanish: 0 };
    for (const p of placeEmployees) {
      const t = titleOf(p);
      if (t) c[t] += 1;
    }
    return c;
  }, [placeEmployees]);

  const tierCounts = useMemo(() => {
    const c: Record<VerifiedTier, { on: number; off: number }> = {
      founder: { on: 0, off: 0 },
      director: { on: 0, off: 0 },
      hr: { on: 0, off: 0 },
      lead: { on: 0, off: 0 },
      master: { on: 0, off: 0 },
    };
    for (const p of leaders) {
      const t = tierOf(p);
      if (p.proHidden) c[t].off += 1;
      else c[t].on += 1;
    }
    return c;
  }, [leaders]);

  const placeCounts = useMemo(() => {
    const base = section === "rahbarlar" ? leaders : employees;
    const c = { all: base.length, ofis: 0, dorixona: 0 };
    for (const p of base) c[placeOf(p)] += 1;
    return c;
  }, [section, leaders, employees]);

  const departments = useMemo(() => {
    const s = new Set<string>();
    for (const p of people) {
      if (place !== "all" && placeOf(p) !== place) continue;
      if (p.departmentName) s.add(p.departmentName);
    }
    return [...s].sort((a, b) => a.localeCompare(b));
  }, [people, place]);

  const matches = (p: TitleAdminPerson) => {
    if (place !== "all" && placeOf(p) !== place) return false;
    if (dept !== "all" && p.departmentName !== dept) return false;
    const words = fold(q).split(" ").filter(Boolean);
    if (!words.length) return true;
    const hay = fold(`${p.fullName} ${userRoleLabel(p.role)} ${p.departmentName ?? ""}`);
    return words.every((w) => hay.includes(w));
  };

  const filteredEmployees = useMemo(
    () =>
      employees
        .filter((p) => {
          const t = titleOf(p);
          if (filter === "with" && !t) return false;
          if (filter === "without" && t) return false;
          if (isEmployeeTitle(filter) && t !== filter) return false;
          return matches(p);
        })
        .sort((a, b) => {
          const ra = titleOf(a) ? EMPLOYEE_TITLE_ORDER.indexOf(titleOf(a)!) : 99;
          const rb = titleOf(b) ? EMPLOYEE_TITLE_ORDER.indexOf(titleOf(b)!) : 99;
          return ra - rb || a.fullName.localeCompare(b.fullName);
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [employees, filter, q, dept, place],
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const filteredLeaders = useMemo(() => leaders.filter(matches), [leaders, q, dept, place]);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: USER_TITLES_ADMIN_KEY });
    void qc.invalidateQueries({ queryKey: USER_TITLES_MAP_KEY });
    void qc.invalidateQueries({ queryKey: USER_TITLES_HISTORY_KEY });
  };

  const titleMut = useMutation({
    mutationFn: (v: { userId: number; title: EmployeeTitle | null; note: string; name: string }) =>
      saveUserTitle(v.userId, v.title, v.note),
    onSuccess: (_r, v) => {
      invalidate();
      setAssignFor(null);
      toast({
        title: v.title ? `${v.name} — «${TITLE_META[v.title].label}»` : `${v.name} — unvon olib qo‘yildi`,
        description: v.title ? "Xodimga bildirishnoma yuborildi." : undefined,
      });
    },
    onError: (e: Error) => toast({ title: "Saqlanmadi", description: e.message, variant: "destructive" }),
  });

  const proMut = useMutation({
    mutationFn: (v: { userId: number; hidden: boolean; note: string }) => saveProHidden(v.userId, v.hidden, v.note),
    onSuccess: (_r, v) => {
      invalidate();
      setProFor(null);
      toast({ title: v.hidden ? "PRO belgisi yashirildi" : "PRO belgisi qaytarildi" });
    },
    onError: (e: Error) => toast({ title: "Saqlanmadi", description: e.message, variant: "destructive" }),
  });

  const tierMut = useMutation({
    mutationFn: (v: { userId: number; tier: VerifiedTier | null; note: string; name: string; revoke?: boolean }) =>
      saveProTier(v.userId, v.tier, v.note),
    onSuccess: (_r, v) => {
      invalidate();
      setAddPro(false);
      toast({
        title: v.tier
          ? `${v.name} — «${PRO_META[v.tier].name}»`
          : v.revoke
            ? `${v.name} PRO’dan chiqarildi`
            : `${v.name} — PRO turi asl holatiga qaytdi`,
        description: v.tier ? "Bildirishnoma yuborildi." : undefined,
      });
    },
    onError: (e: Error) => toast({ title: "Saqlanmadi", description: e.message, variant: "destructive" }),
  });
  const pendingTierUserId = tierMut.isPending && !addPro ? tierMut.variables?.userId : undefined;

  const withTitle = placeEmployees.filter((p) => titleOf(p)).length;
  const pendingUserId = titleMut.isPending && !assignFor ? titleMut.variables?.userId : undefined;
  const pickTitle = (p: TitleAdminPerson, t: EmployeeTitle) => {
    if (titleOf(p) === t) return;
    if (TITLE_META[t].tone === "warning") {
      setAssignFor({ person: p, initial: t });
      return;
    }
    titleMut.mutate({ userId: p.userId, title: t, note: "", name: p.fullName });
  };
  const proOn = leaders.filter((p) => !p.proHidden).length;

  return (
    <div className="flex flex-col gap-5">
      {/* Vitrina */}
      <section className="relative overflow-hidden rounded-[28px] border border-slate-200/80 bg-gradient-to-br from-[#0b1220] via-[#131c33] to-[#1d1236] p-5 text-white shadow-[0_24px_60px_-30px_rgba(15,23,42,0.8)] sm:p-7">
        <div className="pointer-events-none absolute -left-20 -top-28 h-72 w-72 rounded-full bg-amber-400/15 blur-3xl" />
        <div className="pointer-events-none absolute -right-16 bottom-0 h-72 w-72 rounded-full bg-fuchsia-500/15 blur-3xl" />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-amber-200 ring-1 ring-white/15">
              <Award className="h-3.5 w-3.5" /> Unvon berish · faqat admin
            </div>
            <h2 className="mt-3 text-2xl font-bold tracking-tight sm:text-[28px]">Unvonlar va galochkalar</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-slate-300">
              Xodimlarga alohida unvon, rahbarlarga esa alohida <b className="text-amber-200">PRO</b> belgisi. Belgi
              platformaning hamma joyida ism yonida chiqadi, bosilganda izohi ko‘rinadi.
            </p>
          </div>
          <div className="flex gap-2">
            <MiniStat label="Unvonli xodim" value={withTitle} />
            <MiniStat label="PRO rahbar" value={proOn} />
          </div>
        </div>

        <p className="relative mt-6 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Xodimlar unvonlari</p>
        <div className="relative mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {EMPLOYEE_TITLE_ORDER.map((t) => (
            <ShowcaseCard
              key={t}
              kind={{ type: "title", title: t }}
              title={TITLE_META[t].name}
              sub={TITLE_META[t].tagline}
              count={`${titleCounts[t]} xodim`}
              active={section === "xodimlar" && filter === t}
              onFilter={() => {
                setSection("xodimlar");
                setFilter(filter === t ? "all" : t);
                setLimit(PAGE);
              }}
              onInfo={() => setInfo({ type: "title", title: t })}
            />
          ))}
        </div>

        <p className="relative mt-6 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Rahbarlar va PRO xodimlar</p>
        <div className="relative mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {TIER_ORDER.map((t) => (
            <ShowcaseCard
              key={t}
              special={t === "master"}
              kind={{ type: "pro", tier: t }}
              title={PRO_META[t].group}
              sub={PRO_TIER_TEXT[t]?.tagline ?? "Kompaniya professionali"}
              count={`${tierCounts[t].on} faol${tierCounts[t].off ? ` · ${tierCounts[t].off} o‘chirilgan` : ""}`}
              active={false}
              onFilter={() => setSection("rahbarlar")}
              onInfo={() => setInfo({ type: "pro", tier: t })}
            />
          ))}
        </div>
      </section>

      {/* Bo‘limlar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-2xl bg-slate-100 p-1">
          <SectionTab active={section === "xodimlar"} onClick={() => setSection("xodimlar")}>
            <Users className="h-4 w-4" /> Xodimlar <Count n={employees.length} />
          </SectionTab>
          <SectionTab active={section === "rahbarlar"} onClick={() => setSection("rahbarlar")}>
            <Crown className="h-4 w-4" /> Rahbarlar · PRO <Count n={leaders.length} />
          </SectionTab>
          <SectionTab active={section === "tarix"} onClick={() => setSection("tarix")}>
            <History className="h-4 w-4" /> Tarix
          </SectionTab>
        </div>
        <Button variant="outline" size="sm" className="gap-2 rounded-xl" onClick={() => invalidate()} disabled={peopleQ.isFetching}>
          <RefreshCw className={cn("h-4 w-4", peopleQ.isFetching && "animate-spin")} /> Yangilash
        </Button>
      </div>

      {section !== "tarix" ? (
        <div className="flex flex-col gap-3 rounded-[22px] border border-slate-200/80 bg-white p-3 shadow-sm lg:flex-row lg:items-center">
          <div className="inline-flex shrink-0 rounded-xl bg-slate-100 p-1">
            {(
              [
                { id: "all", label: "Hammasi", icon: Users },
                { id: "ofis", label: "Ofis", icon: Building2 },
                { id: "dorixona", label: "Dorixona", icon: Store },
              ] as const
            ).map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => {
                  setPlace(o.id);
                  setDept("all");
                  setLimit(PAGE);
                }}
                className={cn(
                  "inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg px-3 text-sm font-semibold transition",
                  place === o.id ? "bg-white text-[#0b2a46] shadow-sm" : "text-slate-500 hover:text-slate-800",
                )}
              >
                <o.icon className="h-4 w-4" />
                {o.label}
                <Count n={placeCounts[o.id]} />
              </button>
            ))}
          </div>
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setLimit(PAGE);
              }}
              placeholder="Ism, lavozim yoki bo‘lim bo‘yicha qidirish"
              className="h-11 rounded-xl pl-10"
            />
          </div>
          <div className="relative">
            <Building2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <select
              value={dept}
              onChange={(e) => {
                setDept(e.target.value);
                setLimit(PAGE);
              }}
              className="h-11 w-full appearance-none rounded-xl border border-input bg-background pl-9 pr-8 text-sm lg:w-64"
            >
              <option value="all">{place === "dorixona" ? "Barcha filiallar" : "Barcha bo‘limlar"}</option>
              {departments.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>
        </div>
      ) : null}

      {section === "xodimlar" ? (
        <>
          <div className="flex flex-wrap gap-2">
            <Chip active={filter === "all"} onClick={() => setFilter("all")}>
              Hammasi · {placeEmployees.length}
            </Chip>
            <Chip active={filter === "with"} onClick={() => setFilter("with")}>
              Unvonli · {withTitle}
            </Chip>
            <Chip active={filter === "without"} onClick={() => setFilter("without")}>
              Unvonsiz · {placeEmployees.length - withTitle}
            </Chip>
            {EMPLOYEE_TITLE_ORDER.map((t) => (
              <Chip key={t} active={filter === t} onClick={() => setFilter(t)} accent={TITLE_META[t].accent}>
                <BadgeArt kind={{ type: "title", title: t }} px={16} still />
                {TITLE_META[t].label} · {titleCounts[t]}
              </Chip>
            ))}
          </div>

          {peopleQ.isLoading ? (
            <LoadingBox />
          ) : peopleQ.isError && !peopleQ.data ? (
            <EmptyBox text={(peopleQ.error as Error)?.message || "Ma’lumot yuklanmadi"} />
          ) : filteredEmployees.length === 0 ? (
            <EmptyBox text="Mos xodim topilmadi" />
          ) : (
            <>
              <div className="flex items-start gap-2 rounded-2xl border border-sky-200 bg-sky-50/70 px-4 py-2.5 text-xs text-sky-900">
                <Info className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  Xodim qatoridagi unvonni bossangiz — darhol beriladi. Boshqasini bossangiz — o‘zgaradi. <b>Mas’uliyatsiz</b>{" "}
                  belgisi uchun sabab so‘raladi.
                </span>
              </div>
              <div className="overflow-hidden rounded-[22px] border border-slate-200/80 bg-white shadow-sm">
                {filteredEmployees.slice(0, limit).map((p) => (
                  <EmployeeRow
                    key={p.userId}
                    p={p}
                    busy={pendingUserId === p.userId}
                    pendingTitle={pendingUserId === p.userId ? titleMut.variables?.title ?? null : undefined}
                    disabled={titleMut.isPending}
                    onPick={(t) => pickTitle(p, t)}
                    onRemove={() => titleMut.mutate({ userId: p.userId, title: null, note: "", name: p.fullName })}
                    onNote={() => setAssignFor({ person: p, initial: titleOf(p) })}
                    onInfo={setInfo}
                  />
                ))}
              </div>
              {filteredEmployees.length > limit ? (
                <div className="flex justify-center">
                  <Button variant="outline" className="rounded-xl" onClick={() => setLimit((l) => l + PAGE)}>
                    Yana ko‘rsatish ({filteredEmployees.length - limit})
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </>
      ) : null}

      {section === "rahbarlar" ? (
        <>
          <div className="flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50/70 p-4 text-sm text-amber-900 sm:flex-row sm:items-center">
            <Info className="hidden h-4 w-4 shrink-0 sm:block" />
            <p className="flex-1">
              <b>PRO</b> — {PRO_DESCRIPTION} Qatordagi PRO turini bossangiz — o‘sha zahoti o‘zgaradi. Istalgan xodimni{" "}
              <b>«PRO’ga qo‘shish»</b> orqali qo‘shishingiz mumkin.
            </p>
            <Button className="shrink-0 gap-2 rounded-xl bg-[#0f2744] hover:bg-[#16365c]" onClick={() => setAddPro(true)}>
              <UserPlus className="h-4 w-4" /> PRO’ga qo‘shish
            </Button>
          </div>
          {peopleQ.isLoading ? (
            <LoadingBox />
          ) : filteredLeaders.length === 0 ? (
            <EmptyBox text="Mos rahbar topilmadi" />
          ) : (
            <div className="overflow-hidden rounded-[22px] border border-slate-200/80 bg-white shadow-sm">
              {filteredLeaders.map((p) => (
                <LeaderRow
                  key={p.userId}
                  p={p}
                  visBusy={proMut.isPending && proMut.variables?.userId === p.userId}
                  tierBusy={pendingTierUserId === p.userId}
                  pendingTier={pendingTierUserId === p.userId ? tierMut.variables?.tier ?? null : undefined}
                  disabled={tierMut.isPending}
                  onToggle={(on) => {
                    if (on) proMut.mutate({ userId: p.userId, hidden: false, note: "" });
                    else setProFor(p);
                  }}
                  onPickTier={(t) => {
                    if (t === tierOf(p)) return;
                    const roleTier = p.isLeader ? verifiedTier(p.role) : null;
                    tierMut.mutate({ userId: p.userId, tier: t === roleTier ? null : t, note: "", name: p.fullName });
                  }}
                  onRevoke={() => tierMut.mutate({ userId: p.userId, tier: null, note: "", name: p.fullName, revoke: !p.isLeader })}
                  onInfo={setInfo}
                />
              ))}
            </div>
          )}
        </>
      ) : null}

      {section === "tarix" ? <HistoryList q={historyQ} /> : null}

      <AssignDialog
        person={assignFor?.person ?? null}
        initial={assignFor?.initial ?? null}
        busy={titleMut.isPending}
        onClose={() => setAssignFor(null)}
        onSave={(title, note) =>
          assignFor && titleMut.mutate({ userId: assignFor.person.userId, title, note, name: assignFor.person.fullName })
        }
      />
      <ProHideDialog
        person={proFor}
        busy={proMut.isPending}
        onClose={() => setProFor(null)}
        onConfirm={(note) => proFor && proMut.mutate({ userId: proFor.userId, hidden: true, note })}
      />
      <AddProDialog
        open={addPro}
        candidates={employees}
        busy={tierMut.isPending}
        onClose={() => setAddPro(false)}
        onSave={(p, tier, note) => tierMut.mutate({ userId: p.userId, tier, note, name: p.fullName })}
      />
      <Dialog open={!!info} onOpenChange={(o) => !o && setInfo(null)}>
        <DialogContent className="max-w-sm overflow-hidden rounded-2xl p-0">
          <DialogTitle className="sr-only">Belgi izohi</DialogTitle>
          {info ? <BadgeInfoCard kind={info} /> : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ───────────────────────────── Kartalar ───────────────────────────── */

function ShowcaseCard({
  kind,
  title,
  sub,
  count,
  active,
  special = false,
  onFilter,
  onInfo,
}: {
  kind: BadgeKind;
  title: string;
  sub: string;
  count: string;
  active: boolean;
  special?: boolean;
  onFilter: () => void;
  onInfo: () => void;
}) {
  return (
    <div
      className={cn(
        "group relative flex flex-col items-center rounded-2xl bg-white/[0.06] px-3 pb-3 pt-4 text-center ring-1 ring-white/10 transition hover:bg-white/[0.1]",
        special &&
          "bg-[linear-gradient(160deg,rgba(250,204,21,0.16),rgba(0,0,0,0.55)_55%,rgba(250,204,21,0.12))] ring-amber-300/60 shadow-[0_0_28px_-6px_rgba(250,204,21,0.45)]",
        active && "bg-white/[0.14] ring-2 ring-amber-300/70",
      )}
    >
      {special ? (
        <span className="absolute left-2 top-2 rounded-full bg-gradient-to-r from-amber-200 to-yellow-500 px-2 py-px text-[9.5px] font-black uppercase tracking-wider text-black">
          Xodimlar uchun
        </span>
      ) : null}
      <button
        type="button"
        onClick={onInfo}
        className="absolute right-2 top-2 rounded-full p-1 text-white/50 transition hover:bg-white/10 hover:text-white"
        title="Izoh"
      >
        <Info className="h-3.5 w-3.5" />
      </button>
      <button type="button" onClick={onInfo} className="outline-none">
        <BadgeMedal kind={kind} px={60} />
      </button>
      <div className="mt-2 text-[13px] font-semibold leading-tight">{title}</div>
      <div className="text-[11px] text-slate-400">{sub}</div>
      <button
        type="button"
        onClick={onFilter}
        className="mt-2 rounded-full bg-white/10 px-2.5 py-0.5 text-[11px] font-semibold text-white/90 ring-1 ring-white/10 transition hover:bg-white/20"
      >
        {count}
      </button>
    </div>
  );
}

function PersonHead({ p, kind, onInfo }: { p: TitleAdminPerson; kind: BadgeKind | null; onInfo: (k: BadgeKind) => void }) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-slate-700 to-slate-900 text-sm font-bold text-white">
        {initials(p.fullName)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="break-words text-[15px] font-semibold leading-snug text-slate-900">{p.fullName}</span>
          {kind ? (
            <button type="button" onClick={() => onInfo(kind)} className="shrink-0" title="Izoh">
              <BadgeArt kind={kind} px={20} still />
            </button>
          ) : null}
        </div>
        <div className="mt-0.5 text-xs text-slate-500">
          {userRoleLabel(p.role) || p.role}
          {p.departmentName ? ` · ${p.departmentName}` : ""}
        </div>
      </div>
    </div>
  );
}

function EmployeeRow({
  p,
  busy,
  pendingTitle,
  disabled,
  onPick,
  onRemove,
  onNote,
  onInfo,
}: {
  p: TitleAdminPerson;
  busy: boolean;
  pendingTitle: EmployeeTitle | null | undefined;
  disabled: boolean;
  onPick: (t: EmployeeTitle) => void;
  onRemove: () => void;
  onNote: () => void;
  onInfo: (k: BadgeKind) => void;
}) {
  const t = titleOf(p);
  const meta = t ? TITLE_META[t] : null;
  const place = placeOf(p);
  return (
    <div className="relative flex flex-col gap-3 border-b border-slate-100 px-4 py-3.5 last:border-0 xl:flex-row xl:items-center xl:gap-5">
      {meta ? <span className="absolute inset-y-0 left-0 w-1" style={{ background: meta.accent }} /> : null}

      <div className="flex min-w-0 items-start gap-3 xl:w-[320px] xl:shrink-0">
        <div
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-sm font-bold text-white",
            place === "dorixona" ? "bg-gradient-to-br from-emerald-600 to-teal-800" : "bg-gradient-to-br from-slate-700 to-slate-900",
          )}
        >
          {initials(p.fullName)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[14.5px] font-semibold text-slate-900">{p.fullName}</span>
            {t ? (
              <button type="button" onClick={() => onInfo({ type: "title", title: t })} className="shrink-0" title="Izoh">
                <BadgeArt kind={{ type: "title", title: t }} px={18} still />
              </button>
            ) : null}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-slate-500">
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-md px-1.5 py-px text-[10.5px] font-semibold",
                place === "dorixona" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600",
              )}
            >
              {place === "dorixona" ? <Store className="h-3 w-3" /> : <Building2 className="h-3 w-3" />}
              {place === "dorixona" ? "Dorixona" : "Ofis"}
            </span>
            <span className="truncate">
              {userRoleLabel(p.role) || p.role}
              {p.departmentName ? ` · ${p.departmentName}` : ""}
            </span>
          </div>
          {meta && (p.note || p.assignedAt) ? (
            <div className="mt-1 truncate text-[11px] text-slate-400">
              {p.note ? <span className="text-slate-600">“{p.note}” · </span> : null}
              {p.assignedByName ? `${p.assignedByName} · ` : ""}
              {fmtDate(p.assignedAt)}
            </div>
          ) : null}
        </div>
      </div>

      <div className="flex flex-1 flex-wrap items-center gap-1.5">
        {EMPLOYEE_TITLE_ORDER.map((k) => {
          const m = TITLE_META[k];
          const on = t === k;
          const loading = busy && pendingTitle === k;
          return (
            <button
              key={k}
              type="button"
              disabled={disabled && !on}
              onClick={() => onPick(k)}
              title={on ? `Hozirgi unvon: ${m.name}` : `${m.name} berish`}
              className={cn(
                "inline-flex h-9 items-center gap-1.5 rounded-xl border px-2.5 text-[11.5px] font-bold tracking-wide transition disabled:opacity-50",
                on
                  ? "shadow-sm ring-2 ring-offset-1"
                  : "border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-800",
              )}
              style={on ? { borderColor: m.accent, background: m.soft, color: m.accent, ["--tw-ring-color" as string]: `${m.accent}55` } : undefined}
            >
              {loading ? (
                <Loader2 className="h-[18px] w-[18px] animate-spin" />
              ) : (
                <BadgeArt kind={{ type: "title", title: k }} px={18} still />
              )}
              {m.label}
              {on ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : null}
            </button>
          );
        })}
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        {busy && pendingTitle === null ? <Loader2 className="h-4 w-4 animate-spin text-slate-400" /> : null}
        <Button variant="ghost" size="sm" className="h-9 gap-1.5 rounded-xl text-slate-500" onClick={onNote} disabled={disabled}>
          <MessageSquareText className="h-4 w-4" /> Izoh bilan
        </Button>
        {t ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-9 gap-1.5 rounded-xl text-rose-600 hover:bg-rose-50 hover:text-rose-700"
            onClick={onRemove}
            disabled={disabled}
            title="Unvonni olib qo‘yish"
          >
            <Trash2 className="h-4 w-4" /> Olib qo‘yish
          </Button>
        ) : null}
      </div>
    </div>
  );
}

const TIER_SHORT: Record<VerifiedTier, string> = {
  founder: "Asoschi",
  director: "Rahbariyat",
  hr: "HR rahbariyati",
  lead: "Bo‘lim boshlig‘i",
  master: "PRO xodim",
};

function LeaderRow({
  p,
  visBusy,
  tierBusy,
  pendingTier,
  disabled,
  onToggle,
  onPickTier,
  onRevoke,
  onInfo,
}: {
  p: TitleAdminPerson;
  visBusy: boolean;
  tierBusy: boolean;
  pendingTier: VerifiedTier | null | undefined;
  disabled: boolean;
  onToggle: (on: boolean) => void;
  onPickTier: (t: VerifiedTier) => void;
  onRevoke: () => void;
  onInfo: (k: BadgeKind) => void;
}) {
  const tier = tierOf(p);
  const meta = PRO_META[tier];
  const roleTier = p.isLeader ? verifiedTier(p.role) : null;
  const overridden = isProTier(p.proTier) && p.proTier !== roleTier;
  return (
    <div
      className={cn(
        "relative flex flex-col gap-3 border-b border-slate-100 px-4 py-3.5 last:border-0 xl:flex-row xl:items-center xl:gap-5",
        p.proHidden && "bg-slate-50/80",
      )}
    >
      <span className="absolute inset-y-0 left-0 w-1" style={{ background: p.proHidden ? "#CBD5E1" : meta.accent }} />

      <div className="flex min-w-0 items-start gap-3 xl:w-[320px] xl:shrink-0">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-slate-700 to-slate-900 text-sm font-bold text-white">
          {initials(p.fullName)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[14.5px] font-semibold text-slate-900">{p.fullName}</span>
            {!p.proHidden ? (
              <button type="button" onClick={() => onInfo({ type: "pro", tier })} className="shrink-0" title="Izoh">
                <BadgeArt kind={{ type: "pro", tier }} px={18} still />
              </button>
            ) : null}
          </div>
          <div className="mt-0.5 truncate text-xs text-slate-500">
            {userRoleLabel(p.role) || p.role}
            {p.departmentName ? ` · ${p.departmentName}` : ""}
          </div>
          <div className="mt-1 flex flex-wrap gap-1">
            {!p.isLeader ? (
              <span className="rounded-md bg-indigo-50 px-1.5 py-px text-[10.5px] font-semibold text-indigo-700">Admin qo‘shgan</span>
            ) : overridden ? (
              <span className="rounded-md bg-amber-50 px-1.5 py-px text-[10.5px] font-semibold text-amber-700">
                Tur o‘zgartirilgan · asli: {roleTier ? TIER_SHORT[roleTier] : "—"}
              </span>
            ) : null}
            {p.proHidden ? (
              <span className="rounded-md bg-slate-200/70 px-1.5 py-px text-[10.5px] font-semibold text-slate-600">
                Yashirilgan{p.proNote ? ` · ${p.proNote}` : ""}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      <div className="flex flex-1 flex-wrap items-center gap-1.5">
        {TIER_ORDER.map((k) => {
          const m = PRO_META[k];
          const on = tier === k;
          const loading = tierBusy && (pendingTier ?? roleTier) === k;
          return (
            <button
              key={k}
              type="button"
              disabled={disabled && !on}
              onClick={() => onPickTier(k)}
              title={on ? `Hozirgi: ${m.name}` : `${m.name} qilish`}
              className={cn(
                "inline-flex h-9 items-center gap-1.5 rounded-xl border px-2.5 text-[11.5px] font-bold transition disabled:opacity-50",
                on
                  ? "shadow-sm ring-2 ring-offset-1"
                  : "border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-800",
              )}
              style={on ? { borderColor: m.accent, background: m.soft, color: m.accent, ["--tw-ring-color" as string]: `${m.accent}55` } : undefined}
            >
              {loading ? <Loader2 className="h-[18px] w-[18px] animate-spin" /> : <BadgeArt kind={{ type: "pro", tier: k }} px={18} still />}
              {TIER_SHORT[k]}
              {on ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : null}
            </button>
          );
        })}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <label className="inline-flex h-9 items-center gap-2 rounded-xl border border-slate-200 px-2.5 text-xs font-semibold text-slate-600">
          {p.proHidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          {p.proHidden ? "Yashirin" : "Ko‘rinadi"}
          {visBusy ? <Loader2 className="h-4 w-4 animate-spin text-slate-400" /> : <Switch checked={!p.proHidden} onCheckedChange={onToggle} />}
        </label>
        {!p.isLeader ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-9 gap-1.5 rounded-xl text-rose-600 hover:bg-rose-50 hover:text-rose-700"
            onClick={onRevoke}
            disabled={disabled}
          >
            {tierBusy && pendingTier === null ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} PRO’dan chiqarish
          </Button>
        ) : overridden ? (
          <Button variant="ghost" size="sm" className="h-9 gap-1.5 rounded-xl text-slate-500" onClick={onRevoke} disabled={disabled}>
            <RotateCcw className="h-4 w-4" /> Asl turi
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/* ───────────────────────────── Dialoglar ───────────────────────────── */

function AssignDialog({
  person,
  initial,
  busy,
  onClose,
  onSave,
}: {
  person: TitleAdminPerson | null;
  initial: EmployeeTitle | null;
  busy: boolean;
  onClose: () => void;
  onSave: (title: EmployeeTitle | null, note: string) => void;
}) {
  const current = person ? titleOf(person) : null;
  const [picked, setPicked] = useState<EmployeeTitle | null>(null);
  const [note, setNote] = useState("");
  const [openedFor, setOpenedFor] = useState<number | null>(null);
  if (person && openedFor !== person.userId) {
    setOpenedFor(person.userId);
    setPicked(initial ?? current);
    setNote(initial && initial !== current ? "" : person.note ?? "");
  }
  if (!person && openedFor !== null) setOpenedFor(null);

  const pickedMeta = picked ? TITLE_META[picked] : null;

  return (
    <Dialog open={!!person} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-amber-500" /> Unvon berish
          </DialogTitle>
          <DialogDescription>
            {person ? (
              <span className="inline-flex items-center gap-1.5">
                <UserRound className="h-3.5 w-3.5" />
                <b className="text-slate-800">{person.fullName}</b> · {userRoleLabel(person.role) || person.role}
                {person.departmentName ? ` · ${person.departmentName}` : ""}
              </span>
            ) : null}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {EMPLOYEE_TITLE_ORDER.map((t) => {
            const m = TITLE_META[t];
            const on = picked === t;
            return (
              <button
                key={t}
                type="button"
                onClick={() => setPicked(on ? null : t)}
                className={cn(
                  "relative flex flex-col items-center gap-1 rounded-2xl border-2 bg-white px-3 pb-3 pt-4 text-center transition",
                  on ? "shadow-lg" : "border-slate-200 hover:border-slate-300 hover:shadow-sm",
                  m.tone === "warning" && !on && "bg-rose-50/40",
                )}
                style={on ? { borderColor: m.accent, background: m.soft } : undefined}
              >
                {current === t ? (
                  <span className="absolute left-2 top-2 rounded-full bg-slate-900 px-2 py-0.5 text-[10px] font-semibold text-white">Hozirgi</span>
                ) : null}
                <BadgeMedal kind={{ type: "title", title: t }} px={58} still={!on} />
                <div className="mt-1.5 text-sm font-semibold text-slate-900">{m.name}</div>
                <div className="text-[11px] font-medium" style={{ color: m.accent }}>
                  {m.tagline}
                </div>
                <p className="mt-1 line-clamp-3 text-[11.5px] leading-snug text-slate-500">{m.description}</p>
              </button>
            );
          })}
        </div>

        {pickedMeta?.tone === "warning" ? (
          <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
            Bu ogohlantirish belgisi — hamma xodimlarga ko‘rinadi. Xodimga ogohlantirish xabari yuboriladi; xulqi tuzalgach
            belgini olib qo‘yish tavsiya etiladi.
          </div>
        ) : null}

        <div>
          <label className="mb-1.5 block text-xs font-semibold text-slate-600">
            {pickedMeta?.tone === "warning" ? "Sabab (majburiy) — nima uchun berilmoqda" : "Izoh (ixtiyoriy) — nima uchun berilmoqda"}
          </label>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            rows={2}
            placeholder={pickedMeta?.tone === "warning" ? "Masalan: bir oyda 5 marta kechikdi, 3 ta topshiriq bajarilmadi" : "Masalan: oy davomida 0 kechikish, rejadan oshirib bajardi"}
            className="rounded-xl"
          />
        </div>

        <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-between">
          {current ? (
            <Button variant="ghost" className="gap-2 text-rose-600 hover:bg-rose-50 hover:text-rose-700" disabled={busy} onClick={() => onSave(null, note)}>
              <Trash2 className="h-4 w-4" /> Unvonni olib qo‘yish
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={busy}>
              Bekor qilish
            </Button>
            <Button
              disabled={
                busy ||
                !picked ||
                (picked === current && note === (person?.note ?? "")) ||
                (pickedMeta?.tone === "warning" && !note.trim())
              }
              onClick={() => onSave(picked, note)}
              className="gap-2"
              style={pickedMeta ? { background: pickedMeta.accent } : undefined}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Award className="h-4 w-4" />}
              {picked ? `«${TITLE_META[picked].label}» berish` : "Unvon tanlang"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ProHideDialog({
  person,
  busy,
  onClose,
  onConfirm,
}: {
  person: TitleAdminPerson | null;
  busy: boolean;
  onClose: () => void;
  onConfirm: (note: string) => void;
}) {
  const [note, setNote] = useState("");
  const tier = person ? tierOf(person) : null;
  return (
    <Dialog
      open={!!person}
      onOpenChange={(o) => {
        if (!o) {
          setNote("");
          onClose();
        }
      }}
    >
      <DialogContent className="max-w-md rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <EyeOff className="h-5 w-5 text-slate-500" /> PRO belgisini olib qo‘yish
          </DialogTitle>
          <DialogDescription>
            {person ? (
              <>
                <b className="text-slate-800">{person.fullName}</b> ismi yonidagi PRO belgisi hamma joyda yashiriladi. Istalgan
                vaqtda qaytarish mumkin.
              </>
            ) : null}
          </DialogDescription>
        </DialogHeader>
        {tier ? (
          <div className="flex justify-center py-1 opacity-60 grayscale">
            <BadgeMedal kind={{ type: "pro", tier }} px={56} still />
          </div>
        ) : null}
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500} placeholder="Sabab (ixtiyoriy)" className="rounded-xl" />
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Bekor qilish
          </Button>
          <Button
            variant="destructive"
            disabled={busy}
            onClick={() => {
              onConfirm(note);
              setNote("");
            }}
            className="gap-2"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <EyeOff className="h-4 w-4" />} Yashirish
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddProDialog({
  open,
  candidates,
  busy,
  onClose,
  onSave,
}: {
  open: boolean;
  candidates: TitleAdminPerson[];
  busy: boolean;
  onClose: () => void;
  onSave: (p: TitleAdminPerson, tier: VerifiedTier, note: string) => void;
}) {
  const [q, setQ] = useState("");
  const [person, setPerson] = useState<TitleAdminPerson | null>(null);
  const [tier, setTier] = useState<VerifiedTier>("master");
  const [note, setNote] = useState("");
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setQ("");
      setPerson(null);
      setTier("master");
      setNote("");
    }
  }

  const list = useMemo(() => {
    const words = fold(q).split(" ").filter(Boolean);
    return candidates
      .filter((p) => {
        if (!words.length) return true;
        const hay = fold(`${p.fullName} ${userRoleLabel(p.role)} ${p.departmentName ?? ""}`);
        return words.every((w) => hay.includes(w));
      })
      .slice(0, 40);
  }, [candidates, q]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5 text-indigo-600" /> PRO’ga qo‘shish
          </DialogTitle>
          <DialogDescription>Xodimni tanlang va unga beriladigan PRO turini belgilang.</DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <div className="text-xs font-semibold text-slate-600">1. Xodim</div>
          {person ? (
            <div className="flex items-center gap-3 rounded-xl border border-indigo-200 bg-indigo-50/60 px-3 py-2.5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-slate-700 to-slate-900 text-xs font-bold text-white">
                {initials(person.fullName)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-slate-900">{person.fullName}</div>
                <div className="truncate text-xs text-slate-500">
                  {userRoleLabel(person.role) || person.role}
                  {person.departmentName ? ` · ${person.departmentName}` : ""}
                </div>
              </div>
              <Button variant="ghost" size="sm" className="rounded-lg" onClick={() => setPerson(null)}>
                Boshqasi
              </Button>
            </div>
          ) : (
            <>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ism, lavozim yoki bo‘lim" className="h-10 rounded-xl pl-9" autoFocus />
              </div>
              <div className="max-h-64 overflow-y-auto rounded-xl border border-slate-200">
                {list.length === 0 ? (
                  <div className="py-8 text-center text-sm text-slate-400">Xodim topilmadi</div>
                ) : (
                  list.map((p) => (
                    <button
                      key={p.userId}
                      type="button"
                      onClick={() => setPerson(p)}
                      className="flex w-full items-center gap-3 border-b border-slate-100 px-3 py-2 text-left last:border-0 hover:bg-slate-50"
                    >
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-800 text-[11px] font-bold text-white">
                        {initials(p.fullName)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-slate-900">{p.fullName}</div>
                        <div className="truncate text-[11px] text-slate-500">
                          {userRoleLabel(p.role) || p.role}
                          {p.departmentName ? ` · ${p.departmentName}` : ""}
                        </div>
                      </div>
                      {titleOf(p) ? <BadgeArt kind={{ type: "title", title: titleOf(p)! }} px={18} still /> : null}
                    </button>
                  ))
                )}
              </div>
            </>
          )}
        </div>

        <div className="space-y-2">
          <div className="text-xs font-semibold text-slate-600">2. PRO turi</div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {TIER_ORDER.map((t) => {
              const m = PRO_META[t];
              const on = tier === t;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTier(t)}
                  className={cn(
                    "flex flex-col items-center gap-1 rounded-2xl border-2 bg-white px-2 pb-2.5 pt-3 text-center transition",
                    on ? "shadow-md" : "border-slate-200 hover:border-slate-300",
                  )}
                  style={on ? { borderColor: m.accent, background: m.soft } : undefined}
                >
                  <BadgeMedal kind={{ type: "pro", tier: t }} px={44} still={!on} />
                  <div className="mt-1 text-xs font-semibold text-slate-900">{TIER_SHORT[t]}</div>
                </button>
              );
            })}
          </div>
        </div>

        {person && titleOf(person) ? (
          <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
            Xodimning hozirgi «{TITLE_META[titleOf(person)!].label}» unvoni PRO bilan almashtiriladi.
          </div>
        ) : null}

        <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500} placeholder="Izoh (ixtiyoriy)" className="rounded-xl" />

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Bekor qilish
          </Button>
          <Button
            disabled={busy || !person}
            onClick={() => person && onSave(person, tier, note)}
            className="gap-2"
            style={{ background: PRO_META[tier].accent }}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Crown className="h-4 w-4" />}
            {person ? `«${PRO_META[tier].name}» berish` : "Xodimni tanlang"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ───────────────────────────── Tarix ───────────────────────────── */

function historyText(r: TitleHistoryRow): { text: string; kind: BadgeKind | null; tone: string } {
  const t = isEmployeeTitle(r.title) ? r.title : null;
  const prev = isEmployeeTitle(r.prevTitle) ? r.prevTitle : null;
  const tier = verifiedTier(r.role);
  switch (r.action) {
    case "assign":
      return {
        text: prev && prev !== t ? `${TITLE_META[prev].label} → ${t ? TITLE_META[t].label : ""}` : `${t ? TITLE_META[t].label : ""} unvoni berildi`,
        kind: t ? { type: "title", title: t } : null,
        tone: "text-emerald-700",
      };
    case "remove":
      return { text: `${prev ? TITLE_META[prev].label : "Unvon"} olib qo‘yildi`, kind: prev ? { type: "title", title: prev } : null, tone: "text-rose-600" };
    case "pro_hide":
      return { text: "PRO belgisi o‘chirildi", kind: tier ? { type: "pro", tier } : null, tone: "text-slate-600" };
    case "pro_show":
      return { text: "PRO belgisi qaytarildi", kind: tier ? { type: "pro", tier } : null, tone: "text-indigo-700" };
    case "pro_grant": {
      const nt = isProTier(r.title) ? r.title : null;
      const pt = isProTier(r.prevTitle) ? r.prevTitle : null;
      return {
        text: nt ? (pt && pt !== nt ? `${PRO_META[pt].name} → ${PRO_META[nt].name}` : `${PRO_META[nt].name} berildi`) : "PRO berildi",
        kind: nt ? { type: "pro", tier: nt } : null,
        tone: "text-indigo-700",
      };
    }
    case "pro_revoke": {
      const pt = isProTier(r.prevTitle) ? r.prevTitle : null;
      return {
        text: tier ? `PRO turi asl holatiga qaytdi (${PRO_META[tier].name})` : `${pt ? PRO_META[pt].name : "PRO"} olib tashlandi`,
        kind: tier ? { type: "pro", tier } : pt ? { type: "pro", tier: pt } : null,
        tone: tier ? "text-slate-600" : "text-rose-600",
      };
    }
    default:
      return { text: r.action, kind: null, tone: "text-slate-600" };
  }
}

function HistoryList({ q }: { q: { data?: TitleHistoryRow[]; isLoading: boolean; isError: boolean } }) {
  if (q.isLoading) return <LoadingBox />;
  if (q.isError) return <EmptyBox text="Tarix yuklanmadi" />;
  const rows = q.data ?? [];
  if (!rows.length) return <EmptyBox text="Hali hech qanday o‘zgarish yo‘q" />;
  return (
    <div className="overflow-hidden rounded-[22px] border border-slate-200/80 bg-white shadow-sm">
      {rows.map((r) => {
        const h = historyText(r);
        return (
          <div key={r.id} className="flex items-start gap-3 border-b border-slate-100 px-4 py-3 last:border-0">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center">
              {h.kind ? <BadgeArt kind={h.kind} px={26} still /> : <Award className="h-5 w-5 text-slate-300" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm">
                <b className="text-slate-900">{r.fullName || `#${r.userId}`}</b>{" "}
                <span className={cn("font-medium", h.tone)}>{h.text}</span>
              </div>
              {r.note ? <div className="mt-0.5 text-xs text-slate-500">“{r.note}”</div> : null}
            </div>
            <div className="shrink-0 text-right text-[11px] text-slate-400">
              <div>{fmtDate(r.createdAt)}</div>
              {r.actorName ? <div className="text-slate-500">{r.actorName}</div> : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ───────────────────────────── Mayda qismlar ───────────────────────────── */

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl bg-white/10 px-4 py-2.5 ring-1 ring-white/15">
      <div className="text-xl font-bold tabular-nums">{value}</div>
      <div className="text-[11px] text-slate-300">{label}</div>
    </div>
  );
}

function SectionTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-9 items-center gap-1.5 rounded-xl px-3.5 text-sm font-semibold transition",
        active ? "bg-white text-[#0b2a46] shadow-sm" : "text-slate-500 hover:text-slate-800",
      )}
    >
      {children}
    </button>
  );
}

function Count({ n }: { n: number }) {
  return <span className="rounded-full bg-slate-200/80 px-1.5 text-[11px] tabular-nums text-slate-600">{n}</span>;
}

function Chip({ active, onClick, children, accent }: { active: boolean; onClick: () => void; children: ReactNode; accent?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition",
        active ? "border-transparent bg-[#0f2744] text-white shadow-sm" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300",
      )}
      style={active && accent ? { background: accent } : undefined}
    >
      {children}
    </button>
  );
}

function LoadingBox() {
  return (
    <div className="flex items-center justify-center gap-2 rounded-[22px] border border-slate-200/80 bg-white py-16 text-sm text-slate-500">
      <Loader2 className="h-4 w-4 animate-spin" /> Yuklanmoqda…
    </div>
  );
}

function EmptyBox({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-[22px] border border-dashed border-slate-200 bg-white py-14 text-sm text-slate-500">
      <X className="h-5 w-5 text-slate-300" />
      {text}
    </div>
  );
}
