/** Task description rich-text helpers (safe subset of HTML). */

const ALLOWED_TAGS = new Set([
  "B",
  "STRONG",
  "I",
  "EM",
  "U",
  "S",
  "STRIKE",
  "BR",
  "DIV",
  "P",
  "UL",
  "OL",
  "LI",
  "A",
  "CODE",
  "SPAN",
]);

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Plain text → editor HTML (newlines → <br>). */
export function plainDescToHtml(text: string): string {
  if (!text) return "";
  return escapeHtml(text).replace(/\r\n|\r|\n/g, "<br>");
}

/** Detect stored HTML vs legacy plain/markdown. */
export function looksLikeDescHtml(value: string): boolean {
  return /<\/?(?:b|strong|i|em|u|ul|ol|li|a|code|p|div|br|span)\b/i.test(value);
}

export function htmlDescToPlain(html: string): string {
  if (!html) return "";
  if (typeof document === "undefined") {
    return html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<\/li>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .trim();
  }
  const el = document.createElement("div");
  el.innerHTML = html;
  return (el.innerText || el.textContent || "").replace(/\u00a0/g, " ").trim();
}

/** Strip scripts/styles and unknown tags; keep formatting subset. */
export function sanitizeDescHtml(raw: string): string {
  if (!raw || typeof document === "undefined") return raw || "";
  const doc = new DOMParser().parseFromString(`<div>${raw}</div>`, "text/html");
  const root = doc.body.firstElementChild;
  if (!root) return "";

  const walk = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) {
      return escapeHtml(node.textContent || "");
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    const el = node as HTMLElement;
    const tag = el.tagName.toUpperCase();

    if (tag === "SCRIPT" || tag === "STYLE" || tag === "IFRAME") return "";

    if (!ALLOWED_TAGS.has(tag)) {
      return Array.from(el.childNodes).map(walk).join("");
    }

    if (tag === "BR") return "<br>";

    const inner = Array.from(el.childNodes).map(walk).join("");

    if (tag === "A") {
      let href = el.getAttribute("href") || "";
      if (!/^https?:\/\//i.test(href) && !href.startsWith("mailto:")) {
        href = "";
      }
      const safe = escapeHtml(href);
      return safe ? `<a href="${safe}" target="_blank" rel="noopener noreferrer">${inner || safe}</a>` : inner;
    }

    if (tag === "CODE") return `<code>${inner}</code>`;
    if (tag === "STRONG" || tag === "B") return `<b>${inner}</b>`;
    if (tag === "EM" || tag === "I") return `<i>${inner}</i>`;
    if (tag === "U") return `<u>${inner}</u>`;
    if (tag === "UL") return `<ul>${inner}</ul>`;
    if (tag === "OL") return `<ol>${inner}</ol>`;
    if (tag === "LI") return `<li>${inner}</li>`;
    if (tag === "P" || tag === "DIV") {
      return inner ? `${inner}<br>` : "<br>";
    }
    return inner;
  };

  let out = Array.from(root.childNodes).map(walk).join("");
  out = out.replace(/(?:<br>\s*)+$/i, "").trim();
  return out;
}

export function descToEditorHtml(value: string): string {
  if (!value) return "";
  if (looksLikeDescHtml(value)) return sanitizeDescHtml(value);
  return plainDescToHtml(value);
}

export function clampDescHtml(html: string, maxPlain: number): string {
  const plain = htmlDescToPlain(html);
  if (plain.length <= maxPlain) return sanitizeDescHtml(html);
  // Truncate by rebuilding from plain (formatting lost at edge — acceptable)
  return plainDescToHtml(plain.slice(0, maxPlain));
}
