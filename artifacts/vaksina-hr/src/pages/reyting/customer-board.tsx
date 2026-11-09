import { useQuery } from "@tanstack/react-query";
import { Crown, Loader2, Medal, Star, Trophy, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n/I18nProvider";

type BoardItem = {
  rank: number;
  employeeId: number;
  displayName: string;
  votes: number;
  avgStars: number;
  fiveStar: number;
  titleKey: "best" | "responsible" | "trusted" | null;
  titleUz: string | null;
  titleRu: string | null;
  tier: "top3" | "top10" | "rest";
};

type BoardResponse = {
  items: BoardItem[];
  me: {
    employeeId: number;
    rank: number | null;
    avgStars: number | null;
    votes: number | null;
    titleUz: string | null;
    titleRu: string | null;
    inBoard: boolean;
  } | null;
  totalRated: number;
};

function titleOf(it: BoardItem, lang: string) {
  if (lang === "ru") return it.titleRu;
  return it.titleUz;
}

function StarsInline({ n }: { n: number }) {
  const full = Math.round(n);
  return (
    <span className="inline-flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          className={cn("h-3 w-3", i <= full ? "fill-amber-400 text-amber-400" : "text-slate-300 dark:text-white/20")}
        />
      ))}
      <span className="ml-1 text-xs font-extrabold tabular-nums text-slate-700 dark:text-slate-200">{n.toFixed(2)}</span>
    </span>
  );
}

export function CustomerRatingBoard({ enabled }: { enabled: boolean }) {
  const { locale, t } = useI18n();
  const lang = locale;
  const q = useQuery({
    queryKey: ["customer-ratings-leaderboard"],
    enabled,
    queryFn: async () => {
      const res = await fetch("/api/customer-ratings/leaderboard", { credentials: "include" });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error || "Reyting yuklanmadi");
      }
      return res.json() as Promise<BoardResponse>;
    },
  });

  if (!enabled) return null;

  if (q.isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-2xl border border-dashed py-16 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> {t("ui.loading", "Yuklanmoqda…")}
      </div>
    );
  }

  if (q.isError) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-6 text-center text-sm text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-100">
        {(q.error as Error).message}
      </div>
    );
  }

  const items = q.data?.items || [];
  const me = q.data?.me;
  const top3 = items.filter((i) => i.tier === "top3");
  const top10 = items.filter((i) => i.tier === "top10");
  const rest = items.filter((i) => i.tier === "rest");
  const podium = [top3[1], top3[0], top3[2]].filter(Boolean) as BoardItem[];

  return (
    <div className="space-y-4">
      {/* Mening o‘rnim */}
      <div className="overflow-hidden rounded-2xl border border-[#0b3a5c]/15 bg-gradient-to-br from-[#0b1a2e] to-[#0b3a5c] p-4 text-white shadow-lg">
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white/10">
            <UserRound className="h-5 w-5 text-cyan-200" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-cyan-100/80">
              {lang === "ru" ? "Ваше место" : "Sizning o‘rningiz"}
            </p>
            {me?.inBoard && me.rank ? (
              <>
                <p className="mt-0.5 text-2xl font-black tabular-nums">
                  #{me.rank}
                  <span className="ml-2 text-sm font-semibold text-white/70">
                    / {q.data?.totalRated || 0}
                  </span>
                </p>
                <p className="mt-1 text-xs text-white/70">
                  {me.avgStars?.toFixed(2)} ★ · {me.votes}{" "}
                  {lang === "ru" ? "голосов" : "ovoz"}
                  {me.titleUz || me.titleRu ? (
                    <span className="ml-2 rounded-full bg-amber-400/20 px-2 py-0.5 text-[10px] font-bold text-amber-200">
                      {lang === "ru" ? me.titleRu : me.titleUz}
                    </span>
                  ) : null}
                </p>
              </>
            ) : (
              <p className="mt-1 text-sm text-white/75">
                {lang === "ru"
                  ? "Пока нет оценок клиентов — вас ещё нет в рейтинге."
                  : "Hali mijoz bahosi yo‘q — reytingda ko‘rinmaysiz."}
              </p>
            )}
          </div>
        </div>
        <p className="mt-3 text-[10px] text-white/45">
          {lang === "ru"
            ? "Рейтинг по оценкам клиентов. Данные клиентов скрыты (анонимно)."
            : "Reyting mijoz baholari asosida. Mijoz ma’lumotlari yashirin (anonim)."}
        </p>
      </div>

      {!items.length ? (
        <div className="rounded-2xl border border-dashed bg-muted/40 px-4 py-10 text-center">
          <Trophy className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-2 text-sm font-semibold">
            {lang === "ru" ? "Пока нет оценённых сотрудников" : "Hali baholangan xodimlar yo‘q"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {lang === "ru"
              ? "Как только клиенты оставят оценки — рейтинг появится здесь."
              : "Mijozlar baho qoldirgach, reyting shu yerda chiqadi."}
          </p>
        </div>
      ) : (
        <>
          {/* Top-3 podium */}
          {top3.length ? (
            <section>
              <h3 className="mb-3 flex items-center gap-2 text-xs font-extrabold uppercase tracking-wide text-slate-500">
                <Crown className="h-3.5 w-3.5 text-amber-500" />
                {lang === "ru" ? "Сильная тройка" : "Kuchli 3 talik"}
              </h3>
              <div className="grid grid-cols-3 items-end gap-2 sm:gap-3">
                {podium.map((it) => {
                  const isFirst = it.rank === 1;
                  const isMe = me?.employeeId === it.employeeId;
                  return (
                    <div
                      key={it.employeeId}
                      className={cn(
                        "relative flex flex-col items-center rounded-2xl border px-2 pb-3 pt-4 text-center shadow-sm",
                        isFirst
                          ? "order-2 border-amber-300 bg-gradient-to-b from-amber-50 to-white dark:from-amber-500/20 dark:to-slate-900 sm:min-h-[168px]"
                          : it.rank === 2
                            ? "order-1 border-slate-200 bg-white dark:border-white/10 dark:bg-slate-900 sm:min-h-[148px]"
                            : "order-3 border-slate-200 bg-white dark:border-white/10 dark:bg-slate-900 sm:min-h-[136px]",
                        isMe && "ring-2 ring-[#0b3a5c]/40",
                      )}
                    >
                      <span
                        className={cn(
                          "mb-2 flex h-9 w-9 items-center justify-center rounded-full text-sm font-black",
                          isFirst
                            ? "bg-amber-400 text-black"
                            : it.rank === 2
                              ? "bg-slate-300 text-slate-800"
                              : "bg-orange-300 text-orange-950",
                        )}
                      >
                        {it.rank}
                      </span>
                      <p className="line-clamp-2 text-[11px] font-bold leading-tight text-slate-900 dark:text-white sm:text-xs">
                        {it.displayName}
                      </p>
                      {titleOf(it, lang) ? (
                        <p className="mt-1 line-clamp-2 text-[9px] font-semibold text-amber-700 dark:text-amber-300 sm:text-[10px]">
                          {titleOf(it, lang)}
                        </p>
                      ) : null}
                      <p className="mt-2 text-sm font-black tabular-nums text-slate-800 dark:text-slate-100">
                        {it.avgStars.toFixed(2)}
                      </p>
                      <p className="text-[10px] text-slate-500">{it.votes} ovoz</p>
                      {isMe ? (
                        <span className="mt-1 rounded-full bg-[#0b3a5c] px-2 py-0.5 text-[9px] font-bold text-white">
                          {lang === "ru" ? "Вы" : "Siz"}
                        </span>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </section>
          ) : null}

          {/* 4–10 */}
          {top10.length ? (
            <section>
              <h3 className="mb-2 flex items-center gap-2 text-xs font-extrabold uppercase tracking-wide text-slate-500">
                <Medal className="h-3.5 w-3.5 text-sky-500" />
                {lang === "ru" ? "Топ-10" : "10 talik"}
              </h3>
              <ul className="space-y-1.5">
                {top10.map((it) => (
                  <BoardRow key={it.employeeId} it={it} meId={me?.employeeId} lang={lang} />
                ))}
              </ul>
            </section>
          ) : null}

          {/* Qolganlar */}
          {rest.length ? (
            <section>
              <h3 className="mb-2 text-xs font-extrabold uppercase tracking-wide text-slate-500">
                {lang === "ru" ? "Остальные" : "Qolganlari"}
              </h3>
              <ul className="space-y-1.5">
                {rest.map((it) => (
                  <BoardRow key={it.employeeId} it={it} meId={me?.employeeId} lang={lang} />
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}

function BoardRow({ it, meId, lang }: { it: BoardItem; meId?: number; lang: string }) {
  const isMe = meId === it.employeeId;
  return (
    <li
      className={cn(
        "flex items-center gap-3 rounded-xl border bg-white px-3 py-2.5 dark:border-white/10 dark:bg-slate-900",
        isMe && "border-[#0b3a5c]/40 bg-[#0b3a5c]/5 ring-1 ring-[#0b3a5c]/20",
      )}
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-xs font-black tabular-nums text-slate-700 dark:bg-white/10 dark:text-slate-100">
        {it.rank}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold text-slate-900 dark:text-white">
          {it.displayName}
          {isMe ? (
            <span className="ml-1.5 rounded-md bg-[#0b3a5c] px-1.5 py-0.5 text-[9px] font-bold text-white">
              {lang === "ru" ? "Вы" : "Siz"}
            </span>
          ) : null}
        </p>
        <StarsInline n={it.avgStars} />
      </div>
      <div className="shrink-0 text-right">
        <p className="text-xs font-bold tabular-nums text-slate-700 dark:text-slate-200">{it.votes}</p>
        <p className="text-[10px] text-slate-400">{lang === "ru" ? "голосов" : "ovoz"}</p>
      </div>
    </li>
  );
}
