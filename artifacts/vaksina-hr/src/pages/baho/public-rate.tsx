import { useEffect, useMemo, useState } from "react";
import { useRoute } from "wouter";
import { Check, Languages, Loader2, Star, Store, Users, AlertCircle, ChevronLeft } from "lucide-react";
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

const LOGO = "/logo_vaksina.png";
const PURPLE = "#5c2d91";
const YELLOW = "#f5c518";

const T: Record<Lang, Record<string, string>> = {
  uz: {
    title: "XIZMATNI BAHOLANG",
    thanks: "Dorixonamizga tashrifingiz uchun rahmat!",
    chooseTitle: "Nimani baholaysiz?",
    chooseSub: "Bitta yo‘nalishni tanlang",
    chooseStaff: "Xodimlarni baholash",
    chooseStaffSub: "Smenadagi xodim(lar)ni tanlang",
    choosePharmacy: "Dorixonani baholash",
    choosePharmacySub: "Filial, tozalik va mahsulotlar",
    pickStaff: "Kimni baholaysiz?",
    allShift: "Shu smenadagi barchasi",
    next: "DAVOM ETISH",
    back: "Orqaga",
    q1Staff: "1. Umumiy xizmat sifati",
    q2Staff: "2. Xodim sizga qanchalik tushunarli maslahat berdi?",
    q3Staff: "3. Xodimning muomalasi qanday bo‘ldi?",
    q1Pharmacy: "1. Dorixonani umumiy baholang",
    q2Pharmacy: "2. Tozalik va qulaylik qanday?",
    q3Pharmacy: "3. Dori va mahsulotlar tanlovi qanday?",
    comment: "Izoh (ixtiyoriy)",
    commentPh: "Fikringiz yoki taklifingiz…",
    yourName: "Ismingiz",
    yourPhone: "Telefon raqamingiz",
    namePh: "Ism Familiya",
    phonePh: "+998 9X XXX XX XX",
    nameReq: "Ism majburiy — yozing",
    phoneReq: "Telefon majburiy",
    phoneFmt: "Raqam +9989 dan boshlanishi kerak",
    starsReq: "Yulduz bahosini tanlang",
    qualityReq: "Xizmat sifatini tanlang",
    demeanorReq: "Muomala / bahoni tanlang",
    submit: "BAHONI YUBORISH",
    done: "RAHMAT!",
    doneSub: "Fikringiz qabul qilindi. Yaxshi kun tilaymiz!",
    emptyStaff: "Hozir smenada xodim yo‘q — dorixonani baholashingiz mumkin.",
    blocked: "Bu QR vaqtincha o‘chirilgan.",
    notFound: "QR topilmadi yoki eskirgan.",
    loading: "Yuklanmoqda…",
    selectOne: "Kamida bitta xodimni tanlang",
    sendError: "Yuborilmadi",
    fillRed: "Qizil bilan belgilangan joylarni to‘ldiring",
    alo: "A'lo",
    yaxshi: "Yaxshi",
    qoniqarli: "Qoniqarli",
    yomon: "Yomon",
    juda_yomon: "Juda yomon",
    xushmuomala: "Xushmuomala",
    oddiy: "Oddiy",
    qopol: "Qo‘pol",
    juda_qopol: "Juda qo‘pol",
    branch: "Filial",
  },
  ru: {
    title: "ОЦЕНИТЕ СЕРВИС",
    thanks: "Спасибо за визит в нашу аптеку!",
    chooseTitle: "Что оцениваете?",
    chooseSub: "Выберите один вариант",
    chooseStaff: "Оценить сотрудников",
    chooseStaffSub: "Выберите сотрудника(ов) на смене",
    choosePharmacy: "Оценить аптеку",
    choosePharmacySub: "Филиал, чистота и ассортимент",
    pickStaff: "Кого оцениваете?",
    allShift: "Вся смена",
    next: "ДАЛЕЕ",
    back: "Назад",
    q1Staff: "1. Общее качество сервиса",
    q2Staff: "2. Насколько понятно сотрудник дал консультацию?",
    q3Staff: "3. Как было общение сотрудника?",
    q1Pharmacy: "1. Общая оценка аптеки",
    q2Pharmacy: "2. Как чистота и удобство?",
    q3Pharmacy: "3. Как ассортимент лекарств и товаров?",
    comment: "Комментарий (необязательно)",
    commentPh: "Ваше мнение или предложение…",
    yourName: "Ваше имя",
    yourPhone: "Номер телефона",
    namePh: "Имя Фамилия",
    phonePh: "+998 9X XXX XX XX",
    nameReq: "Имя обязательно",
    phoneReq: "Телефон обязателен",
    phoneFmt: "Номер должен начинаться с +9989",
    starsReq: "Выберите оценку звёздами",
    qualityReq: "Выберите качество сервиса",
    demeanorReq: "Выберите оценку общения",
    submit: "ОТПРАВИТЬ ОЦЕНКУ",
    done: "СПАСИБО!",
    doneSub: "Ваш отзыв принят. Хорошего дня!",
    emptyStaff: "Сейчас на смене нет сотрудников — можно оценить аптеку.",
    blocked: "Этот QR временно отключён.",
    notFound: "QR не найден или устарел.",
    loading: "Загрузка…",
    selectOne: "Выберите хотя бы одного сотрудника",
    sendError: "Не удалось отправить",
    fillRed: "Заполните поля, отмеченные красным",
    alo: "Отлично",
    yaxshi: "Хорошо",
    qoniqarli: "Удовл.",
    yomon: "Плохо",
    juda_yomon: "Очень плохо",
    xushmuomala: "Вежливый",
    oddiy: "Обычный",
    qopol: "Грубый",
    juda_qopol: "Очень грубый",
    branch: "Филиал",
  },
};

const QUALITY = ["alo", "yaxshi", "qoniqarli", "yomon", "juda_yomon"] as const;
const DEMEANOR = ["xushmuomala", "yaxshi", "oddiy", "qopol", "juda_qopol"] as const;

function digitsPhone(raw: string): string {
  let d = String(raw || "").replace(/\D+/g, "");
  if (d.startsWith("998")) d = d.slice(3);
  d = d.slice(0, 9);
  return d ? `998${d}` : "";
}

function isValidUzMobile(raw: string): boolean {
  return /^9989\d{8}$/.test(digitsPhone(raw));
}

function formatPhoneDisplay(raw: string): string {
  let local = String(raw || "").replace(/\D+/g, "");
  if (local.startsWith("998")) local = local.slice(3);
  local = local.slice(0, 9);
  const a = local.slice(0, 2);
  const b = local.slice(2, 5);
  const c = local.slice(5, 7);
  const d = local.slice(7, 9);
  let out = "+998";
  if (a) out += ` ${a}`;
  if (b) out += ` ${b}`;
  if (c) out += ` ${c}`;
  if (d) out += ` ${d}`;
  return out;
}

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
    return localStorage.getItem("vhr_baho_lang") === "ru" ? "ru" : "uz";
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
  const [demeanor, setDemeanor] = useState("");
  const [comment, setComment] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("+998");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const [fieldErr, setFieldErr] = useState<Record<string, string>>({});

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
    setTried(false);
    setFieldErr({});
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

  const validateForm = () => {
    const fe: Record<string, string> = {};
    if (!stars) fe.stars = t("starsReq");
    if (!quality) fe.quality = t("qualityReq");
    if (!demeanor) fe.demeanor = t("demeanorReq");
    if (name.trim().length < 2) fe.name = t("nameReq");
    const dig = digitsPhone(phone);
    if (!dig || dig.length < 12) fe.phone = t("phoneReq");
    else if (!isValidUzMobile(phone)) fe.phone = t("phoneFmt");
    setFieldErr(fe);
    return Object.keys(fe).length === 0;
  };

  const submit = async () => {
    setErr(null);
    setTried(true);
    if (!rateType) return;
    if (!validateForm()) {
      setErr(t("fillRed"));
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
          customerName: name.trim(),
          customerPhone: digitsPhone(phone),
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
    setTried(false);
    setFieldErr({});
    if (rateType === "staff") setStep("staff");
    else {
      setRateType(null);
      setStep("choose");
    }
  };

  return (
    <div className="min-h-[100dvh] bg-[#f7f4fb] text-slate-900">
      {/* Oq navbar + katta logo */}
      <header className="sticky top-0 z-20 border-b-4 border-[#f5c518] bg-white shadow-sm">
        <div className="mx-auto flex max-w-lg items-center justify-between gap-3 px-4 py-4 sm:max-w-xl sm:px-6">
          <img
            src={LOGO}
            alt="Vaksina Med"
            className="h-[4.25rem] w-auto max-w-[min(78vw,320px)] object-contain object-left sm:h-20"
          />
          <button
            type="button"
            onClick={() => setLang((l) => (l === "uz" ? "ru" : "uz"))}
            className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full border border-[#5c2d91]/20 bg-[#5c2d91]/5 px-3 text-xs font-bold text-[#5c2d91]"
          >
            <Languages className="h-3.5 w-3.5" />
            {lang === "uz" ? "RU" : "UZ"}
          </button>
        </div>
      </header>

      <div className="mx-auto flex min-h-[calc(100dvh-4.5rem)] w-full max-w-lg flex-col px-4 pb-10 pt-5 sm:max-w-xl sm:px-6">
        {session?.branchLabel ? (
          <p className="text-center text-[11px] font-bold uppercase tracking-[0.16em] text-[#5c2d91]/80">
            {t("branch")} · {session.branchLabel}
          </p>
        ) : null}
        <h1
          className="mt-2 text-center text-[1.55rem] font-black tracking-[0.06em] sm:text-[1.85rem]"
          style={{ color: PURPLE }}
        >
          {t("title")}
        </h1>
        <p className="mt-1.5 text-center text-sm text-slate-500">{t("thanks")}</p>

        {loading ? (
          <div className="flex flex-1 items-center justify-center gap-2 text-sm text-slate-500">
            <Loader2 className="h-5 w-5 animate-spin" style={{ color: YELLOW }} /> {t("loading")}
          </div>
        ) : loadErr && !session ? (
          <div className="mt-8 rounded-3xl border-2 border-rose-400 bg-rose-50 px-4 py-8 text-center">
            <AlertCircle className="mx-auto h-10 w-10 text-rose-500" />
            <p className="mt-3 text-sm font-bold text-rose-700">{loadErr}</p>
          </div>
        ) : step === "done" ? (
          <div className="flex flex-1 flex-col items-center justify-center text-center">
            <img
              src={LOGO}
              alt="Vaksina Med"
              className="mb-7 h-16 w-auto max-w-[280px] object-contain sm:h-[4.5rem]"
            />
            <span className="flex h-[4.75rem] w-[4.75rem] items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 text-white shadow-[0_12px_40px_rgba(16,185,129,0.4)]">
              <Check className="h-9 w-9" strokeWidth={3} />
            </span>
            <h2 className="mt-6 text-3xl font-black tracking-[0.08em]" style={{ color: PURPLE }}>
              {t("done")}
            </h2>
            <p className="mt-2 max-w-xs text-sm leading-relaxed text-slate-500">{t("doneSub")}</p>
          </div>
        ) : step === "choose" ? (
          <div className="mt-6 flex flex-1 flex-col">
            <h2 className="text-lg font-extrabold text-slate-900">{t("chooseTitle")}</h2>
            <p className="mt-1 text-sm text-slate-500">{t("chooseSub")}</p>
            <div className="mt-5 grid gap-3.5">
              <ChoiceCard
                disabled={!hasStaff}
                warn={!hasStaff}
                onClick={openStaff}
                icon={<Users className="h-6 w-6" />}
                tone="yellow"
                title={t("chooseStaff")}
                sub={hasStaff ? t("chooseStaffSub") : t("emptyStaff")}
              />
              <ChoiceCard
                onClick={openPharmacy}
                icon={<Store className="h-6 w-6" />}
                tone="cyan"
                title={t("choosePharmacy")}
                sub={t("choosePharmacySub")}
              />
            </div>
            {err ? <RedBanner>{err}</RedBanner> : null}
          </div>
        ) : step === "staff" ? (
          <div className="mt-4 flex flex-1 flex-col">
            <BackBtn
              label={t("back")}
              onClick={() => {
                setStep("choose");
                setRateType(null);
                setErr(null);
              }}
            />
            <h2 className="text-lg font-extrabold">{t("pickStaff")}</h2>
            <button
              type="button"
              onClick={pickAll}
              className={cn(
                "mt-4 flex items-center gap-3 rounded-2xl border-2 px-4 py-3.5 text-left transition active:scale-[0.99]",
                allShift
                  ? "border-[#f5c518] bg-[#fff8db] shadow-md shadow-[#f5c518]/20"
                  : "border-slate-200 bg-white hover:border-[#5c2d91]/30",
              )}
            >
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#5c2d91]/10 text-[#5c2d91]">
                <Users className="h-5 w-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold">{t("allShift")}</span>
                <span className="text-xs text-slate-500">{staff.length} ta</span>
              </span>
              {allShift ? <Check className="h-5 w-5 text-[#5c2d91]" /> : null}
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
                        "flex w-full items-center gap-3 rounded-2xl border-2 px-4 py-3.5 text-left transition active:scale-[0.99]",
                        on
                          ? "border-[#f5c518] bg-[#fff8db]"
                          : "border-slate-200 bg-white hover:border-[#5c2d91]/30",
                      )}
                    >
                      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-[#f5c518] to-[#c9a227] text-sm font-extrabold text-black">
                        {s.fullName
                          .split(/\s+/)
                          .slice(0, 2)
                          .map((p) => p[0])
                          .join("")
                          .toUpperCase()}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-bold">{s.fullName}</span>
                        <span className="text-xs text-slate-500">{s.position}</span>
                      </span>
                      <span
                        className={cn(
                          "flex h-6 w-6 items-center justify-center rounded-full border-2",
                          on ? "border-[#f5c518] bg-[#f5c518] text-black" : "border-slate-300",
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
              <PremiumBtn
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
              >
                {t("next")}
              </PremiumBtn>
              {err ? <RedBanner>{err}</RedBanner> : null}
            </div>
          </div>
        ) : (
          <div className="mt-3 flex flex-1 flex-col space-y-4">
            <BackBtn
              label={
                rateType === "staff" && selectedNames.length
                  ? `${t("back")} · ${selectedNames.slice(0, 2).join(", ")}${selectedNames.length > 2 ? "…" : ""}`
                  : rateType === "pharmacy"
                    ? `${t("back")} · ${session?.branchLabel || ""}`
                    : t("back")
              }
              onClick={formBack}
            />

            <Card invalid={tried && !!fieldErr.stars}>
              <h3 className="text-sm font-bold text-slate-900">
                {rateType === "pharmacy" ? t("q1Pharmacy") : t("q1Staff")}
                <Req />
              </h3>
              <div className="mt-3 flex justify-between gap-1">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => {
                      setStars(n);
                      if (tried) setFieldErr((p) => ({ ...p, stars: "" }));
                    }}
                    className="flex flex-1 flex-col items-center gap-1 py-1"
                  >
                    <Star
                      className={cn(
                        "h-9 w-9 sm:h-10 sm:w-10",
                        stars >= n ? "fill-[#f5c518] text-[#f5c518]" : "text-slate-300",
                      )}
                      strokeWidth={1.5}
                    />
                    <span className="text-[11px] font-semibold text-slate-400">{n}</span>
                  </button>
                ))}
              </div>
              {tried && fieldErr.stars ? <FieldRed>{fieldErr.stars}</FieldRed> : null}
            </Card>

            <RadioBlock
              title={rateType === "pharmacy" ? t("q2Pharmacy") : t("q2Staff")}
              value={quality}
              invalid={tried && !!fieldErr.quality}
              error={fieldErr.quality}
              onChange={(v) => {
                setQuality(v as typeof quality);
                if (tried) setFieldErr((p) => ({ ...p, quality: "" }));
              }}
              options={QUALITY.map((k) => ({ k, label: t(k) }))}
            />
            <RadioBlock
              title={rateType === "pharmacy" ? t("q3Pharmacy") : t("q3Staff")}
              value={demeanor}
              invalid={tried && !!fieldErr.demeanor}
              error={fieldErr.demeanor}
              onChange={(v) => {
                setDemeanor(v);
                if (tried) setFieldErr((p) => ({ ...p, demeanor: "" }));
              }}
              options={
                rateType === "pharmacy"
                  ? QUALITY.map((k) => ({ k, label: t(k) }))
                  : DEMEANOR.map((k) => ({ k, label: t(k) }))
              }
            />

            <label className="block rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm">
              <span className="text-sm font-bold">{t("comment")}</span>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={3}
                placeholder={t("commentPh")}
                className="mt-2 w-full resize-none rounded-xl border border-slate-200 bg-[#fafafa] px-3 py-2.5 text-base outline-none focus:border-[#5c2d91]/40"
              />
            </label>

            <label
              className={cn(
                "block rounded-2xl border-2 bg-white p-3.5 shadow-sm",
                tried && fieldErr.name ? "border-rose-500 bg-rose-50" : "border-slate-200",
              )}
            >
              <span className="text-sm font-bold">
                {t("yourName")}
                <Req />
              </span>
              <input
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (tried && e.target.value.trim().length >= 2) setFieldErr((p) => ({ ...p, name: "" }));
                }}
                placeholder={t("namePh")}
                autoComplete="name"
                className="mt-2 h-12 w-full rounded-xl border border-slate-200 bg-[#fafafa] px-3 text-base outline-none focus:border-[#5c2d91]/40"
              />
              {tried && fieldErr.name ? <FieldRed>{fieldErr.name}</FieldRed> : null}
            </label>

            <label
              className={cn(
                "block rounded-2xl border-2 bg-white p-3.5 shadow-sm",
                tried && fieldErr.phone ? "border-rose-500 bg-rose-50" : "border-slate-200",
              )}
            >
              <span className="text-sm font-bold">
                {t("yourPhone")}
                <Req />
              </span>
              <input
                value={phone}
                onChange={(e) => {
                  const next = formatPhoneDisplay(e.target.value);
                  setPhone(next);
                  if (tried) {
                    setFieldErr((p) => ({
                      ...p,
                      phone: isValidUzMobile(next) ? "" : t("phoneFmt"),
                    }));
                  }
                }}
                placeholder={t("phonePh")}
                inputMode="tel"
                autoComplete="tel"
                className="mt-2 h-12 w-full rounded-xl border border-slate-200 bg-[#fafafa] px-3 text-base tabular-nums outline-none focus:border-[#5c2d91]/40"
              />
              {tried && fieldErr.phone ? <FieldRed>{fieldErr.phone}</FieldRed> : null}
              <p className="mt-1.5 text-[11px] font-medium text-slate-400">+998 9X XXX XX XX</p>
            </label>

            <div className="pt-2">
              <PremiumBtn disabled={busy} onClick={() => void submit()} glow>
                {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : null}
                {t("submit")}
              </PremiumBtn>
              {err ? <RedBanner>{err}</RedBanner> : null}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Req() {
  return <span className="ml-1 font-black text-rose-500">*</span>;
}

function FieldRed({ children }: { children: string }) {
  return (
    <p className="mt-1.5 flex items-start gap-1 text-xs font-bold text-rose-600">
      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      {children}
    </p>
  );
}

function RedBanner({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-3 flex items-center justify-center gap-1.5 rounded-xl border-2 border-rose-400 bg-rose-50 px-3 py-2.5 text-center text-xs font-bold text-rose-700">
      <AlertCircle className="h-3.5 w-3.5 shrink-0" />
      {children}
    </p>
  );
}

function BackBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mb-2 inline-flex items-center gap-1 self-start text-xs font-bold text-slate-500 hover:text-[#5c2d91]"
    >
      <ChevronLeft className="h-4 w-4" />
      {label}
    </button>
  );
}

function Card({ children, invalid }: { children: React.ReactNode; invalid?: boolean }) {
  return (
    <div
      className={cn(
        "rounded-2xl border-2 bg-white p-3.5 shadow-sm",
        invalid ? "border-rose-500 bg-rose-50" : "border-slate-200",
      )}
    >
      {children}
    </div>
  );
}

function PremiumBtn({
  children,
  onClick,
  disabled,
  glow,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  glow?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex h-14 w-full items-center justify-center gap-2 rounded-2xl text-[15px] font-black tracking-[0.08em] text-black transition active:scale-[0.98] disabled:opacity-40",
        "bg-gradient-to-r from-[#f5c518] via-[#ffe066] to-[#f5c518]",
        glow && "shadow-[0_10px_36px_rgba(245,197,24,0.45)]",
      )}
    >
      {children}
    </button>
  );
}

function ChoiceCard({
  title,
  sub,
  icon,
  tone,
  onClick,
  disabled,
  warn,
}: {
  title: string;
  sub: string;
  icon: React.ReactNode;
  tone: "yellow" | "cyan";
  onClick: () => void;
  disabled?: boolean;
  warn?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex flex-col items-start gap-3 rounded-3xl border-2 bg-white px-4 py-5 text-left shadow-sm transition active:scale-[0.99]",
        disabled && "cursor-not-allowed opacity-60",
        warn ? "border-rose-300" : "border-slate-200 hover:border-[#5c2d91]/40 hover:shadow-md",
      )}
    >
      <span
        className={cn(
          "flex h-12 w-12 items-center justify-center rounded-2xl",
          tone === "yellow" ? "bg-[#f5c518]/20 text-[#b8860b]" : "bg-[#22c5e0]/15 text-[#0891b2]",
        )}
      >
        {icon}
      </span>
      <span>
        <span className="block text-base font-extrabold text-slate-900">{title}</span>
        <span className={cn("mt-1 block text-xs leading-relaxed", warn ? "font-bold text-rose-600" : "text-slate-500")}>
          {sub}
        </span>
      </span>
    </button>
  );
}

function RadioBlock({
  title,
  value,
  onChange,
  options,
  invalid,
  error,
}: {
  title: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ k: string; label: string }>;
  invalid?: boolean;
  error?: string;
}) {
  return (
    <Card invalid={invalid}>
      <h3 className="text-sm font-bold text-slate-900">
        {title}
        <Req />
      </h3>
      <ul className="mt-2 space-y-0.5">
        {options.map((o) => {
          const on = value === o.k;
          return (
            <li key={o.k}>
              <button
                type="button"
                onClick={() => onChange(o.k)}
                className="flex w-full items-center gap-3 rounded-xl px-1 py-2.5 text-left"
              >
                <span
                  className={cn(
                    "flex h-5 w-5 items-center justify-center rounded-full border-2",
                    on ? "border-[#5c2d91]" : "border-slate-300",
                  )}
                >
                  {on ? <span className="h-2.5 w-2.5 rounded-full bg-[#5c2d91]" /> : null}
                </span>
                <span className="text-sm font-semibold text-slate-800">{o.label}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {invalid && error ? <FieldRed>{error}</FieldRed> : null}
    </Card>
  );
}
