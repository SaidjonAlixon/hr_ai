import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  Archive,
  ArrowUpRight,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Clock3,
  Crown,
  FileSpreadsheet,
  FileText,
  Hourglass,
  LayoutTemplate,
  PanelRightClose,
  PanelRightOpen,
  PlayCircle,
  Sparkles,
  Timer,
  Trophy,
  X,
  Zap,
} from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useI18n } from "@/i18n/I18nProvider";
import { isTaskOverdue } from "@/lib/vazifalar-permissions";
import type { Vazifa } from "@/lib/vazifalar-api";
import { cn } from "@/lib/utils";

export type StaffPeriod = "week" | "month" | "all";

export const SCORE_RULES = {
  verified: 5,
  onTime: 2,
  review: 3,
  progress: 1,
  overdue: -3,
} as const;

export type StaffRank = {
  key: string;
  name: string;
  score: number;
  total: number;
  verified: number;
  onTime: number;
  review: number;
  progress: number;
  todo: number;
  overdue: number;
  tasks: Vazifa[];
};

function dayStart(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function periodStart(period: StaffPeriod, now: Date): Date | null {
  if (period === "all") return null;
  if (period === "month") return new Date(now.getFullYear(), now.getMonth(), 1);
  const today = dayStart(now);
  const shift = (today.getDay() + 6) % 7;
  today.setDate(today.getDate() - shift);
  return today;
}

function submittedOnTime(task: Vazifa) {
  if (!task.completedAt || !task.dueAt) return false;
  return new Date(task.completedAt).getTime() <= new Date(task.dueAt).getTime();
}

type DayTone = "red" | "amber" | "green" | "done";

function dayTone(list: Vazifa[], now: Date): DayTone {
  const open = list.filter((t) => t.status !== "verified" && t.status !== "cancelled" && t.status !== "done");
  if (!open.length) return "done";
  const today = dayStart(now).getTime();
  const minDays = Math.min(
    ...open.map((t) =>
      t.dueAt ? Math.round((dayStart(new Date(t.dueAt)).getTime() - today) / 86400000) : 99,
    ),
  );
  if (minDays <= 3) return "red";
  if (minDays <= 7) return "amber";
  return "green";
}

const TONE_CELL: Record<DayTone, string> = {
  red: "bg-rose-500/10 text-rose-700 hover:bg-rose-500/15 dark:text-rose-300",
  amber: "bg-amber-500/10 text-amber-800 hover:bg-amber-500/15 dark:text-amber-300",
  green: "bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/15 dark:text-emerald-300",
  done: "bg-slate-500/10 text-slate-600 hover:bg-slate-500/15 dark:text-slate-300",
};

const TONE_BADGE: Record<DayTone, string> = {
  red: "bg-rose-500 text-white",
  amber: "bg-amber-500 text-white",
  green: "bg-emerald-500 text-white",
  done: "bg-slate-400 text-white",
};

const TONE_LEGEND: Record<DayTone, string> = {
  red: "bg-rose-500/80",
  amber: "bg-amber-500/80",
  green: "bg-emerald-500/80",
  done: "bg-slate-400/80",
};

export function rankActiveStaff(
  tasks: Vazifa[],
  period: StaffPeriod,
  now = new Date(),
): StaffRank[] {
  const start = periodStart(period, now)?.getTime() ?? null;
  const map = new Map<string, StaffRank>();
  for (const task of tasks) {
    if (task.status === "cancelled") continue;
    const name = (task.assigneeName || "").trim();
    if (!name) continue;
    if (start != null) {
      const touched = [task.createdAt, task.completedAt, task.dueAt, task.acceptedAt].some(
        (d) => d && new Date(d).getTime() >= start,
      );
      if (!touched) continue;
    }
    const key = `${task.assigneeKind}:${task.assigneeId}`;
    let row = map.get(key);
    if (!row) {
      row = {
        key,
        name,
        score: 0,
        total: 0,
        verified: 0,
        onTime: 0,
        review: 0,
        progress: 0,
        todo: 0,
        overdue: 0,
        tasks: [],
      };
      map.set(key, row);
    }
    row.total += 1;
    row.tasks.push(task);
    if (task.status === "verified") {
      row.verified += 1;
      if (submittedOnTime(task)) row.onTime += 1;
    } else if (task.status === "done") {
      row.review += 1;
      if (submittedOnTime(task)) row.onTime += 1;
    } else if (isTaskOverdue(task, now)) {
      row.overdue += 1;
    } else if (task.status === "in_progress") {
      row.progress += 1;
    } else {
      row.todo += 1;
    }
  }
  for (const row of map.values()) {
    const raw =
      row.verified * SCORE_RULES.verified +
      row.onTime * SCORE_RULES.onTime +
      row.review * SCORE_RULES.review +
      row.progress * SCORE_RULES.progress +
      row.overdue * SCORE_RULES.overdue;
    row.score = Math.max(0, raw);
    row.tasks.sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
  }
  return Array.from(map.values())
    .filter((r) => r.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.verified - a.verified ||
        b.onTime - a.onTime ||
        a.name.localeCompare(b.name),
    );
}

const TXT = {
  uz: {
    collapse: "Panelni yopish",
    expand: "Panelni ochish",
    panel: "Tezkor panel",
    today: "Bugun",
    calendar: "Kalendar",
    legendTitle: "Muddat:",
    legend: { red: "≤3 kun", amber: "4–7 kun", green: "8+ kun", done: "Bajarilgan" } as Record<DayTone, string>,
    weekdayLong: ["Dushanba", "Seshanba", "Chorshanba", "Payshanba", "Juma", "Shanba", "Yakshanba"],
    chipLate: "kechikkan",
    chipActive: "faol",
    chipDone: "bajarilgan",
    freeDay: "Bu kunga topshiriq rejalashtirilmagan",
    dayTasks: (n: number) => (n ? `${n} ta topshiriq` : "Topshiriq yo‘q"),
    schedule: "Bugungi jadval",
    scheduleEmpty: "Bugun uchun topshiriq yo‘q",
    late: "Kechikkan",
    top: "Top 5 faol xodim",
    periods: { week: "Hafta", month: "Oy", all: "Hammasi" } as Record<StaffPeriod, string>,
    periodLong: { week: "Bu hafta", month: "Bu oy", all: "Barcha davr" } as Record<StaffPeriod, string>,
    pts: "ball",
    topEmpty: "Bu davrda ball to‘plagan xodim yo‘q",
    howTitle: "Ball qanday hisoblanadi?",
    howFoot:
      "Faqat hozirgi filtrlar bo‘yicha ko‘rinayotgan topshiriqlar hisobga olinadi. Ball teng bo‘lsa, ko‘proq tasdiqlangan topshirig‘i bor xodim yuqorida turadi.",
    ruleVerified: "Bajarildi va tasdiqlandi",
    ruleOnTime: "Muddatidan oldin topshirildi",
    ruleReview: "Tekshiruvga topshirildi",
    ruleProgress: "Ustida ishlamoqda",
    ruleOverdue: "Kechiktirilgan",
    clickHint: "Batafsil ko‘rish uchun xodimni bosing",
    quick: "Tezkor amallar",
    rank: (n: number) => `${n}-o‘rin`,
    whyTitle: "Nima uchun topda?",
    breakdown: "Ball tarkibi",
    total: "Jami",
    discipline: "Muddatga rioya",
    disciplineHint: (a: number, b: number) => `${b} ta topshirilgandan ${a} tasi muddatida`,
    noSubmitted: "Hali topshirilgan ish yo‘q",
    recent: "So‘nggi topshiriqlari",
    tasksCount: (n: number) => `${n} ta topshiriq`,
    rVerified: (n: number) => `${n} ta topshiriqni bajarib, rahbarga tasdiqlatgan`,
    rOnTime: (n: number) => `${n} tasini muddatidan oldin topshirgan`,
    rReview: (n: number) => `${n} ta ishi hozir tekshiruvda`,
    rProgress: (n: number) => `${n} ta topshiriq ustida faol ishlamoqda`,
    rOverdue: (n: number) => `${n} ta topshiriq kechikkan — ball kamaygan`,
    rNoOverdue: "Birorta ham kechikkan topshirig‘i yo‘q",
    leadAhead: (d: number) => `Keyingi o‘rindagidan ${d} ball oldinda`,
    leadBehind: (r: number, d: number) => `${r}-o‘rindagidan ${d} ball orqada`,
    leadTie: "Keyingi o‘rindagi bilan teng ballda",
    status: {
      todo: "Yangi",
      in_progress: "Jarayonda",
      done: "Tekshiruvda",
      verified: "Tasdiqlangan",
      cancelled: "Bekor",
      overdue: "Kechikkan",
    },
  },
  ru: {
    collapse: "Скрыть панель",
    expand: "Открыть панель",
    panel: "Быстрая панель",
    today: "Сегодня",
    calendar: "Календарь",
    legendTitle: "Срок:",
    legend: { red: "≤3 дн.", amber: "4–7 дн.", green: "8+ дн.", done: "Выполнено" } as Record<DayTone, string>,
    weekdayLong: ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота", "Воскресенье"],
    chipLate: "просроч.",
    chipActive: "активн.",
    chipDone: "выполн.",
    freeDay: "На этот день задач нет",
    dayTasks: (n: number) => (n ? `${n} задач(и)` : "Задач нет"),
    schedule: "Расписание на сегодня",
    scheduleEmpty: "На сегодня задач нет",
    late: "Просрочено",
    top: "Топ-5 активных",
    periods: { week: "Неделя", month: "Месяц", all: "Всё" } as Record<StaffPeriod, string>,
    periodLong: { week: "Эта неделя", month: "Этот месяц", all: "Весь период" } as Record<StaffPeriod, string>,
    pts: "балл.",
    topEmpty: "За период нет сотрудников с баллами",
    howTitle: "Как считаются баллы?",
    howFoot:
      "Учитываются только задачи, видимые по текущим фильтрам. При равенстве баллов выше тот, у кого больше подтверждённых задач.",
    ruleVerified: "Выполнено и подтверждено",
    ruleOnTime: "Сдано до срока",
    ruleReview: "Сдано на проверку",
    ruleProgress: "В работе",
    ruleOverdue: "Просрочено",
    clickHint: "Нажмите на сотрудника для подробностей",
    quick: "Быстрые действия",
    rank: (n: number) => `${n}-е место`,
    whyTitle: "Почему в топе?",
    breakdown: "Состав баллов",
    total: "Итого",
    discipline: "Соблюдение сроков",
    disciplineHint: (a: number, b: number) => `${a} из ${b} сданных — в срок`,
    noSubmitted: "Пока нет сданных задач",
    recent: "Последние задачи",
    tasksCount: (n: number) => `${n} задач(и)`,
    rVerified: (n: number) => `Выполнил(а) и подтвердил(а) ${n} задач(и)`,
    rOnTime: (n: number) => `${n} из них сдано до срока`,
    rReview: (n: number) => `${n} задач(и) сейчас на проверке`,
    rProgress: (n: number) => `Активно работает над ${n} задач(ами)`,
    rOverdue: (n: number) => `${n} просроченных задач(и) — баллы снижены`,
    rNoOverdue: "Нет ни одной просроченной задачи",
    leadAhead: (d: number) => `Опережает следующего на ${d} балл.`,
    leadBehind: (r: number, d: number) => `Отстаёт от ${r}-го места на ${d} балл.`,
    leadTie: "Столько же баллов, сколько у следующего",
    status: {
      todo: "Новая",
      in_progress: "В работе",
      done: "На проверке",
      verified: "Подтверждена",
      cancelled: "Отменена",
      overdue: "Просрочена",
    },
  },
};

type Txt = (typeof TXT)["uz"];

const COLLAPSED_KEY = "vazifalar.sidebar.collapsed";
const SECTIONS_KEY = "vazifalar.sidebar.closedSections";
const PERIOD_KEY = "vazifalar.sidebar.topPeriod";

type SectionId = "calendar" | "schedule" | "top" | "quick";

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() || "")
    .join("");
}

const MEDALS = [
  {
    ring: "ring-amber-400/70",
    avatar: "bg-gradient-to-br from-amber-300 to-amber-500 text-amber-950",
    badge: "bg-amber-400 text-amber-950",
    bar: "from-amber-400 to-amber-500",
  },
  {
    ring: "ring-slate-300/80",
    avatar: "bg-gradient-to-br from-slate-200 to-slate-400 text-slate-800",
    badge: "bg-slate-300 text-slate-800",
    bar: "from-slate-400 to-slate-500",
  },
  {
    ring: "ring-orange-300/70",
    avatar: "bg-gradient-to-br from-orange-300 to-orange-500 text-orange-950",
    badge: "bg-orange-400 text-orange-950",
    bar: "from-orange-400 to-orange-500",
  },
];

const PLAIN_MEDAL = {
  ring: "ring-transparent",
  avatar: "bg-[#0b3a5c] text-white dark:bg-primary dark:text-primary-foreground",
  badge: "bg-muted text-muted-foreground",
  bar: "from-[#0b3a5c] to-[#1e5f8c] dark:from-primary dark:to-primary",
};

function medalFor(idx: number) {
  return MEDALS[idx] ?? PLAIN_MEDAL;
}

function Section({
  id,
  icon,
  iconTone,
  title,
  right,
  open,
  onToggle,
  children,
  sectionRef,
}: {
  id: SectionId;
  icon: ReactNode;
  iconTone: string;
  title: string;
  right?: ReactNode;
  open: boolean;
  onToggle: (id: SectionId) => void;
  children: ReactNode;
  sectionRef?: (el: HTMLDivElement | null) => void;
}) {
  return (
    <div
      ref={sectionRef}
      className="shrink-0 scroll-mt-3 overflow-hidden rounded-2xl border border-border/70 bg-card shadow-[0_1px_2px_rgba(15,39,68,0.04),0_8px_24px_-12px_rgba(15,39,68,0.12)] dark:shadow-black/20"
    >
      <div className="flex items-center gap-2.5 px-3.5 py-3">
        <span
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-xl",
            iconTone,
          )}
        >
          {icon}
        </span>
        <button
          type="button"
          onClick={() => onToggle(id)}
          className="min-w-0 flex-1 truncate text-left text-[13px] font-bold tracking-tight text-foreground"
        >
          {title}
        </button>
        {right}
        <button
          type="button"
          onClick={() => onToggle(id)}
          aria-expanded={open}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground"
        >
          <ChevronDown
            className={cn("h-4 w-4 transition-transform duration-200", !open && "-rotate-90")}
          />
        </button>
      </div>
      <div
        className={cn(
          "grid transition-[grid-template-rows] duration-300 ease-out",
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div className="min-h-0 overflow-hidden" inert={!open}>
          <div className="px-3.5 pb-3.5">{children}</div>
        </div>
      </div>
    </div>
  );
}

export type TasksSidebarProps = {
  tasks: Vazifa[];
  scheduleTasks: Vazifa[];
  month: Date;
  onMonthChange: (d: Date) => void;
  selectedDay: Date;
  onPickDay: (d: Date) => void;
  weekDays: string[];
  formatMonth: (d: Date) => string;
  accentClass: (task: Vazifa) => string;
  onOpenTask: (task: Vazifa) => void;
  quickLabels: { excel: string; pdf: string; templates: string; archive: string };
  onExcel: () => void;
  onPdf: () => void;
  onTemplates: () => void;
  onArchive: () => void;
};

export function TasksSidebar(props: TasksSidebarProps) {
  const { locale } = useI18n();
  const tx: Txt = locale === "ru" ? TXT.ru : TXT.uz;

  const [collapsed, setCollapsed] = useState<boolean>(() => readJson(COLLAPSED_KEY, false));
  const [closed, setClosed] = useState<SectionId[]>(() => readJson(SECTIONS_KEY, []));
  const [period, setPeriod] = useState<StaffPeriod>(() => readJson(PERIOD_KEY, "week"));
  const [detail, setDetail] = useState<number | null>(null);
  const refs = useRef<Partial<Record<SectionId, HTMLDivElement | null>>>({});
  const pendingScroll = useRef<SectionId | null>(null);

  useEffect(() => writeJson(COLLAPSED_KEY, collapsed), [collapsed]);
  useEffect(() => writeJson(SECTIONS_KEY, closed), [closed]);
  useEffect(() => writeJson(PERIOD_KEY, period), [period]);

  useEffect(() => {
    if (collapsed || !pendingScroll.current) return;
    const id = pendingScroll.current;
    pendingScroll.current = null;
    const t = window.setTimeout(() => {
      refs.current[id]?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 320);
    return () => window.clearTimeout(t);
  }, [collapsed]);

  const toggleSection = (id: SectionId) =>
    setClosed((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const openFromRail = (id: SectionId) => {
    setClosed((prev) => prev.filter((x) => x !== id));
    pendingScroll.current = id;
    setCollapsed(false);
  };

  const ranking = useMemo(() => rankActiveStaff(props.tasks, period), [props.tasks, period]);
  const top = ranking.slice(0, 5);
  const maxScore = Math.max(1, ...top.map((r) => r.score));

  const now = new Date();
  const todayTs = dayStart(now).getTime();
  const overdueToday = props.scheduleTasks.filter((t) => isTaskOverdue(t, now)).length;

  const railItems: Array<{ id: SectionId; icon: ReactNode; label: string; badge?: number }> = [
    { id: "calendar", icon: <CalendarDays className="h-[18px] w-[18px]" />, label: props.formatMonth(props.month) },
    {
      id: "schedule",
      icon: <Clock3 className="h-[18px] w-[18px]" />,
      label: tx.schedule,
      badge: props.scheduleTasks.length || undefined,
    },
    { id: "top", icon: <Trophy className="h-[18px] w-[18px]" />, label: tx.top },
    { id: "quick", icon: <Zap className="h-[18px] w-[18px]" />, label: tx.quick },
  ];

  if (collapsed) {
    return (
      <aside className="hidden w-[60px] shrink-0 flex-col items-center gap-2 border-l border-border/70 bg-gradient-to-b from-card to-muted/30 py-4 transition-[width] duration-300 xl:flex">
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          title={tx.expand}
          aria-label={tx.expand}
          className="mb-2 flex h-10 w-10 items-center justify-center rounded-xl bg-[#0b3a5c] text-white shadow-md shadow-[#0b3a5c]/25 transition hover:scale-105 hover:bg-[#0f4a74] dark:bg-primary dark:text-primary-foreground"
        >
          <PanelRightOpen className="h-[18px] w-[18px]" />
        </button>
        <span className="mb-1 h-px w-8 bg-border" />
        {railItems.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => openFromRail(item.id)}
            title={item.label}
            aria-label={item.label}
            className="relative flex h-10 w-10 items-center justify-center rounded-xl text-muted-foreground transition hover:bg-[#0b3a5c]/10 hover:text-[#0b3a5c] dark:hover:bg-primary/15 dark:hover:text-primary"
          >
            {item.icon}
            {item.badge ? (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white ring-2 ring-card">
                {item.badge > 9 ? "9+" : item.badge}
              </span>
            ) : null}
          </button>
        ))}
        <div className="mt-auto flex flex-col items-center rounded-xl border border-border/70 bg-card px-2 py-1.5 text-center shadow-sm">
          <span className="text-[9px] font-semibold uppercase text-muted-foreground">
            {props.weekDays[(now.getDay() + 6) % 7]}
          </span>
          <span className="text-base font-extrabold leading-none text-[#0b3a5c] dark:text-primary">
            {now.getDate()}
          </span>
        </div>
      </aside>
    );
  }

  const calYear = props.month.getFullYear();
  const calMo = props.month.getMonth();
  const startWeekday = (new Date(calYear, calMo, 1).getDay() + 6) % 7;
  const gridStart = new Date(calYear, calMo, 1 - startWeekday);
  const daysInMonth = new Date(calYear, calMo + 1, 0).getDate();
  const cellCount = Math.ceil((startWeekday + daysInMonth) / 7) * 7;
  const cells = Array.from({ length: cellCount }, (_, i) =>
    new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i),
  );
  const selectedTs = dayStart(props.selectedDay).getTime();
  const tasksByDay = new Map<number, Vazifa[]>();
  for (const task of props.tasks) {
    if (!task.dueAt) continue;
    const ts = dayStart(new Date(task.dueAt)).getTime();
    const list = tasksByDay.get(ts) ?? [];
    list.push(task);
    tasksByDay.set(ts, list);
  }
  const selectedTasks = tasksByDay.get(selectedTs) ?? [];
  const selectedDone = selectedTasks.filter((t) => t.status === "verified" || t.status === "done").length;
  const selectedLate = selectedTasks.filter(
    (t) => t.status !== "verified" && t.status !== "done" && t.status !== "cancelled" && isTaskOverdue(t, now),
  ).length;
  const selectedActive = selectedTasks.length - selectedDone - selectedLate;

  const detailRow = detail != null ? top[detail] : null;

  return (
    <aside className="hidden w-[304px] shrink-0 flex-col border-l border-border/70 bg-gradient-to-b from-muted/40 via-background to-background transition-[width] duration-300 xl:flex">
      <div className="flex items-center justify-between gap-2 border-b border-border/60 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#0b3a5c] text-white dark:bg-primary dark:text-primary-foreground">
            <Sparkles className="h-3.5 w-3.5" />
          </span>
          <span className="text-[13px] font-bold tracking-tight text-foreground">{tx.panel}</span>
        </div>
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          title={tx.collapse}
          aria-label={tx.collapse}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground"
        >
          <PanelRightClose className="h-[18px] w-[18px]" />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 pb-5 pt-3">
        <Section
          id="calendar"
          sectionRef={(el) => { refs.current.calendar = el; }}
          icon={<CalendarDays className="h-4 w-4" />}
          iconTone="bg-sky-500/10 text-sky-600 dark:text-sky-300"
          title={tx.calendar}
          open={!closed.includes("calendar")}
          onToggle={toggleSection}
        >
          <div className="mb-2.5 flex items-center justify-between gap-2">
            <p className="truncate text-[15px] font-extrabold tracking-tight text-foreground">
              {props.formatMonth(props.month)}
            </p>
            <div className="flex shrink-0 items-center rounded-lg border border-border/80 bg-background p-0.5">
              <button
                type="button"
                aria-label="‹"
                className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground"
                onClick={() => props.onMonthChange(new Date(calYear, calMo - 1, 1))}
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => props.onPickDay(dayStart(new Date()))}
                className="h-6 rounded-md px-1.5 text-[10px] font-bold text-[#0b3a5c] transition hover:bg-muted dark:text-primary"
              >
                {tx.today}
              </button>
              <button
                type="button"
                aria-label="›"
                className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground"
                onClick={() => props.onMonthChange(new Date(calYear, calMo + 1, 1))}
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          <div className="mb-1 grid grid-cols-7 text-center text-[10px] font-bold uppercase tracking-wider text-muted-foreground/80">
            {props.weekDays.map((d, i) => (
              <div key={d} className={cn("py-1", i >= 5 && "text-rose-500/70")}>
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {cells.map((date) => {
              const ts = date.getTime();
              const inMonth = date.getMonth() === calMo;
              const list = tasksByDay.get(ts) ?? [];
              const tone = dayTone(list, now);
              const isToday = ts === todayTs;
              const isSelected = ts === selectedTs;
              const isPast = ts < todayTs;
              const weekend = ((date.getDay() + 6) % 7) >= 5;
              return (
                <button
                  key={ts}
                  type="button"
                  onClick={() => props.onPickDay(date)}
                  title={`${date.getDate()} ${props.formatMonth(date)} — ${tx.dayTasks(list.length)}`}
                  className={cn(
                    "relative flex h-9 items-center justify-center rounded-[10px] text-[12px] tabular-nums transition-all duration-150",
                    isSelected
                      ? "bg-[#0b3a5c] font-bold text-white shadow-lg shadow-[#0b3a5c]/30 dark:bg-primary dark:text-primary-foreground"
                      : cn(
                          "hover:scale-[1.06] hover:shadow-sm",
                          list.length > 0 && inMonth ? TONE_CELL[tone] : "hover:bg-muted",
                          list.length > 0 && inMonth ? "font-semibold" : "font-medium",
                          !inMonth && "text-muted-foreground/35",
                          inMonth && !list.length && isPast && "text-muted-foreground/60",
                          inMonth && !list.length && !isPast && (weekend ? "text-rose-500/80" : "text-foreground"),
                          isToday && "ring-2 ring-[#0b3a5c] ring-offset-1 ring-offset-card dark:ring-primary",
                        ),
                  )}
                >
                  {date.getDate()}
                  {list.length > 0 && inMonth && (
                    <span
                      className={cn(
                        "absolute bottom-[3px] left-1/2 h-[3px] -translate-x-1/2 rounded-full",
                        list.length > 1 ? "w-3" : "w-1.5",
                        isSelected ? "bg-white/80" : TONE_BADGE[tone],
                      )}
                    />
                  )}
                  {list.length > 1 && inMonth && (
                    <span
                      className={cn(
                        "absolute right-[3px] top-[2px] text-[8px] font-extrabold leading-none",
                        isSelected ? "text-white/80" : "opacity-70",
                      )}
                    >
                      {list.length > 9 ? "9+" : list.length}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="mt-3.5 flex items-stretch gap-3 rounded-2xl border border-border/70 bg-gradient-to-br from-muted/60 to-muted/20 p-2.5">
            <div className="flex w-12 shrink-0 flex-col items-center justify-center rounded-xl bg-[#0b3a5c] py-1.5 text-white shadow-md shadow-[#0b3a5c]/25 dark:bg-primary dark:text-primary-foreground">
              <span className="text-[9px] font-bold uppercase tracking-wide text-white/70">
                {props.weekDays[(props.selectedDay.getDay() + 6) % 7]}
              </span>
              <span className="text-lg font-extrabold leading-none">{props.selectedDay.getDate()}</span>
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12px] font-bold text-foreground">
                {tx.weekdayLong[(props.selectedDay.getDay() + 6) % 7]}
                {selectedTs === todayTs && (
                  <span className="ml-1.5 rounded-md bg-[#0b3a5c]/10 px-1.5 py-px text-[9px] font-bold uppercase text-[#0b3a5c] dark:bg-primary/15 dark:text-primary">
                    {tx.today}
                  </span>
                )}
              </p>
              <p className="truncate text-[10.5px] text-muted-foreground">
                {props.formatMonth(props.selectedDay)} · {tx.dayTasks(selectedTasks.length)}
              </p>
              {selectedTasks.length > 0 ? (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {selectedLate > 0 && (
                    <span className="rounded-md bg-rose-500/10 px-1.5 py-0.5 text-[10px] font-bold text-rose-600 dark:text-rose-300">
                      {selectedLate} {tx.chipLate}
                    </span>
                  )}
                  {selectedActive > 0 && (
                    <span className="rounded-md bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-bold text-amber-700 dark:text-amber-300">
                      {selectedActive} {tx.chipActive}
                    </span>
                  )}
                  {selectedDone > 0 && (
                    <span className="rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-300">
                      {selectedDone} {tx.chipDone}
                    </span>
                  )}
                </div>
              ) : (
                <p className="mt-1.5 text-[10px] font-medium text-muted-foreground/80">{tx.freeDay}</p>
              )}
            </div>
          </div>

          <div
            className="mt-2.5 flex flex-wrap items-center justify-between gap-x-2 gap-y-1 px-0.5 text-[10px] text-muted-foreground"
            title={tx.legendTitle}
          >
            {(["red", "amber", "green", "done"] as DayTone[]).map((tone) => (
              <span key={tone} className="flex items-center gap-1">
                <span className={cn("h-2.5 w-2.5 rounded-[4px]", TONE_LEGEND[tone])} />
                {tx.legend[tone]}
              </span>
            ))}
          </div>
        </Section>

        <Section
          id="schedule"
          sectionRef={(el) => { refs.current.schedule = el; }}
          icon={<Clock3 className="h-4 w-4" />}
          iconTone="bg-amber-500/10 text-amber-600 dark:text-amber-300"
          title={tx.schedule}
          open={!closed.includes("schedule")}
          onToggle={toggleSection}
          right={
            props.scheduleTasks.length ? (
              <span className="flex items-center gap-1">
                {overdueToday > 0 && (
                  <span className="rounded-full bg-rose-500/10 px-1.5 py-0.5 text-[10px] font-bold text-rose-600 dark:text-rose-300">
                    {overdueToday}
                  </span>
                )}
                <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-bold text-muted-foreground">
                  {props.scheduleTasks.length}
                </span>
              </span>
            ) : null
          }
        >
          {props.scheduleTasks.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border py-6 text-center">
              <CheckCircle2 className="h-6 w-6 text-emerald-500" />
              <p className="text-xs text-muted-foreground">{tx.scheduleEmpty}</p>
            </div>
          ) : (
            <ol className="relative space-y-1">
              <span className="absolute bottom-4 left-[56.5px] top-4 w-px bg-border" aria-hidden />
              {props.scheduleTasks.map((task) => {
                const late = isTaskOverdue(task, now);
                const time = task.dueAt
                  ? new Date(task.dueAt).toLocaleTimeString("uz-UZ", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })
                  : "—";
                return (
                  <li key={task.id}>
                    <button
                      type="button"
                      onClick={() => props.onOpenTask(task)}
                      className="group relative flex w-full items-start gap-3 rounded-xl px-1.5 py-2 text-left transition hover:bg-muted/60"
                    >
                      <span
                        className={cn(
                          "w-[34px] shrink-0 pt-0.5 text-[11px] font-bold tabular-nums",
                          late ? "text-rose-600 dark:text-rose-400" : "text-muted-foreground",
                        )}
                      >
                        {time}
                      </span>
                      <span
                        className={cn(
                          "relative z-10 mt-1 h-2.5 w-2.5 shrink-0 rounded-full ring-4 ring-card",
                          late ? "bg-rose-500" : props.accentClass(task),
                        )}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="line-clamp-2 text-xs font-semibold leading-snug text-foreground group-hover:text-[#0b3a5c] dark:group-hover:text-primary">
                          {task.title}
                        </span>
                        <span className="mt-0.5 flex items-center gap-1.5">
                          <span className="truncate text-[10px] text-muted-foreground">
                            {task.assigneeName || "—"}
                          </span>
                          {late && (
                            <span className="shrink-0 rounded-md bg-rose-500/10 px-1 py-px text-[9px] font-bold uppercase text-rose-600 dark:text-rose-300">
                              {tx.late}
                            </span>
                          )}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
        </Section>

        <Section
          id="top"
          sectionRef={(el) => { refs.current.top = el; }}
          icon={<Trophy className="h-4 w-4" />}
          iconTone="bg-amber-400/15 text-amber-600 dark:text-amber-300"
          title={tx.top}
          open={!closed.includes("top")}
          onToggle={toggleSection}
          right={<ScoreHelp tx={tx} />}
        >
          <div className="mb-3 grid grid-cols-3 gap-1 rounded-xl bg-muted/60 p-1">
            {(["week", "month", "all"] as StaffPeriod[]).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPeriod(p)}
                className={cn(
                  "rounded-lg py-1 text-[11px] font-semibold transition",
                  period === p
                    ? "bg-card text-[#0b3a5c] shadow-sm dark:text-primary"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {tx.periods[p]}
              </button>
            ))}
          </div>
          {top.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border py-6 text-center">
              <Trophy className="h-6 w-6 text-muted-foreground/50" />
              <p className="px-4 text-xs text-muted-foreground">{tx.topEmpty}</p>
            </div>
          ) : (
            <>
              <ul className="space-y-1">
                {top.map((row, idx) => {
                  const m = medalFor(idx);
                  return (
                    <li key={row.key}>
                      <button
                        type="button"
                        onClick={() => setDetail(idx)}
                        className="group flex w-full items-center gap-2.5 rounded-xl px-1.5 py-2 text-left transition hover:bg-muted/60"
                      >
                        <span className="relative shrink-0">
                          <span
                            className={cn(
                              "flex h-9 w-9 items-center justify-center rounded-full text-[11px] font-bold ring-2 ring-offset-2 ring-offset-card",
                              m.avatar,
                              m.ring,
                            )}
                          >
                            {initials(row.name) || idx + 1}
                          </span>
                          <span
                            className={cn(
                              "absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-extrabold ring-2 ring-card",
                              m.badge,
                            )}
                          >
                            {idx + 1}
                          </span>
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="mb-1 flex items-center justify-between gap-2">
                            <span className="flex min-w-0 items-center gap-1">
                              {idx === 0 && <Crown className="h-3 w-3 shrink-0 text-amber-500" />}
                              <span className="truncate text-xs font-semibold text-foreground">
                                {row.name}
                              </span>
                            </span>
                            <span className="shrink-0 text-[11px] font-extrabold tabular-nums text-foreground">
                              {row.score}
                              <span className="ml-0.5 text-[9px] font-semibold text-muted-foreground">
                                {tx.pts}
                              </span>
                            </span>
                          </span>
                          <span className="block h-1.5 overflow-hidden rounded-full bg-muted">
                            <span
                              className={cn("block h-full rounded-full bg-gradient-to-r transition-all", m.bar)}
                              style={{ width: `${Math.max(6, Math.round((row.score / maxScore) * 100))}%` }}
                            />
                          </span>
                          <span className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground">
                            <span className="flex items-center gap-0.5" title={tx.ruleVerified}>
                              <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                              {row.verified}
                            </span>
                            <span className="flex items-center gap-0.5" title={tx.ruleOnTime}>
                              <Timer className="h-3 w-3 text-sky-500" />
                              {row.onTime}
                            </span>
                            {row.overdue > 0 && (
                              <span className="flex items-center gap-0.5 text-rose-500" title={tx.ruleOverdue}>
                                <AlertTriangle className="h-3 w-3" />
                                {row.overdue}
                              </span>
                            )}
                          </span>
                        </span>
                        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/40 transition group-hover:translate-x-0.5 group-hover:text-muted-foreground" />
                      </button>
                    </li>
                  );
                })}
              </ul>
              <p className="mt-2 text-center text-[10px] text-muted-foreground">{tx.clickHint}</p>
            </>
          )}
        </Section>

        <Section
          id="quick"
          sectionRef={(el) => { refs.current.quick = el; }}
          icon={<Zap className="h-4 w-4" />}
          iconTone="bg-violet-500/10 text-violet-600 dark:text-violet-300"
          title={tx.quick}
          open={!closed.includes("quick")}
          onToggle={toggleSection}
        >
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                {
                  key: "excel",
                  icon: FileSpreadsheet,
                  label: props.quickLabels.excel,
                  tone: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300",
                  hover: "hover:border-emerald-500/40",
                  onClick: props.onExcel,
                },
                {
                  key: "pdf",
                  icon: FileText,
                  label: props.quickLabels.pdf,
                  tone: "bg-rose-500/10 text-rose-600 dark:text-rose-300",
                  hover: "hover:border-rose-500/40",
                  onClick: props.onPdf,
                },
                {
                  key: "tpl",
                  icon: LayoutTemplate,
                  label: props.quickLabels.templates,
                  tone: "bg-sky-500/10 text-sky-600 dark:text-sky-300",
                  hover: "hover:border-sky-500/40",
                  onClick: props.onTemplates,
                },
                {
                  key: "arch",
                  icon: Archive,
                  label: props.quickLabels.archive,
                  tone: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-300",
                  hover: "hover:border-indigo-500/40",
                  onClick: props.onArchive,
                },
              ] as const
            ).map((action) => {
              const Icon = action.icon;
              return (
                <button
                  key={action.key}
                  type="button"
                  onClick={action.onClick}
                  className={cn(
                    "group flex flex-col items-center gap-2 rounded-xl border border-border/70 bg-card px-2 py-3 text-center transition hover:-translate-y-0.5 hover:shadow-md",
                    action.hover,
                  )}
                >
                  <span
                    className={cn(
                      "flex h-9 w-9 items-center justify-center rounded-xl transition group-hover:scale-110",
                      action.tone,
                    )}
                  >
                    <Icon className="h-[18px] w-[18px]" />
                  </span>
                  <span className="text-[11px] font-semibold text-foreground">{action.label}</span>
                </button>
              );
            })}
          </div>
        </Section>
      </div>

      <StaffDetailDialog
        row={detailRow}
        rank={detail ?? 0}
        next={detail != null ? (top[detail + 1] ?? null) : null}
        prev={detail != null && detail > 0 ? top[detail - 1] : null}
        period={period}
        tx={tx}
        onClose={() => setDetail(null)}
        onOpenTask={(task) => {
          setDetail(null);
          props.onOpenTask(task);
        }}
      />
    </aside>
  );
}

function ScoreHelp({ tx }: { tx: Txt }) {
  const rules = [
    { label: tx.ruleVerified, pts: SCORE_RULES.verified, icon: CheckCircle2, tone: "text-emerald-500" },
    { label: tx.ruleOnTime, pts: SCORE_RULES.onTime, icon: Timer, tone: "text-sky-500" },
    { label: tx.ruleReview, pts: SCORE_RULES.review, icon: Hourglass, tone: "text-violet-500" },
    { label: tx.ruleProgress, pts: SCORE_RULES.progress, icon: PlayCircle, tone: "text-amber-500" },
    { label: tx.ruleOverdue, pts: SCORE_RULES.overdue, icon: AlertTriangle, tone: "text-rose-500" },
  ];
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={tx.howTitle}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground"
        >
          <CircleHelp className="h-4 w-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 rounded-2xl p-0">
        <div className="rounded-t-2xl bg-gradient-to-br from-[#0b3a5c] to-[#0f2744] px-4 py-3 text-white">
          <p className="text-sm font-bold">{tx.howTitle}</p>
        </div>
        <ul className="space-y-1.5 px-4 py-3">
          {rules.map((r) => {
            const Icon = r.icon;
            return (
              <li key={r.label} className="flex items-center gap-2 text-xs">
                <Icon className={cn("h-3.5 w-3.5 shrink-0", r.tone)} />
                <span className="flex-1 text-foreground">{r.label}</span>
                <span
                  className={cn(
                    "rounded-md px-1.5 py-0.5 text-[11px] font-bold tabular-nums",
                    r.pts > 0
                      ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                      : "bg-rose-500/10 text-rose-700 dark:text-rose-300",
                  )}
                >
                  {r.pts > 0 ? `+${r.pts}` : r.pts}
                </span>
              </li>
            );
          })}
        </ul>
        <p className="border-t border-border px-4 py-2.5 text-[10px] leading-relaxed text-muted-foreground">
          {tx.howFoot}
        </p>
      </PopoverContent>
    </Popover>
  );
}

function StaffDetailDialog({
  row,
  rank,
  next,
  prev,
  period,
  tx,
  onClose,
  onOpenTask,
}: {
  row: StaffRank | null;
  rank: number;
  next: StaffRank | null;
  prev: StaffRank | null;
  period: StaffPeriod;
  tx: Txt;
  onClose: () => void;
  onOpenTask: (task: Vazifa) => void;
}) {
  const m = medalFor(rank);
  const submitted = row ? row.verified + row.review : 0;
  const onTimePct = row && submitted ? Math.round((row.onTime / submitted) * 100) : 0;

  const reasons: Array<{ text: string; tone: "good" | "bad" | "info" }> = [];
  if (row) {
    if (row.verified) reasons.push({ text: tx.rVerified(row.verified), tone: "good" });
    if (row.onTime) reasons.push({ text: tx.rOnTime(row.onTime), tone: "good" });
    if (row.review) reasons.push({ text: tx.rReview(row.review), tone: "info" });
    if (row.progress) reasons.push({ text: tx.rProgress(row.progress), tone: "info" });
    if (row.overdue) reasons.push({ text: tx.rOverdue(row.overdue), tone: "bad" });
    else reasons.push({ text: tx.rNoOverdue, tone: "good" });
  }

  const lead = row
    ? rank === 0
      ? next
        ? row.score === next.score
          ? tx.leadTie
          : tx.leadAhead(row.score - next.score)
        : null
      : prev
        ? tx.leadBehind(rank, prev.score - row.score)
        : null
    : null;

  const parts = row
    ? [
        { label: tx.ruleVerified, n: row.verified, pts: SCORE_RULES.verified, icon: CheckCircle2, tone: "text-emerald-500" },
        { label: tx.ruleOnTime, n: row.onTime, pts: SCORE_RULES.onTime, icon: Timer, tone: "text-sky-500" },
        { label: tx.ruleReview, n: row.review, pts: SCORE_RULES.review, icon: Hourglass, tone: "text-violet-500" },
        { label: tx.ruleProgress, n: row.progress, pts: SCORE_RULES.progress, icon: PlayCircle, tone: "text-amber-500" },
        { label: tx.ruleOverdue, n: row.overdue, pts: SCORE_RULES.overdue, icon: AlertTriangle, tone: "text-rose-500" },
      ]
    : [];
  const rawTotal = parts.reduce((s, p) => s + p.n * p.pts, 0);

  const statusOf = (task: Vazifa) => {
    if (task.status !== "verified" && task.status !== "done" && isTaskOverdue(task))
      return { label: tx.status.overdue, cls: "bg-rose-500/10 text-rose-700 dark:text-rose-300" };
    const map: Record<Vazifa["status"], string> = {
      todo: "bg-slate-500/10 text-slate-700 dark:text-slate-300",
      in_progress: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
      done: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
      verified: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
      cancelled: "bg-muted text-muted-foreground",
    };
    return { label: tx.status[task.status], cls: map[task.status] };
  };

  return (
    <Dialog open={!!row} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        hideClose
        className="max-h-[90vh] gap-0 overflow-hidden rounded-3xl border-0 p-0 sm:max-w-[440px]"
      >
        {row && (
          <div className="flex max-h-[90vh] flex-col">
            <div className="relative overflow-hidden bg-gradient-to-br from-[#0b3a5c] via-[#0f2744] to-[#0b1f36] px-6 pb-6 pt-7 text-white">
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white/80 transition hover:bg-white/20 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
              <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/5" />
              <div className="pointer-events-none absolute -bottom-16 right-16 h-32 w-32 rounded-full bg-amber-400/10" />
              <div className="relative flex items-center gap-4">
                <span className="relative shrink-0">
                  <span
                    className={cn(
                      "flex h-16 w-16 items-center justify-center rounded-2xl text-lg font-extrabold shadow-lg",
                      rank < 3 ? m.avatar : "bg-white/15 text-white",
                    )}
                  >
                    {initials(row.name)}
                  </span>
                  {rank === 0 && (
                    <Crown className="absolute -right-2 -top-3 h-6 w-6 rotate-12 text-amber-300 drop-shadow" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <span className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide">
                    <Trophy className="h-3 w-3" />
                    {tx.rank(rank + 1)} · {tx.periodLong[period]}
                  </span>
                  <DialogTitle className="mt-1.5 truncate text-lg font-bold leading-tight text-white">
                    {row.name}
                  </DialogTitle>
                  <p className="text-[11px] text-white/70">{tx.tasksCount(row.total)}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-3xl font-extrabold leading-none tabular-nums">{row.score}</p>
                  <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-white/70">
                    {tx.pts}
                  </p>
                </div>
              </div>
              {lead && (
                <p className="relative mt-4 flex items-center gap-1.5 rounded-xl bg-white/10 px-3 py-2 text-[11px] font-medium text-white/90">
                  <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-amber-300" />
                  {lead}
                </p>
              )}
            </div>

            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
              <section>
                <h4 className="mb-2.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                  {tx.whyTitle}
                </h4>
                <ul className="space-y-2">
                  {reasons.map((r) => (
                    <li key={r.text} className="flex items-start gap-2.5 text-[13px] text-foreground">
                      <span
                        className={cn(
                          "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full",
                          r.tone === "good" && "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300",
                          r.tone === "info" && "bg-sky-500/15 text-sky-600 dark:text-sky-300",
                          r.tone === "bad" && "bg-rose-500/15 text-rose-600 dark:text-rose-300",
                        )}
                      >
                        {r.tone === "bad" ? (
                          <AlertTriangle className="h-3 w-3" />
                        ) : (
                          <CheckCircle2 className="h-3 w-3" />
                        )}
                      </span>
                      <span className="leading-snug">{r.text}</span>
                    </li>
                  ))}
                </ul>
              </section>

              <section>
                <h4 className="mb-2.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                  {tx.breakdown}
                </h4>
                <div className="overflow-hidden rounded-2xl border border-border">
                  {parts.map((p) => {
                    const Icon = p.icon;
                    const sub = p.n * p.pts;
                    return (
                      <div
                        key={p.label}
                        className={cn(
                          "flex items-center gap-2.5 border-b border-border/70 px-3.5 py-2.5 text-xs last:border-b-0",
                          p.n === 0 && "opacity-45",
                        )}
                      >
                        <Icon className={cn("h-4 w-4 shrink-0", p.tone)} />
                        <span className="flex-1 text-foreground">{p.label}</span>
                        <span className="tabular-nums text-muted-foreground">
                          {p.n} × {p.pts > 0 ? `+${p.pts}` : p.pts}
                        </span>
                        <span
                          className={cn(
                            "w-10 text-right font-bold tabular-nums",
                            sub > 0 && "text-emerald-600 dark:text-emerald-400",
                            sub < 0 && "text-rose-600 dark:text-rose-400",
                            sub === 0 && "text-muted-foreground",
                          )}
                        >
                          {sub > 0 ? `+${sub}` : sub}
                        </span>
                      </div>
                    );
                  })}
                  <div className="flex items-center justify-between bg-muted/60 px-3.5 py-2.5 text-xs font-bold">
                    <span className="text-foreground">{tx.total}</span>
                    <span className="tabular-nums text-foreground">
                      {rawTotal < 0 ? `${rawTotal} → 0` : row.score} {tx.pts}
                    </span>
                  </div>
                </div>
              </section>

              <section>
                <div className="mb-2 flex items-center justify-between">
                  <h4 className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                    {tx.discipline}
                  </h4>
                  <span
                    className={cn(
                      "text-sm font-extrabold tabular-nums",
                      onTimePct >= 80
                        ? "text-emerald-600 dark:text-emerald-400"
                        : onTimePct >= 50
                          ? "text-amber-600 dark:text-amber-400"
                          : "text-rose-600 dark:text-rose-400",
                    )}
                  >
                    {submitted ? `${onTimePct}%` : "—"}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn(
                      "h-full rounded-full transition-all",
                      onTimePct >= 80 ? "bg-emerald-500" : onTimePct >= 50 ? "bg-amber-500" : "bg-rose-500",
                    )}
                    style={{ width: `${submitted ? Math.max(4, onTimePct) : 0}%` }}
                  />
                </div>
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  {submitted ? tx.disciplineHint(row.onTime, submitted) : tx.noSubmitted}
                </p>
              </section>

              <section>
                <h4 className="mb-2.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                  {tx.recent}
                </h4>
                <ul className="space-y-1.5">
                  {row.tasks.slice(0, 6).map((task) => {
                    const st = statusOf(task);
                    return (
                      <li key={task.id}>
                        <button
                          type="button"
                          onClick={() => onOpenTask(task)}
                          className="group flex w-full items-center gap-2.5 rounded-xl border border-border/70 px-3 py-2 text-left transition hover:border-[#0b3a5c]/30 hover:bg-muted/50"
                        >
                          <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
                            {task.title}
                          </span>
                          <span className={cn("shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-bold", st.cls)}>
                            {st.label}
                          </span>
                          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50 transition group-hover:translate-x-0.5" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
