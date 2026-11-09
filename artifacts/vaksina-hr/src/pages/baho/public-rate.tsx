import { useEffect, useMemo, useState } from "react";
import { useRoute } from "wouter";
import { Check, Languages, Loader2, Star, Store, Users } from "lucide-react";
import { cn } from "@/lib/utils";

type Staff = {
  employeeId: number;
  fullName: string;
  position: string;
  shiftKey: string;
  workDate: string;
};

type Session = {
  token: string;
  branchId: number;
  branchLabel: string;
  staff: Staff[];
  emptyReason?: string | null;
  error?: string;
  code?: string;
};

type Lang = "uz" | "ru";
type RateType = "staff" | "pharmacy";
type Step = "choose" | "staff" | "form" | "done";

const T: Record<Lang, Record<string, string>> = {
  uz: {
    title: "Xizmatni baholang",
    thanks: "Dorixonamizga tashrifingiz uchun rahmat!",
    chooseTitle: "Nimani baholaysiz?",
    chooseSub: "Bitta yo‘nalishni tanlang",
    chooseStaff: "Xodimlarni baholash",
    chooseStaffSub: "Smenadagi xodim(lar)ni tanlang",
    choosePharmacy: "Dorixonani baholash",
    choosePharmacySub: "Filial, tozalik va mahsulotlar",
    pickStaff: "Kimni baholaysiz?",
    allShift: "Shu smenadagi barchasi",
    next: "Davom etish",
    back: "Orqaga",
    q1Staff: "1. Umumiy xizmat sifati",
    q2Staff: "2. Xodim sizga qanchalik tushunarli maslahat berdi?",
    q3Staff: "3. Xodimning muomalasi qanday bo‘ldi?",
    q1Pharmacy: "1. Dorixonani umumiy baholang",
    q2Pharmacy: "2. Tozalik va qulaylik qanday?",
    q3Pharmacy: "3. Dori va mahsulotlar tanlovi qanday?",
    comment: "Izoh (ixtiyoriy)",
    commentPh: "Fikringiz yoki taklifingiz...",
    yourName: "Ismingiz",
    yourPhone: "Telefon raqamingiz",
    namePh: "Ism Familiya",
    phonePh: "+998 __ ___ __ __",
    submit: "Bahoni yuborish",
    done: "Rahmat!",
    doneSub: "Fikringiz qabul qilindi. Yaxshi kun tilaymiz!",
    emptyStaff: "Hozir bu filialda faol smena xodimi yo‘q. Dorixonani baholashingiz mumkin.",
    blocked: "Bu QR vaqtincha o‘chirilgan.",
    notFound: "QR topilmadi yoki eskirgan.",
    loading: "Yuklanmoqda…",
    selectOne: "Kamida bitta xodimni tanlang",
    sendError: "Yuborilmadi",
    alo: "A'lo",
    yaxshi: "Yaxshi",
    qoniqarli: "Qoniqarli",
    yomon: "Yomon",
    juda_yomon: "Juda yomon",
    xushmuomala: "Xushmuomala",
    oddiy: "Oddiy",
    qopol: "Qo‘pol",
    juda_qopol: "Juda qo‘pol",
  },
  ru: {
    title: "Оцените сервис",
    thanks: "Спасибо за визит в нашу аптеку!",
    chooseTitle: "Что оцениваете?",
    chooseSub: "Выберите один вариант",
    chooseStaff: "Оценить сотрудников",
    chooseStaffSub: "Выберите сотрудника(ов) на смене",
    choosePharmacy: "Оценить аптеку",
    choosePharmacySub: "Филиал, чистота и ассортимент",
    pickStaff: "Кого оцениваете?",
    allShift: "Вся смена",
    next: "Далее",
    back: "Назад",
    q1Staff: "1. Общее качество сервиса",
    q2Staff: "2. Насколько понятно сотрудник дал консультацию?",
    q3Staff: "3. Как было общение сотрудника?",
    q1Pharmacy: "1. Общая оценка аптеки",
    q2Pharmacy: "2. Как чистота и удобство?",
    q3Pharmacy: "3. Как ассортимент лекарств и товаров?",
    comment: "Комментарий (необязательно)",
    commentPh: "Ваше мнение или предложение...",
    yourName: "Ваше имя",
    yourPhone: "Номер телефона",
    namePh: "Имя Фамилия",
    phonePh: "+998 __ ___ __ __",
    submit: "Отправить оценку",
    done: "Спасибо!",
    doneSub: "Ваш отзыв принят. Хорошего дня!",
    emptyStaff: "Сейчас на смене нет сотрудников. Можно оценить аптеку.",
    blocked: "Этот QR временно отключён.",
    notFound: "QR не найден или устарел.",
    loading: "Загрузка…",
    selectOne: "Выберите хотя бы одного сотрудника",
    sendError: "Не удалось отправить",
    alo: "Отлично",
    yaxshi: "Хорошо",
    qoniqarli: "Удовл.",
    yomon: "Плохо",
    juda_yomon: "Очень плохо",
    xushmuomala: "Вежливый",
    oddiy: "Обычный",
    qopol: "Грубый",
    juda_qopol: "Очень грубый",
  },
};

const QUALITY = ["alo", "yaxshi", "qoniqarli", "yomon", "juda_yomon"] as const;
const DEMEANOR = ["xushmuomala", "yaxshi", "oddiy", "qopol", "juda_qopol"] as const;

function fp() {
  try {
    const k = "vhr_baho_fp";
    let v = localStorage.getItem(k);
    if (!v) {
      v = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem(k, v);
    }
    return v;
  } catch {
    return "";
  }
}

function loadLang(): Lang {
  try {
    const v = localStorage.getItem("vhr_baho_lang");
    return v === "ru" ? "ru" : "uz";
  } catch {
    return "uz";
  }
}

export default function PublicCustomerRatePage() {
  const [, params] = useRoute("/baho/:token");
  const token = params?.token || "";
  const [lang, setLang] = useState<Lang>(loadLang);
  const t = (k: string) => T[lang][k] || k;

  const [session, setSession] = useState<Session | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState<Step>("choose");
  const [rateType, setRateType] = useState<RateType | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [allShift, setAllShift] = useState(false);
  const [stars, setStars] = useState(0);
  const [quality, setQuality] = useState<(typeof QUALITY)[number] | "">("");
  const [demeanor, setDemeanor] = useState<string>("");
  const [comment, setComment] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem("vhr_baho_lang", lang);
    } catch {
      /* ignore */
    }
  }, [lang]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadErr(null);
      try {
        const res = await fetch(`/api/public/customer-ratings/${encodeURIComponent(token)}`);
        const data = (await res.json()) as Session;
        if (cancelled) return;
        if (!res.ok) {
          setLoadErr(data.code === "blocked" ? t("blocked") : data.error || t("notFound"));
          setSession(null);
        } else {
          setSession(data);
          setStep("choose");
        }
      } catch {
        if (!cancelled) setLoadErr(t("notFound"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const staff = session?.staff || [];
  const hasStaff = staff.length > 0;

  const resetForm = () => {
    setStars(0);
    setQuality("");
    setDemeanor("");
    setComment("");
    setErr(null);
  };

  const openStaff = () => {
    if (!hasStaff) {
      setErr(t("emptyStaff"));
      return;
    }
    setRateType("staff");
    setSelected([]);
    setAllShift(false);
    resetForm();
    setStep("staff");
  };

  const openPharmacy = () => {
    setRateType("pharmacy");
    setSelected([]);
    setAllShift(false);
    resetForm();
    setStep("form");
  };

  const toggle = (id: number) => {
    setAllShift(false);
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const pickAll = () => {
    setAllShift(true);
    setSelected(staff.map((s) => s.employeeId));
  };

  const canForm = allShift || selected.length > 0;

  const selectedNames = useMemo(() => {
    const ids = new Set(selected);
    return staff.filter((s) => ids.has(s.employeeId)).map((s) => s.fullName);
  }, [selected, staff]);

  const submit = async () => {
    setErr(null);
    if (!rateType) return;
    if (!stars || !quality || !demeanor) {
      setErr(lang === "ru" ? "Заполните все оценки" : "Barcha baholarni to‘ldiring");
      return;
    }
    if (name.trim().length < 2) {
      setErr(lang === "ru" ? "Укажите имя" : "Ismingizni yozing");
      return;
    }
    if (phone.replace(/\D/g, "").length < 9) {
      setErr(lang === "ru" ? "Укажите телефон" : "Telefon raqamini kiriting");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/public/customer-ratings/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rateType,
          employeeIds: rateType === "staff" ? selected : [],
          allShift: rateType === "staff" ? allShift : false,
          stars,
          serviceQuality: quality,
          demeanor,
          comment,
          customerName: name,
          customerPhone: phone,
          fingerprint: fp(),
          lang,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || t("sendError"));
      setStep("done");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const formBack = () => {
    setErr(null);
    if (rateType === "staff") setStep("staff");
    else {
      setRateType(null);
      setStep("choose");
    }
  };

  return (
    <div className="min-h-[100dvh] bg-black text-white">
      <div className="mx-auto flex min-h-[100dvh] w-full max-w-lg flex-col px-4 pb-8 pt-5 sm:max-w-xl sm:px-6 lg:max-w-2xl">
        <div className="mb-5 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-400/90">
              Vaksina · {session?.branchLabel || "…"}
            </p>
            <h1 className="mt-1 text-2xl font-extrabold tracking-tight sm:text-3xl">{t("title")}</h1>
            <p className="mt-1 text-sm text-white/60">{t("thanks")}</p>
          </div>
          <button
            type="button"
            onClick={() => setLang((l) => (l === "uz" ? "ru" : "uz"))}
            className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-3 text-xs font-bold text-white/90"
          >
            <Languages className="h-3.5 w-3.5" />
            {lang === "uz" ? "RU" : "UZ"}
          </button>
        </div>

        {loading ? (
          <div className="flex flex-1 items-center justify-center gap-2 text-sm text-white/50">
            <Loader2 className="h-5 w-5 animate-spin" /> {t("loading")}
          </div>
        ) : loadErr && !session ? (
          <div className="mt-10 rounded-2xl border border-white/10 bg-white/5 px-4 py-6 text-center text-sm text-white/70">
            {loadErr}
          </div>
        ) : step === "done" ? (
          <div className="flex flex-1 flex-col items-center justify-center text-center">
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500 text-white shadow-lg shadow-emerald-500/30">
              <Check className="h-8 w-8" strokeWidth={3} />
            </span>
            <h2 className="mt-5 text-2xl font-extrabold">{t("done")}</h2>
            <p className="mt-2 max-w-xs text-sm text-white/60">{t("doneSub")}</p>
          </div>
        ) : step === "choose" ? (
          <div className="flex flex-1 flex-col">
            <h2 className="text-base font-bold sm:text-lg">{t("chooseTitle")}</h2>
            <p className="mt-1 text-sm text-white/50">{t("chooseSub")}</p>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={openStaff}
                disabled={!hasStaff}
                className={cn(
                  "flex flex-col items-start gap-3 rounded-3xl border px-4 py-5 text-left transition",
                  hasStaff
                    ? "border-white/15 bg-white/5 hover:border-amber-400/60 hover:bg-amber-400/10"
                    : "cursor-not-allowed border-white/5 bg-white/[0.03] opacity-45",
                )}
              >
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-400/15 text-amber-300">
                  <Users className="h-6 w-6" />
                </span>
                <span>
                  <span className="block text-base font-extrabold">{t("chooseStaff")}</span>
                  <span className="mt-1 block text-xs text-white/50">
                    {hasStaff ? t("chooseStaffSub") : t("emptyStaff")}
                  </span>
                </span>
              </button>

              <button
                type="button"
                onClick={openPharmacy}
                className="flex flex-col items-start gap-3 rounded-3xl border border-white/15 bg-white/5 px-4 py-5 text-left transition hover:border-amber-400/60 hover:bg-amber-400/10"
              >
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-sky-400/15 text-sky-300">
                  <Store className="h-6 w-6" />
                </span>
                <span>
                  <span className="block text-base font-extrabold">{t("choosePharmacy")}</span>
                  <span className="mt-1 block text-xs text-white/50">{t("choosePharmacySub")}</span>
                </span>
              </button>
            </div>
            {err ? <p className="mt-4 text-center text-xs text-rose-300">{err}</p> : null}
          </div>
        ) : step === "staff" ? (
          <div className="flex flex-1 flex-col">
            <button
              type="button"
              onClick={() => {
                setStep("choose");
                setRateType(null);
                setErr(null);
              }}
              className="mb-3 self-start text-xs font-semibold text-white/50"
            >
              ← {t("back")}
            </button>
            <h2 className="text-base font-bold">{t("pickStaff")}</h2>
            <button
              type="button"
              onClick={pickAll}
              className={cn(
                "mt-3 flex items-center gap-3 rounded-2xl border px-4 py-3.5 text-left transition",
                allShift ? "border-amber-400 bg-amber-400/15" : "border-white/10 bg-white/5 hover:border-white/25",
              )}
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10">
                <Users className="h-5 w-5 text-amber-300" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold">{t("allShift")}</span>
                <span className="text-xs text-white/50">{staff.length} ta</span>
              </span>
              {allShift ? <Check className="h-5 w-5 text-amber-300" /> : null}
            </button>

            <ul className="mt-3 space-y-2">
              {staff.map((s) => {
                const on = selected.includes(s.employeeId);
                return (
                  <li key={s.employeeId}>
                    <button
                      type="button"
                      onClick={() => toggle(s.employeeId)}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-2xl border px-4 py-3.5 text-left transition",
                        on ? "border-amber-400 bg-amber-400/15" : "border-white/10 bg-white/5 hover:border-white/25",
                      )}
                    >
                      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-amber-300 to-amber-600 text-sm font-extrabold text-black">
                        {s.fullName
                          .split(/\s+/)
                          .slice(0, 2)
                          .map((p) => p[0])
                          .join("")
                          .toUpperCase()}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-bold">{s.fullName}</span>
                        <span className="text-xs text-white/50">{s.position}</span>
                      </span>
                      <span
                        className={cn(
                          "flex h-6 w-6 items-center justify-center rounded-full border",
                          on ? "border-amber-400 bg-amber-400 text-black" : "border-white/30",
                        )}
                      >
                        {on ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>

            <div className="mt-auto pt-6">
              <button
                type="button"
                disabled={!canForm}
                onClick={() => {
                  if (!canForm) {
                    setErr(t("selectOne"));
                    return;
                  }
                  setErr(null);
                  resetForm();
                  setStep("form");
                }}
                className="flex h-12 w-full items-center justify-center rounded-2xl bg-white text-sm font-extrabold text-black disabled:opacity-40"
              >
                {t("next")}
              </button>
              {err ? <p className="mt-2 text-center text-xs text-rose-300">{err}</p> : null}
            </div>
          </div>
        ) : (
          <div className="flex flex-1 flex-col space-y-5">
            <button type="button" onClick={formBack} className="self-start text-xs font-semibold text-white/50">
              ← {t("back")}
              {rateType === "staff" && selectedNames.length
                ? ` · ${selectedNames.slice(0, 2).join(", ")}${selectedNames.length > 2 ? "…" : ""}`
                : rateType === "pharmacy"
                  ? ` · ${session?.branchLabel || ""}`
                  : ""}
            </button>

            <section>
              <h3 className="text-sm font-bold">{rateType === "pharmacy" ? t("q1Pharmacy") : t("q1Staff")}</h3>
              <div className="mt-3 flex justify-between gap-1">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button key={n} type="button" onClick={() => setStars(n)} className="flex flex-1 flex-col items-center gap-1">
                    <Star
                      className={cn("h-9 w-9 sm:h-10 sm:w-10", stars >= n ? "fill-amber-400 text-amber-400" : "text-amber-400/35")}
                      strokeWidth={1.5}
                    />
                    <span className="text-[11px] text-white/45">{n}</span>
                  </button>
                ))}
              </div>
            </section>

            <RadioBlock
              title={rateType === "pharmacy" ? t("q2Pharmacy") : t("q2Staff")}
              value={quality}
              onChange={(v) => setQuality(v as typeof quality)}
              options={QUALITY.map((k) => ({ k, label: t(k) }))}
            />
            <RadioBlock
              title={rateType === "pharmacy" ? t("q3Pharmacy") : t("q3Staff")}
              value={demeanor}
              onChange={setDemeanor}
              options={
                rateType === "pharmacy"
                  ? QUALITY.map((k) => ({ k, label: t(k) }))
                  : DEMEANOR.map((k) => ({ k, label: t(k) }))
              }
            />

            <label className="block">
              <span className="text-sm font-bold">{t("comment")}</span>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={3}
                placeholder={t("commentPh")}
                className="mt-2 w-full resize-none rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder:text-white/30 outline-none focus:border-amber-400/50"
              />
            </label>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="text-sm font-bold">{t("yourName")}</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t("namePh")}
                  className="mt-2 h-12 w-full rounded-2xl border border-white/10 bg-white/5 px-4 text-sm outline-none focus:border-amber-400/50"
                />
              </label>
              <label className="block">
                <span className="text-sm font-bold">{t("yourPhone")}</span>
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder={t("phonePh")}
                  inputMode="tel"
                  className="mt-2 h-12 w-full rounded-2xl border border-white/10 bg-white/5 px-4 text-sm outline-none focus:border-amber-400/50"
                />
              </label>
            </div>

            <div className="pt-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => void submit()}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-white text-sm font-extrabold text-black disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {t("submit")}
              </button>
              {err ? <p className="mt-2 text-center text-xs text-rose-300">{err}</p> : null}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function RadioBlock({
  title,
  value,
  onChange,
  options,
}: {
  title: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ k: string; label: string }>;
}) {
  return (
    <section>
      <h3 className="text-sm font-bold">{title}</h3>
      <ul className="mt-2 space-y-1.5">
        {options.map((o) => {
          const on = value === o.k;
          return (
            <li key={o.k}>
              <button type="button" onClick={() => onChange(o.k)} className="flex w-full items-center gap-3 rounded-xl px-1 py-2.5 text-left">
                <span
                  className={cn(
                    "flex h-5 w-5 items-center justify-center rounded-full border-2",
                    on ? "border-amber-400" : "border-white/35",
                  )}
                >
                  {on ? <span className="h-2.5 w-2.5 rounded-full bg-amber-400" /> : null}
                </span>
                <span className="text-sm font-medium text-white/90">{o.label}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
