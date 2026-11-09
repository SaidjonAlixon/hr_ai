import { useEffect, useMemo, useState } from "react";
import { useRoute } from "wouter";
import { Check, Languages, Loader2, Star, Store, Users, AlertCircle } from "lucide-react";
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
    commentPh: "Fikringiz yoki taklifingiz…",
    yourName: "Ismingiz",
    yourPhone: "Telefon raqamingiz",
    namePh: "Ism Familiya",
    phonePh: "+998 9X XXX XX XX",
    required: "Majburiy",
    nameReq: "Ism majburiy — yozing",
    phoneReq: "Telefon majburiy",
    phoneFmt: "Raqam +9989 dan boshlanishi kerak (+998 9X XXX XX XX)",
    starsReq: "Yulduz bahosini tanlang",
    qualityReq: "Xizmat sifatini tanlang",
    demeanorReq: "Muomala / bahoni tanlang",
    submit: "Bahoni yuborish",
    done: "Rahmat!",
    doneSub: "Fikringiz qabul qilindi. Yaxshi kun tilaymiz!",
    emptyStaff: "Hozir smenada xodim yo‘q — dorixonani baholashingiz mumkin.",
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
    branch: "Filial",
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
    commentPh: "Ваше мнение или предложение…",
    yourName: "Ваше имя",
    yourPhone: "Номер телефона",
    namePh: "Имя Фамилия",
    phonePh: "+998 9X XXX XX XX",
    required: "Обязательно",
    nameReq: "Имя обязательно",
    phoneReq: "Телефон обязателен",
    phoneFmt: "Номер должен начинаться с +9989 (+998 9X XXX XX XX)",
    starsReq: "Выберите оценку звёздами",
    qualityReq: "Выберите качество сервиса",
    demeanorReq: "Выберите оценку общения",
    submit: "Отправить оценку",
    done: "Спасибо!",
    doneSub: "Ваш отзыв принят. Хорошего дня!",
    emptyStaff: "Сейчас на смене нет сотрудников — можно оценить аптеку.",
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
    branch: "Филиал",
  },
};

const QUALITY = ["alo", "yaxshi", "qoniqarli", "yomon", "juda_yomon"] as const;
const DEMEANOR = ["xushmuomala", "yaxshi", "oddiy", "qopol", "juda_qopol"] as const;

/** Faqat raqamlar: 9989XXXXXXXX (12 ta) */
function digitsPhone(raw: string): string {
  let d = String(raw || "").replace(/\D+/g, "");
  if (d.startsWith("998")) d = d.slice(3);
  d = d.slice(0, 9);
  return d ? `998${d}` : "";
}

function isValidUzMobile(raw: string): boolean {
  return /^9989\d{8}$/.test(digitsPhone(raw));
}

/** +998 9X XXX XX XX */
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
      setErr(lang === "ru" ? "Красным отмечено — заполните" : "Qizil bilan belgilangan joylarni to‘ldiring");
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

  const onPhoneChange = (v: string) => {
    setPhone(formatPhoneDisplay(v));
    if (tried) {
      setFieldErr((prev) => {
        const next = { ...prev };
        if (!isValidUzMobile(v)) next.phone = t("phoneFmt");
        else delete next.phone;
        return next;
      });
    }
  };

  return (
    <div className="min-h-[100dvh] bg-[#0a0612] text-white">
      {/* Brend fon */}
      <div
        className="pointer-events-none fixed inset-0 opacity-90"
        style={{
          background:
            "radial-gradient(ellipse 80% 50% at 50% -10%, rgba(92,45,145,0.45), transparent 60%), radial-gradient(ellipse 60% 40% at 100% 20%, rgba(245,197,24,0.12), transparent 50%), radial-gradient(ellipse 50% 30% at 0% 80%, rgba(34,197,224,0.1), transparent 50%)",
        }}
      />

      <div className="relative mx-auto flex min-h-[100dvh] w-full max-w-lg flex-col px-4 pb-10 pt-4 sm:max-w-xl sm:px-6">
        {/* Header: logo + til */}
        <header className="mb-5 flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <img
              src={LOGO}
              alt="Vaksina Med"
              className="h-11 w-auto max-w-[220px] rounded-xl object-contain object-left sm:h-12 sm:max-w-[260px]"
            />
            {session?.branchLabel ? (
              <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#f5c518]/90">
                {t("branch")} · {session.branchLabel}
              </p>
            ) : null}
            <h1 className="mt-1.5 text-[1.65rem] font-extrabold leading-tight tracking-tight sm:text-3xl">
              {t("title")}
            </h1>
            <p className="mt-1 text-sm text-white/55">{t("thanks")}</p>
          </div>
          <button
            type="button"
            onClick={() => setLang((l) => (l === "uz" ? "ru" : "uz"))}
            className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-3 text-xs font-bold text-white/90 backdrop-blur"
          >
            <Languages className="h-3.5 w-3.5" />
            {lang === "uz" ? "RU" : "UZ"}
          </button>
        </header>

        {loading ? (
          <div className="flex flex-1 items-center justify-center gap-2 text-sm text-white/50">
            <Loader2 className="h-5 w-5 animate-spin text-[#f5c518]" /> {t("loading")}
          </div>
        ) : loadErr && !session ? (
          <div className="mt-8 rounded-3xl border border-rose-500/40 bg-rose-500/10 px-4 py-8 text-center">
            <AlertCircle className="mx-auto h-10 w-10 text-rose-400" />
            <p className="mt-3 text-sm font-bold text-rose-200">{loadErr}</p>
          </div>
        ) : step === "done" ? (
          <div className="flex flex-1 flex-col items-center justify-center px-2 text-center">
            <img src={LOGO} alt="" className="mb-8 h-12 w-auto rounded-xl object-contain opacity-95" />
            <span className="relative flex h-[4.5rem] w-[4.5rem] items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 text-white shadow-[0_0_40px_rgba(16,185,129,0.45)]">
              <Check className="h-9 w-9" strokeWidth={3} />
            </span>
            <h2 className="mt-6 text-3xl font-extrabold tracking-tight">{t("done")}</h2>
            <p className="mt-2 max-w-xs text-sm leading-relaxed text-white/60">{t("doneSub")}</p>
            {session?.branchLabel ? (
              <p className="mt-6 rounded-full border border-[#f5c518]/30 bg-[#f5c518]/10 px-4 py-1.5 text-xs font-bold text-[#f5c518]">
                {session.branchLabel}
              </p>
            ) : null}
          </div>
        ) : step === "choose" ? (
          <div className="flex flex-1 flex-col">
            <h2 className="text-lg font-extrabold">{t("chooseTitle")}</h2>
            <p className="mt-1 text-sm text-white/50">{t("chooseSub")}</p>

            <div className="mt-5 grid gap-3.5">
              <ChoiceCard
                disabled={!hasStaff}
                onClick={openStaff}
                icon={<Users className="h-6 w-6" />}
                iconClass="bg-[#f5c518]/15 text-[#f5c518]"
                title={t("chooseStaff")}
                sub={hasStaff ? t("chooseStaffSub") : t("emptyStaff")}
                warn={!hasStaff}
              />
              <ChoiceCard
                onClick={openPharmacy}
                icon={<Store className="h-6 w-6" />}
                iconClass="bg-[#22c5e0]/15 text-[#22c5e0]"
                title={t("choosePharmacy")}
                sub={t("choosePharmacySub")}
              />
            </div>
            {err ? <RedBanner>{err}</RedBanner> : null}
          </div>
        ) : step === "staff" ? (
          <div className="flex flex-1 flex-col">
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
                "mt-4 flex items-center gap-3 rounded-2xl border px-4 py-3.5 text-left transition active:scale-[0.99]",
                allShift
                  ? "border-[#f5c518] bg-[#f5c518]/15 shadow-[0_0_24px_rgba(245,197,24,0.15)]"
                  : "border-white/10 bg-white/[0.04] hover:border-white/25",
              )}
            >
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/10">
                <Users className="h-5 w-5 text-[#f5c518]" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold">{t("allShift")}</span>
                <span className="text-xs text-white/50">{staff.length} ta</span>
              </span>
              {allShift ? <Check className="h-5 w-5 text-[#f5c518]" /> : null}
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
                        "flex w-full items-center gap-3 rounded-2xl border px-4 py-3.5 text-left transition active:scale-[0.99]",
                        on
                          ? "border-[#f5c518] bg-[#f5c518]/15"
                          : "border-white/10 bg-white/[0.04] hover:border-white/25",
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
                        <span className="text-xs text-white/50">{s.position}</span>
                      </span>
                      <span
                        className={cn(
                          "flex h-6 w-6 items-center justify-center rounded-full border",
                          on ? "border-[#f5c518] bg-[#f5c518] text-black" : "border-white/30",
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
          <div className="flex flex-1 flex-col space-y-5">
            <BackBtn
              label={
                rateType === "staff" && selectedNames.length
                  ? `← ${t("back")} · ${selectedNames.slice(0, 2).join(", ")}${selectedNames.length > 2 ? "…" : ""}`
                  : rateType === "pharmacy"
                    ? `← ${t("back")} · ${session?.branchLabel || ""}`
                    : `← ${t("back")}`
              }
              onClick={formBack}
            />

            <section
              className={cn(
                "rounded-2xl border p-3.5",
                tried && fieldErr.stars ? "border-rose-500 bg-rose-500/10" : "border-transparent",
              )}
            >
              <h3 className="text-sm font-bold">
                {rateType === "pharmacy" ? t("q1Pharmacy") : t("q1Staff")}
                <ReqMark />
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
                    className="flex flex-1 flex-col items-center gap-1"
                  >
                    <Star
                      className={cn(
                        "h-9 w-9 sm:h-10 sm:w-10 transition",
                        stars >= n ? "fill-[#f5c518] text-[#f5c518]" : "text-[#f5c518]/30",
                      )}
                      strokeWidth={1.5}
                    />
                    <span className="text-[11px] text-white/45">{n}</span>
                  </button>
                ))}
              </div>
              {tried && fieldErr.stars ? <FieldRed>{fieldErr.stars}</FieldRed> : null}
            </section>

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
              required
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
              required
            />

            <label className="block">
              <span className="text-sm font-bold">{t("comment")}</span>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={3}
                placeholder={t("commentPh")}
                className="mt-2 w-full resize-none rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-3 text-base text-white placeholder:text-white/30 outline-none focus:border-[#f5c518]/50"
              />
            </label>

            <div className="grid gap-3">
              <label className="block">
                <span className="text-sm font-bold">
                  {t("yourName")}
                  <ReqMark />
                </span>
                <input
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    if (tried && e.target.value.trim().length >= 2) {
                      setFieldErr((p) => ({ ...p, name: "" }));
                    }
                  }}
                  placeholder={t("namePh")}
                  autoComplete="name"
                  className={cn(
                    "mt-2 h-12 w-full rounded-2xl border bg-white/[0.05] px-4 text-base outline-none focus:border-[#f5c518]/50",
                    tried && fieldErr.name ? "border-rose-500 bg-rose-500/10" : "border-white/10",
                  )}
                />
                {tried && fieldErr.name ? <FieldRed>{fieldErr.name}</FieldRed> : null}
              </label>
              <label className="block">
                <span className="text-sm font-bold">
                  {t("yourPhone")}
                  <ReqMark />
                </span>
                <input
                  value={phone}
                  onChange={(e) => onPhoneChange(e.target.value)}
                  placeholder={t("phonePh")}
                  inputMode="tel"
                  autoComplete="tel"
                  className={cn(
                    "mt-2 h-12 w-full rounded-2xl border bg-white/[0.05] px-4 text-base tabular-nums outline-none focus:border-[#f5c518]/50",
                    tried && fieldErr.phone ? "border-rose-500 bg-rose-500/10" : "border-white/10",
                  )}
                />
                {tried && fieldErr.phone ? <FieldRed>{fieldErr.phone}</FieldRed> : null}
                <p className="mt-1.5 text-[11px] text-white/40">+998 9X XXX XX XX · mobil</p>
              </label>
            </div>

            <div className="pt-1">
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

function ReqMark() {
  return <span className="ml-1 text-rose-400">*</span>;
}

function FieldRed({ children }: { children: string }) {
  return (
    <p className="mt-1.5 flex items-start gap-1 text-xs font-bold text-rose-400">
      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      {children}
    </p>
  );
}

function RedBanner({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-3 flex items-center justify-center gap-1.5 rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2.5 text-center text-xs font-bold text-rose-300">
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
      className="mb-3 self-start text-xs font-semibold text-white/50 hover:text-white/80"
    >
      {label}
    </button>
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
        "flex h-14 w-full items-center justify-center gap-2 rounded-2xl text-[15px] font-extrabold tracking-wide text-black transition active:scale-[0.98] disabled:opacity-40",
        "bg-gradient-to-r from-[#f5c518] via-[#ffe066] to-[#f5c518]",
        glow && "shadow-[0_8px_32px_rgba(245,197,24,0.35)]",
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
  iconClass,
  onClick,
  disabled,
  warn,
}: {
  title: string;
  sub: string;
  icon: React.ReactNode;
  iconClass: string;
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
        "flex flex-col items-start gap-3 rounded-3xl border px-4 py-5 text-left transition active:scale-[0.99]",
        disabled
          ? "cursor-not-allowed border-white/5 bg-white/[0.02] opacity-55"
          : "border-white/12 bg-white/[0.05] hover:border-[#f5c518]/50 hover:bg-[#f5c518]/8",
        warn && "border-rose-500/30",
      )}
    >
      <span className={cn("flex h-12 w-12 items-center justify-center rounded-2xl", iconClass)}>{icon}</span>
      <span>
        <span className="block text-base font-extrabold">{title}</span>
        <span className={cn("mt-1 block text-xs leading-relaxed", warn ? "font-semibold text-rose-300" : "text-white/50")}>
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
  required,
  invalid,
  error,
}: {
  title: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ k: string; label: string }>;
  required?: boolean;
  invalid?: boolean;
  error?: string;
}) {
  return (
    <section
      className={cn(
        "rounded-2xl border p-3.5",
        invalid ? "border-rose-500 bg-rose-500/10" : "border-transparent",
      )}
    >
      <h3 className="text-sm font-bold">
        {title}
        {required ? <ReqMark /> : null}
      </h3>
      <ul className="mt-2 space-y-1">
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
                    on ? "border-[#f5c518]" : "border-white/35",
                  )}
                >
                  {on ? <span className="h-2.5 w-2.5 rounded-full bg-[#f5c518]" /> : null}
                </span>
                <span className="text-sm font-medium text-white/90">{o.label}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {invalid && error ? <FieldRed>{error}</FieldRed> : null}
    </section>
  );
}
