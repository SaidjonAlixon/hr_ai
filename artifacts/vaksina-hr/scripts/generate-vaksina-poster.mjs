/**
 * VAKSINA MED — A4 landscape, 2 identical majburiyat halves (cut & stick)
 * 3508 × 2480 @ 300 DPI
 * QR: https://lex.uz/docs/3155768#8319207
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import QRCode from "qrcode";
import sharp from "sharp";
import { jsPDF } from "jspdf";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const WORKSPACE = path.resolve(ROOT, "../..");
const OUT_DIR = path.join(ROOT, "public", "posters");
const OUT_PNG = path.join(OUT_DIR, "vaksina-med-poster.png");
const OUT_PDF = path.join(OUT_DIR, "vaksina-med-poster.pdf");
const OUT_PNG_ROOT = path.join(WORKSPACE, "public", "posters", "vaksina-med-poster.png");
const OUT_PDF_ROOT = path.join(WORKSPACE, "public", "posters", "vaksina-med-poster.pdf");
const HTML_PATH = path.join(OUT_DIR, "vaksina-med-poster.html");
const QR_URL = "https://lex.uz/docs/3155768#8319207";

const W = 3508;
const H = 2480;

const LOGO_CANDIDATES = [
  path.join(ROOT, "public", "logo_vaksina_poster.png"),
  path.join(ROOT, "public", "logo_vaksina.png"),
  path.join(
    process.env.USERPROFILE || "",
    ".cursor",
    "projects",
    "c-Users-User-Desktop-hr-ai-VAKSINA",
    "assets",
    "logo_vaksina-29e6da5f-d64e-4c35-8ecb-f84e78626896.png",
  ),
];

function findBrowser() {
  const candidates = [
    process.env.EDGE_PATH,
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ].filter(Boolean);
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error("Edge/Chrome topilmadi");
}

function toDataUri(filePath, mime) {
  return `data:${mime};base64,${fs.readFileSync(filePath).toString("base64")}`;
}

function panelHtml(logoUri, qrUri) {
  return `
  <article class="panel">
    <div class="logo"><img src="${logoUri}" alt="VAKSINA MED" /></div>

    <div class="greet">
      <div class="g uz">
        <strong>HURMATLI MIJOZ!</strong>
        <p>Xarid qilishdan oldin quyidagilarni diqqat bilan o‘qing.<br/>Bu sog‘lig‘ingiz va xavfsizligingiz uchun muhim.</p>
      </div>
      <div class="g ru">
        <strong>УВАЖАЕМЫЙ КЛИЕНТ!</strong>
        <p>Перед покупкой внимательно ознакомьтесь с информацией.<br/>Это важно для вашей безопасности.</p>
      </div>
    </div>

    <div class="sec">XARID QILISHDAN OLDIN TEKSHIRING · ПЕРЕД ПОКУПКОЙ ПРОВЕРЬТЕ</div>

    <div class="block">
      <div class="bh"><span>1</span> Tekshirish · Проверка</div>
      <div class="cols">
        <div class="c">
          <em>UZ</em>
          <ul>
            <li>Yaroqlilik muddati va qadoqdagi sanani tekshiring</li>
            <li>Qadoq butun va ochilmaganligiga ishonch hosil qiling</li>
            <li>Dori nomi, dozasi va shaklini tekshiring</li>
            <li>Retsept yoki shifokor tavsiyasiga mosligini solishtiring</li>
          </ul>
        </div>
        <div class="c">
          <em>RU</em>
          <ul>
            <li>Проверьте срок годности и дату на упаковке</li>
            <li>Убедитесь, что упаковка целая и не вскрыта</li>
            <li>Проверьте название, дозировку и форму препарата</li>
            <li>Сверьте с рецептом или рекомендацией врача</li>
          </ul>
        </div>
      </div>
    </div>

    <div class="block">
      <div class="bh"><span>2</span> Maslahat · Консультация</div>
      <div class="cols">
        <div class="c">
          <em>UZ</em>
          <ul>
            <li>Foydalanish tartibi va qarshi ko‘rsatmalarni so‘rang</li>
            <li>Allergiya, homiladorlik yoki surunkali kasallik bo‘lsa — ayting</li>
            <li>Boshqa dorilar bilan birga ichish mumkinligini aniqlang</li>
            <li>Boshqa dori kerak bo‘lsa, faqat farmatsevt maslahati bilan tanlang</li>
            <li>Xarid chekini saqlab qo‘ying</li>
          </ul>
        </div>
        <div class="c">
          <em>RU</em>
          <ul>
            <li>Уточните правила применения и противопоказания</li>
            <li>Сообщите об аллергии, беременности или хронических болезнях</li>
            <li>Уточните совместимость с другими лекарствами</li>
            <li>Другой препарат выбирайте только после консультации с фармацевтом</li>
            <li>Сохраняйте чек о покупке</li>
          </ul>
        </div>
      </div>
    </div>

    <div class="block warn">
      <div class="bh"><span>!</span> DIQQAT! · ВНИМАНИЕ!</div>
      <div class="cols">
        <div class="c">
          <em>UZ</em>
          <p>Dorixonamizdan sotib olingan dori vositalari va tibbiy buyumlar <b>qaytarib olinmaydi</b> va boshqa mahsulotlarga <b>almashtirilmaydi</b>. Xarid amalga oshirilgandan so‘ng mahsulotni qaytarish yoki uni boshqa mahsulotga almashtirish mumkin emas. Iltimos, xarid qilishdan oldin tanlovingizni diqqat bilan tekshiring.</p>
          <div class="tags">
            <span class="tag">Qaytarish mumkin emas</span>
            <span class="tag">Almashtirish mumkin emas</span>
          </div>
        </div>
        <div class="c">
          <em>RU</em>
          <p>Лекарственные средства и медицинские изделия, приобретённые в нашей аптеке, <b>не подлежат возврату</b> и <b>обмену</b> на другие товары. После совершения покупки вернуть товар или обменять его на другой невозможно. Пожалуйста, внимательно проверьте свой выбор до покупки.</p>
          <div class="tags">
            <span class="tag">Возврат невозможен</span>
            <span class="tag">Обмен невозможен</span>
          </div>
        </div>
      </div>
    </div>

    <div class="legal">
      <div class="lt">
        <strong>O‘ZBEKISTON RESPUBLIKASI VAZIRLAR MAHKAMASINING QARORI</strong>
        <p>O‘zbekiston Respublikasi Vazirlar Mahkamasining 2017-yil 6-apreldagi 185-son qarori bilan tasdiqlangan «Dori vositalarini va tibbiy jihozlarni chakana realizatsiya qilish tartibi to‘g‘risidagi nizom».</p>
        <div class="band39">
          <b>39-BAND (amaldagi tahrir)</b>
          «Dorixonalardan realizatsiya qilingan dori vositalari va tibbiy jihozlar qaytarib olinmaydi va shunga o‘xshash dori vositalari va tibbiy jihozlarga almashtirilmaydi.»
        </div>
      </div>
      <div class="qr">
        <img src="${qrUri}" alt="QR" />
        <span>Qaror matni (QR)<small>lex.uz · 39-band</small></span>
      </div>
    </div>

    <div class="foot">
      <div>
        <b>ISHONCHINGIZ UCHUN TASHAKKUR!</b>
        <span>БЛАГОДАРИМ ВАС ЗА ДОВЕРИЕ!</span>
      </div>
      <div class="sign">«Vaksina Med» dorixonalar tarmog‘i</div>
    </div>
  </article>`;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(path.dirname(OUT_PNG_ROOT), { recursive: true });

  const logoPath = LOGO_CANDIDATES.find((p) => p && fs.existsSync(p));
  if (!logoPath) throw new Error("VAKSINA MED logo topilmadi");

  const qrPng = await QRCode.toBuffer(QR_URL, {
    errorCorrectionLevel: "H",
    margin: 1,
    width: 640,
    color: { dark: "#1A0030", light: "#FFFFFF" },
  });
  fs.writeFileSync(path.join(OUT_DIR, "lex-39-qr.png"), qrPng);

  const logoUri = toDataUri(logoPath, "image/png");
  const qrUri = `data:image/png;base64,${qrPng.toString("base64")}`;
  const panel = panelHtml(logoUri, qrUri);

  const html = `<!DOCTYPE html>
<html lang="uz">
<head>
<meta charset="utf-8" />
<title>VAKSINA MED — 2× majburiyat (A4 albom)</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Manrope:wght@600;700;800&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    width: ${W}px; height: ${H}px; overflow: hidden;
    font-family: 'Manrope', 'Segoe UI', Tahoma, sans-serif;
    background: #ddd6e6; color: #1b1226;
    -webkit-font-smoothing: antialiased;
  }
  .sheet {
    width: ${W}px; height: ${H}px;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0;
    position: relative;
    background: #ddd6e6;
  }
  /* Cut line */
  .cut {
    position: absolute; top: 0; bottom: 0; left: 50%;
    width: 0; border-left: 2px dashed rgba(93,0,129,0.45);
    z-index: 5; pointer-events: none;
  }
  .cut-label {
    position: absolute; top: 50%; left: 50%;
    transform: translate(-50%, -50%) rotate(-90deg);
    font-size: 13px; font-weight: 800; letter-spacing: 0.12em;
    color: rgba(93,0,129,0.55); background: #ddd6e6;
    padding: 4px 10px; white-space: nowrap; z-index: 6;
  }

  /* 300 DPI: ~14pt body ≈ 58px, ~16pt heading ≈ 67px — half-page flyer readable */
  .panel {
    margin: 14px;
    height: calc(100% - 28px);
    background: linear-gradient(180deg, #fcfbfd 0%, #f5f0f9 100%);
    border-radius: 18px;
    border: 2.5px solid rgba(93,0,129,0.16);
    padding: 10px 12px 8px;
    display: flex; flex-direction: column; gap: 6px;
    box-shadow: 0 6px 18px rgba(93,0,129,0.08);
    overflow: hidden;
  }

  .logo { display: flex; justify-content: center; flex: 0 0 auto; }
  .logo img { height: 210px; width: auto; object-fit: contain; display: block; }

  .greet {
    display: grid; grid-template-columns: 1fr 1fr; gap: 10px;
    flex: 0 0 auto;
  }
  .g {
    border-radius: 14px; padding: 14px 16px;
  }
  .g.uz {
    background: linear-gradient(145deg, #5D0081, #7a1aa3); color: #fff;
  }
  .g.ru {
    background: #fff; border: 2px solid rgba(93,0,129,0.14); color: #5D0081;
  }
  .g strong {
    display: block; font-size: 46px; font-weight: 800; letter-spacing: 0.02em;
    line-height: 1.05;
  }
  .g.uz strong { color: #FFC107; }
  .g p {
    margin-top: 5px; font-size: 32px; line-height: 1.26; font-weight: 600;
    text-align: justify;
  }
  .g.ru p { color: #3d2d4e; }

  .sec {
    text-align: center;
    font-size: 34px; font-weight: 800; color: #5D0081;
    letter-spacing: 0.02em;
    padding: 0;
    flex: 0 0 auto;
  }

  .block {
    background: #fff;
    border: 2px solid rgba(93,0,129,0.12);
    border-radius: 14px;
    overflow: hidden;
    flex: 1 1 0;
    display: flex; flex-direction: column;
    min-height: 0;
  }
  .block.warn { border-color: #c62828; flex: 1.15 1 0; }
  .bh {
    display: flex; align-items: center; gap: 10px;
    padding: 11px 14px;
    background: linear-gradient(145deg, #5D0081, #7b1fa2);
    color: #fff; font-size: 38px; font-weight: 800;
    flex: 0 0 auto;
  }
  .block.warn .bh { background: linear-gradient(145deg, #b71c1c, #d32f2f); }
  .bh span {
    width: 40px; height: 40px; border-radius: 10px;
    background: rgba(255,255,255,0.2);
    display: flex; align-items: center; justify-content: center;
    font-size: 26px; color: #FFC107; flex-shrink: 0;
  }
  .block.warn .bh span { color: #fff; }

  .cols {
    display: grid; grid-template-columns: 1fr 1fr;
    flex: 1 1 auto;
    min-height: 0;
  }
  .c {
    padding: 12px 14px 12px;
    display: flex; flex-direction: column; gap: 6px;
    justify-content: flex-start;
  }
  .c:first-child { border-right: 1.5px solid rgba(93,0,129,0.10); }
  .c em {
    display: inline-block; font-style: normal;
    font-size: 18px; font-weight: 800; letter-spacing: 0.06em;
    background: #5D0081; color: #FFC107;
    border-radius: 999px; padding: 3px 12px; margin-bottom: 2px;
    align-self: flex-start;
  }
  .block.warn .c em { background: #c62828; color: #fff; }
  .c p {
    font-size: 31px; line-height: 1.26; font-weight: 700;
    text-align: justify; color: #241530;
  }
  .block.warn .c p {
    color: #8e0000; font-weight: 800; font-size: 28px; line-height: 1.28;
    text-align: left;
  }
  .c ul {
    list-style: none; display: flex; flex-direction: column;
    gap: 0; margin-top: 4px; flex: 1;
    justify-content: space-around;
  }
  .c ul li {
    position: relative; padding-left: 26px;
    font-size: 32px; line-height: 1.26; font-weight: 600; color: #2f1f3d;
    text-align: left;
  }
  .c:last-child ul li { color: #4a3a58; }
  .c ul li::before {
    content: ''; position: absolute; left: 0; top: 10px;
    width: 10px; height: 10px; border-radius: 50%;
    background: #FFC107; box-shadow: 0 0 0 3px rgba(93,0,129,0.2);
  }
  .block.warn .c ul li::before { background: #c62828; box-shadow: none; }

  .tags {
    display: flex; flex-wrap: wrap; gap: 8px;
    margin-top: 8px;
  }
  .tag {
    display: inline-block;
    font-size: 26px; font-weight: 800; line-height: 1.2;
    color: #8e0000;
    background: #ffebee;
    border: 1.5px solid #ef9a9a;
    border-radius: 999px;
    padding: 5px 12px;
  }

  .legal {
    display: grid; grid-template-columns: 1fr 190px;
    gap: 12px; align-items: center;
    background: #fff; border-radius: 14px;
    border: 2.5px solid rgba(93,0,129,0.18);
    padding: 12px 14px;
    flex: 0 0 auto;
  }
  .lt strong {
    display: block; font-size: 32px; font-weight: 800; color: #5D0081;
    margin-bottom: 3px; line-height: 1.18;
  }
  .lt > p {
    font-size: 32px; line-height: 1.26; font-weight: 600; color: #2d1b3d;
    text-align: justify; margin-bottom: 5px;
  }
  .band39 {
    background: #f4eef9; border-left: 6px solid #5D0081;
    border-radius: 10px; padding: 7px 9px;
    font-size: 32px; line-height: 1.26; font-weight: 700; color: #3b184f;
    text-align: justify;
  }
  .band39 b {
    display: block; font-size: 32px; font-weight: 800; color: #5D0081; margin-bottom: 2px;
  }
  .qr {
    display: flex; flex-direction: column; align-items: center; gap: 5px;
  }
  .qr img {
    width: 178px; height: 178px; object-fit: contain;
    border: 2.5px solid #5D0081; border-radius: 10px; padding: 5px; background: #fff;
  }
  .qr span {
    text-align: center; font-size: 22px; font-weight: 800; color: #5D0081; line-height: 1.15;
  }
  .qr small { display: block; font-size: 18px; font-weight: 600; color: #7a2a9a; }

  .foot {
    background: linear-gradient(90deg, #5D0081, #6f1196);
    border-radius: 14px; padding: 12px 14px; color: #fff;
    display: flex; justify-content: space-between; align-items: center; gap: 8px;
    flex: 0 0 auto;
  }
  .foot b { display: block; font-size: 32px; font-weight: 800; color: #FFC107; }
  .foot span { display: block; margin-top: 2px; font-size: 30px; font-weight: 700; }
  .sign { text-align: right; font-size: 30px; font-weight: 700; color: #FFC107; }
</style>
</head>
<body>
  <div class="sheet">
    ${panel}
    ${panel}
    <div class="cut"></div>
    <div class="cut-label">✂ KESISH / РЕЗ</div>
  </div>
</body>
</html>`;

  fs.writeFileSync(HTML_PATH, html, "utf8");

  const browser = findBrowser();
  const fileUrl = "file:///" + HTML_PATH.replace(/\\/g, "/");
  const tmpShot = path.join(OUT_DIR, "_edge-shot.png");
  if (fs.existsSync(tmpShot)) fs.unlinkSync(tmpShot);

  const res = spawnSync(
    browser,
    [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      "--force-device-scale-factor=1",
      `--window-size=${W},${H}`,
      "--virtual-time-budget=9000",
      `--screenshot=${tmpShot}`,
      fileUrl,
    ],
    { encoding: "utf8", timeout: 120000, windowsHide: true },
  );
  if (res.error) throw res.error;
  if (!fs.existsSync(tmpShot)) {
    console.error(res.stdout, res.stderr);
    throw new Error("Screenshot yaratilmadi");
  }

  await sharp(tmpShot)
    .resize(W, H, { fit: "cover", position: "top" })
    .png({ compressionLevel: 9 })
    .toFile(OUT_PNG);
  try { fs.copyFileSync(OUT_PNG, OUT_PNG_ROOT); } catch (e) {
    console.warn("PNG root copy:", e.code || e.message);
  }
  try { fs.unlinkSync(tmpShot); } catch {}

  const pngBuf = fs.readFileSync(OUT_PNG);
  const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4", compress: true });
  pdf.addImage(pngBuf, "PNG", 0, 0, 297, 210, undefined, "FAST");
  const pdfBuf = Buffer.from(pdf.output("arraybuffer"));
  fs.writeFileSync(OUT_PDF, pdfBuf);
  try {
    fs.copyFileSync(OUT_PDF, OUT_PDF_ROOT);
  } catch (e) {
    const alt = OUT_PDF_ROOT.replace(/\.pdf$/i, "-new.pdf");
    fs.writeFileSync(alt, pdfBuf);
    console.warn("PDF root locked; wrote", alt);
  }

  const meta = await sharp(OUT_PNG).metadata();
  console.log(JSON.stringify({
    outPng: OUT_PNG,
    outPdf: OUT_PDF,
    width: meta.width,
    height: meta.height,
    layout: "A4 landscape · 2 majburiyat (yarim-yarim kesish)",
    pngKB: Math.round(fs.statSync(OUT_PNG).size / 1024),
    pdfKB: Math.round(fs.statSync(OUT_PDF).size / 1024),
  }, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
