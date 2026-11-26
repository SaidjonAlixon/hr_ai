/** Open API to‘liq qo‘llanma — alohida Word (.doc) UZ yoki RU */

import { buildFullDocHtml, type DocLangSingle } from "./open-api-docs-content";

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

function triggerDownload(html: string, filename: string) {
  const blob = new Blob(["\ufeff", html], { type: "application/msword;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function downloadOpenApiWordDoc(origin = window.location.origin, lang: DocLangSingle = "uz") {
  const generatedAt = new Date().toLocaleString(lang === "ru" ? "ru-RU" : "uz-UZ", {
    timeZone: "Asia/Tashkent",
  });
  const html = buildFullDocHtml({ origin, generatedAt, lang });
  const tag = lang === "ru" ? "RU" : "UZ";
  triggerDownload(html, `VAKSINA_Open_API_${tag}_${stamp()}.doc`);
}

/** Ikkala tilni ketma-ket yuklab olish */
export function downloadOpenApiWordDocsAll(origin = window.location.origin) {
  downloadOpenApiWordDoc(origin, "uz");
  window.setTimeout(() => downloadOpenApiWordDoc(origin, "ru"), 400);
}
