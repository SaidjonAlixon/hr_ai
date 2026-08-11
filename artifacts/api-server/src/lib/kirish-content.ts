/** Kirish o‘quv moduli — 3 bosqich. To‘g‘ri javoblar faqat serverda ishlatiladi. */

export const KIRISH_PASS_SCORE = 50; // > 50%
export const KIRISH_STAGE_COUNT = 3;

export type KirishSlide = {
  id: string;
  title: string;
  body: string;
  accent: string;
};

export type KirishQuestion = {
  id: string;
  text: string;
  options: string[];
  /** 0-based index — faqat serverda */
  correctIndex: number;
};

export type KirishStageContent = {
  stage: number;
  title: string;
  subtitle: string;
  videoUrl: string;
  videoPosterHint: string;
  slides: KirishSlide[];
  questions: KirishQuestion[];
};

export const KIRISH_STAGES: KirishStageContent[] = [
  {
    stage: 1,
    title: "1-bosqich: Apteka kirish asoslari",
    subtitle: "Video → slaydlar → test. 50% dan yuqori natija keyingi bosqichni ochadi.",
    videoUrl: "/kirish/stage1/intro.mp4",
    videoPosterHint: "Farmasevt stajori: kirish va odob-axloq",
    slides: [
      {
        id: "s1-1",
        title: "Xush kelibsiz",
        body: "VAKSINA MED HR staj dasturi orqali siz apteka ish tartibi, mijoz bilan muloqot va xavfsizlik qoidalarini o‘rganasiz. Har bir bosqich: video, slayd, test.",
        accent: "#2AABEE",
      },
      {
        id: "s1-2",
        title: "Ish kuni tartibi",
        body: "Smena boshlanishida: tashqi ko‘rinish, steril yuvinish, kasada/javonda tekshiruv. Hujjatlar va retseptlar tartibli saqlanadi. Shaxsiy telefon — faqat ruxsat etilgan joyda.",
        accent: "#6C5CE7",
      },
      {
        id: "s1-3",
        title: "Mijoz bilan muloqot",
        body: "Salomlashish, tinglash, aniq savollar. Tushunarsiz bo‘lsa — mudir yoki tajribali farmasevtdan so‘rang. Hech qachon o‘zingiz diagnostika qo‘ymang.",
        accent: "#00B894",
      },
      {
        id: "s1-4",
        title: "Dori xavfsizligi",
        body: "Muddati o‘tgan, shikastlangan yoki noto‘g‘ri saqlangan dorilarni sotmang. Retseptli dorilar — faqat retsept asosida. Saqlash harorati va yorug‘lik talablariga rioya qiling.",
        accent: "#E17055",
      },
      {
        id: "s1-5",
        title: "Maxfiylik",
        body: "Mijozning sog‘ligi va xarid ma’lumotlari maxfiy. Uchinchi shaxslarga aytmang. Ichki tizimdagi login/parolni ulashmang.",
        accent: "#0984E3",
      },
      {
        id: "s1-6",
        title: "Keyingi qadam",
        body: "Slaydlarni ko‘rib chiqdingiz. Endi qisqa test — 50% dan yuqori ball bilan 2-bosqich ochiladi.",
        accent: "#2D3436",
      },
    ],
    questions: [
      {
        id: "q1-1",
        text: "Staj dasturining asosiy ketma-ketligi qanday?",
        options: [
          "Faqat test",
          "Video → slaydlar → test",
          "Faqat video",
          "Hujjat imzolash",
        ],
        correctIndex: 1,
      },
      {
        id: "q1-2",
        text: "Mijozga tashxis qo‘yish mumkinmi?",
        options: [
          "Ha, agar tajriba bo‘lsa",
          "Faqat kechqurun",
          "Yo‘q — diagnostika qilinmaydi, kerak bo‘lsa mutaxassisga yo‘naltiriladi",
          "Faqat bolalarga",
        ],
        correctIndex: 2,
      },
      {
        id: "q1-3",
        text: "Muddati o‘tgan dori bilan nima qilinadi?",
        options: [
          "Chegirma bilan sotiladi",
          "Sotilmaydi / chiqarib tashlanadi (tartib bo‘yicha)",
          "Omborxonaga yashirinadi",
          "Mijozga bepul beriladi",
        ],
        correctIndex: 1,
      },
      {
        id: "q1-4",
        text: "Retseptli dori qachon beriladi?",
        options: [
          "Har doim so‘rovga ko‘ra",
          "Faqat do‘stga",
          "Faqat amal qiluvchi retsept asosida",
          "Faqat naqd to‘lovda",
        ],
        correctIndex: 2,
      },
      {
        id: "q1-5",
        text: "Mijoz ma’lumotlari haqida to‘g‘ri gap:",
        options: [
          "Ijtimoiy tarmoqda ulashish mumkin",
          "Maxfiy — uchinchi shaxslarga aytilmaydi",
          "Faqat oilaga aytiladi",
          "Faqat narx maxfiy",
        ],
        correctIndex: 1,
      },
      {
        id: "q1-6",
        text: "Keyingi bosqich ochilishi uchun minimal natija?",
        options: ["30%", "50% dan yuqori", "Aniq 50%", "100% majburiy"],
        correctIndex: 1,
      },
    ],
  },
  {
    stage: 2,
    title: "2-bosqich: Savdo va kassa",
    subtitle: "Tez orada to‘liq kontent. Hozir demo oqim.",
    videoUrl: "/kirish/stage2/intro.mp4",
    videoPosterHint: "Kassa va chek — demo",
    slides: [
      {
        id: "s2-1",
        title: "Kassa intizomi",
        body: "Har bir sotuv chek bilan. Qaytimni tekshiring. Smena oxirida hisobot.",
        accent: "#2AABEE",
      },
      {
        id: "s2-2",
        title: "Narx va aksiya",
        body: "Tizimdagi narx asosiy. Aksiya — faqat tasdiqlangan ro‘yxat bo‘yicha.",
        accent: "#6C5CE7",
      },
      {
        id: "s2-3",
        title: "Qaytarish",
        body: "Qaytarish mudir ruxsati va hujjat bilan. O‘zboshimchalik qilinmaydi.",
        accent: "#00B894",
      },
    ],
    questions: [
      {
        id: "q2-1",
        text: "Sotuv qanday rasmiylashtiriladi?",
        options: ["Og‘zaki", "Chek / tizim orqali", "Faqat daftar", "SMS"],
        correctIndex: 1,
      },
      {
        id: "q2-2",
        text: "Aksiya qachon qo‘llanadi?",
        options: [
          "Har doim",
          "Faqat tasdiqlangan ro‘yxat bo‘yicha",
          "Faqat kechqurun",
          "Faqat naqd",
        ],
        correctIndex: 1,
      },
      {
        id: "q2-3",
        text: "Qaytarish uchun nima kerak?",
        options: ["Hech narsa", "Mudir ruxsati va hujjat", "Faqat mijoz so‘zi", "Telefon"],
        correctIndex: 1,
      },
    ],
  },
  {
    stage: 3,
    title: "3-bosqich: Yakuniy standartlar",
    subtitle: "Oxirgi bosqich. Muvaffaqiyatli tugatsangiz — «Tugatish».",
    videoUrl: "/kirish/stage3/intro.mp4",
    videoPosterHint: "Yakuniy standartlar — demo",
    slides: [
      {
        id: "s3-1",
        title: "Jamoa",
        body: "Mudir va koordinator ko‘rsatmalariga amal qiling. Muammo bo‘lsa — darhol xabar bering.",
        accent: "#2AABEE",
      },
      {
        id: "s3-2",
        title: "Sifat",
        body: "Toza javon, to‘g‘ri joylashuv, mijoz kutishini kamaytirish — kundalik sifat.",
        accent: "#E17055",
      },
      {
        id: "s3-3",
        title: "Tayyorgarlik",
        body: "Barcha bosqichlarni o‘tgach «Tugatish» ni bosing — holatingiz HR uchun tayyorlanadi.",
        accent: "#00B894",
      },
    ],
    questions: [
      {
        id: "q3-1",
        text: "Muammo chiqsa nima qilish kerak?",
        options: [
          "Yashirish",
          "Darhol mudir/koordinatorga xabar berish",
          "Kutish",
          "O‘zingiz yechish majburiy",
        ],
        correctIndex: 1,
      },
      {
        id: "q3-2",
        text: "Yakuniy bosqichdan keyin nima qilinadi?",
        options: [
          "Hech narsa",
          "«Tugatish» — holat HR uchun tayyorlanadi",
          "Darhol director bo‘lasiz",
          "Parol o‘zgaradi",
        ],
        correctIndex: 1,
      },
      {
        id: "q3-3",
        text: "Sifatga nima kiradi?",
        options: [
          "Faqat narx",
          "Toza javon, tartib, mijoz kutishini kamaytirish",
          "Faqat reklama",
          "Faqat kassa",
        ],
        correctIndex: 1,
      },
    ],
  },
];

export function getStage(n: number) {
  return KIRISH_STAGES.find((s) => s.stage === n) ?? null;
}

export function publicStagePayload(stage: KirishStageContent) {
  return {
    stage: stage.stage,
    title: stage.title,
    subtitle: stage.subtitle,
    videoUrl: stage.videoUrl,
    videoPosterHint: stage.videoPosterHint,
    slides: stage.slides,
    questions: stage.questions.map((q) => ({
      id: q.id,
      text: q.text,
      options: q.options,
    })),
  };
}

export function scoreAnswers(
  stage: KirishStageContent,
  answers: Record<string, number>,
): { score: number; correct: number; total: number; passed: boolean } {
  const total = stage.questions.length;
  let correct = 0;
  for (const q of stage.questions) {
    if (answers[q.id] === q.correctIndex) correct += 1;
  }
  const score = total ? Math.round((correct / total) * 100) : 0;
  return { score, correct, total, passed: score > KIRISH_PASS_SCORE };
}
