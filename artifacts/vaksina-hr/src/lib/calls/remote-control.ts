/**
 * Masofaviy boshqaruv: admin yuborgan buyruqlar xodim qurilmasida (faqat VAKSINA HR ilovasi ichida) bajariladi.
 * Koordinatalar 0..1 oralig‘ida — ko‘rinib turgan oynaga nisbatan.
 * Jonli nusxada (DOM mirror) admin bosgan element `id` bilan keladi: nusxa admin brauzerida boshqa shrift,
 * safe-area va scrollbar bilan chiziladi, shuning uchun koordinata emas — aynan o‘sha element bosiladi.
 */
export type NodeTarget = { id?: number; rx?: number; ry?: number };

export type ControlEvent =
  | ({ e: "move"; x: number; y: number } & NodeTarget)
  | ({ e: "tap"; x: number; y: number } & NodeTarget)
  | ({ e: "scroll"; x: number; y: number; dx: number; dy: number } & NodeTarget)
  | { e: "text"; value: string }
  | { e: "key"; key: "Enter" | "Backspace" | "Tab" | "Escape" }
  | { e: "nav"; to: "back" | "forward" | "home" };

function clamp01(n: unknown): number {
  const v = Number(n);
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
}

let resolveNode: ((id: number) => Node | null) | null = null;

/** Jonli nusxa yozuvchisi ishlayotganda rrweb id → haqiqiy DOM tugun */
export function setMirrorNodeResolver(fn: ((id: number) => Node | null) | null) {
  resolveNode = fn;
}

/** Element bo‘yicha nishon: elementning shu nisbiy nuqtasi (ko‘rinmasa — ko‘rinadigan qilib) */
function nodePoint(ev: NodeTarget, reveal = false): { cx: number; cy: number; el: Element } | null {
  const id = Number(ev.id);
  if (!resolveNode || !Number.isInteger(id) || id <= 0) return null;
  const node = resolveNode(id);
  const el = node instanceof Element ? node : (node?.parentElement ?? null);
  if (!el || !el.isConnected || el.closest("[data-call-ui]")) return null;
  let r = el.getBoundingClientRect();
  if (!r.width && !r.height) return null;
  const W = window.innerWidth;
  const H = window.innerHeight;
  if (r.bottom < 0 || r.top > H || r.right < 0 || r.left > W) {
    if (!reveal) return null;
    el.scrollIntoView({ block: "nearest", inline: "nearest" });
    r = el.getBoundingClientRect();
  }
  const cx = Math.min(W - 1, Math.max(0, r.left + clamp01(ev.rx ?? 0.5) * r.width));
  const cy = Math.min(H - 1, Math.max(0, r.top + clamp01(ev.ry ?? 0.5) * r.height));
  return { cx, cy, el };
}

function elementAt(cx: number, cy: number): Element | null {
  for (const el of document.elementsFromPoint(cx, cy)) {
    if (!el.closest("[data-call-ui]")) return el;
  }
  return null;
}

/** Admin kursori xodim ekranida — kim nimani ko‘rsatayotgani ko‘rinib tursin */
let cursorEl: HTMLDivElement | null = null;

function showCursor(cx: number, cy: number) {
  if (!cursorEl || !cursorEl.isConnected) {
    cursorEl = document.createElement("div");
    cursorEl.setAttribute("data-call-ui", "");
    // Jonli nusxada bloklangan element faqat klassi bilan qoladi — oqimdan tashqarida tursin
    cursorEl.className = "call-ui fixed pointer-events-none";
    cursorEl.style.cssText =
      "position:fixed;left:0;top:0;pointer-events:none;z-index:2147483647;will-change:transform;transition:transform 60ms linear";
    cursorEl.innerHTML = `<svg width="26" height="26" viewBox="0 0 24 24" style="display:block;filter:drop-shadow(0 1px 2px rgba(0,0,0,.45))">
      <path d="M4 2.5l15.5 9.2-6.9 1.5-3.3 6.4L4 2.5z" fill="#2563eb" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>
      <span style="position:absolute;left:20px;top:20px;white-space:nowrap;border-radius:9999px;background:#2563eb;color:#fff;
      font:600 11px/1 system-ui,sans-serif;padding:3px 7px;box-shadow:0 1px 3px rgba(0,0,0,.3)">Admin</span>`;
    document.body.appendChild(cursorEl);
  }
  cursorEl.style.transform = `translate(${Math.round(cx - 3)}px, ${Math.round(cy - 2)}px)`;
}

export function hideRemoteCursor() {
  cursorEl?.remove();
  cursorEl = null;
}

function ripple(cx: number, cy: number) {
  const dot = document.createElement("div");
  dot.setAttribute("data-call-ui", "");
  dot.className = "call-ui fixed pointer-events-none";
  dot.style.cssText = `position:fixed;left:${cx - 18}px;top:${cy - 18}px;width:36px;height:36px;border-radius:9999px;
    background:rgba(59,130,246,.35);border:2px solid rgba(59,130,246,.9);pointer-events:none;z-index:2147483646;
    transform:scale(.4);opacity:1;transition:transform .45s ease-out,opacity .45s ease-out`;
  document.body.appendChild(dot);
  requestAnimationFrame(() => {
    dot.style.transform = "scale(1.4)";
    dot.style.opacity = "0";
  });
  setTimeout(() => dot.remove(), 500);
}

function isEditable(el: Element | null): el is HTMLInputElement | HTMLTextAreaElement | HTMLElement {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement) return !el.disabled && !el.readOnly;
  if (el instanceof HTMLInputElement) {
    const t = el.type;
    return !el.disabled && !el.readOnly && !["checkbox", "radio", "button", "submit", "reset", "file", "range", "color"].includes(t);
  }
  return el instanceof HTMLElement && el.isContentEditable;
}

function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  setter ? setter.call(el, value) : (el.value = value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function scrollableAncestor(el: Element | null, dy: number, dx: number): Element | Window {
  let cur: Element | null = el;
  while (cur && cur !== document.body && cur !== document.documentElement) {
    const s = getComputedStyle(cur);
    const canY = /(auto|scroll|overlay)/.test(s.overflowY) && cur.scrollHeight > cur.clientHeight + 1;
    const canX = /(auto|scroll|overlay)/.test(s.overflowX) && cur.scrollWidth > cur.clientWidth + 1;
    if ((dy !== 0 && canY) || (dx !== 0 && canX)) return cur;
    cur = cur.parentElement;
  }
  return window;
}

function tap(cx: number, cy: number, target?: Element) {
  const hit = elementAt(cx, cy);
  // Nuqtadagi element nishonning ichida bo‘lsa — o‘shani (eng ichki), aks holda nishonning o‘zini bosamiz
  const el = target ? (hit && target.contains(hit) ? hit : target) : hit;
  ripple(cx, cy);
  if (!el) return;
  const base = { bubbles: true, cancelable: true, composed: true, clientX: cx, clientY: cy, view: window };
  const pointer = { ...base, pointerId: 1, pointerType: "touch", isPrimary: true, button: 0, buttons: 1 };
  el.dispatchEvent(new PointerEvent("pointerover", pointer));
  el.dispatchEvent(new PointerEvent("pointerdown", pointer));
  el.dispatchEvent(new MouseEvent("mousedown", { ...base, button: 0, buttons: 1 }));
  const focusable = (el.closest("input,textarea,select,button,a,[tabindex],[contenteditable='true']") as HTMLElement | null) ?? null;
  focusable?.focus({ preventScroll: true });
  el.dispatchEvent(new PointerEvent("pointerup", { ...pointer, buttons: 0 }));
  el.dispatchEvent(new MouseEvent("mouseup", { ...base, button: 0, buttons: 0 }));
  if (el instanceof HTMLElement && typeof el.click === "function") el.click();
  else el.dispatchEvent(new MouseEvent("click", { ...base, button: 0 }));
}

function typeText(value: string) {
  const el = document.activeElement;
  if (!isEditable(el)) return;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const next = el.value.slice(0, start) + value + el.value.slice(end);
    setNativeValue(el, next);
    try {
      el.setSelectionRange(start + value.length, start + value.length);
    } catch {
      /* email/number inputlarda selection yo‘q */
    }
  } else {
    document.execCommand("insertText", false, value);
  }
}

function pressKey(key: "Enter" | "Backspace" | "Tab" | "Escape") {
  const el = (document.activeElement as HTMLElement | null) ?? document.body;
  const init = { key, code: key, bubbles: true, cancelable: true };
  const proceed = el.dispatchEvent(new KeyboardEvent("keydown", init));
  if (proceed) {
    if (key === "Backspace" && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) && isEditable(el)) {
      const start = el.selectionStart ?? el.value.length;
      const end = el.selectionEnd ?? el.value.length;
      const from = start === end ? Math.max(0, start - 1) : start;
      setNativeValue(el, el.value.slice(0, from) + el.value.slice(end));
      try {
        el.setSelectionRange(from, from);
      } catch {
        /* ignore */
      }
    } else if (key === "Enter" && el instanceof HTMLInputElement) {
      el.form?.requestSubmit?.();
    } else if (key === "Tab") {
      const items = Array.from(
        document.querySelectorAll<HTMLElement>("input,textarea,select,button,a[href],[tabindex]:not([tabindex='-1'])"),
      ).filter((n) => !n.closest("[data-call-ui]") && n.offsetParent !== null);
      const i = items.indexOf(el);
      items[(i + 1) % Math.max(1, items.length)]?.focus();
    } else if (key === "Escape") {
      el.blur?.();
    }
  }
  el.dispatchEvent(new KeyboardEvent("keyup", init));
}

export function applyControl(raw: unknown) {
  if (!raw || typeof raw !== "object") return;
  const ev = raw as ControlEvent;
  const W = window.innerWidth;
  const H = window.innerHeight;
  switch (ev.e) {
    case "move": {
      const p = nodePoint(ev);
      showCursor(p?.cx ?? clamp01(ev.x) * W, p?.cy ?? clamp01(ev.y) * H);
      break;
    }
    case "tap": {
      const p = nodePoint(ev, true);
      const cx = p?.cx ?? clamp01(ev.x) * W;
      const cy = p?.cy ?? clamp01(ev.y) * H;
      showCursor(cx, cy);
      tap(cx, cy, p?.el);
      break;
    }
    case "scroll": {
      const p = nodePoint(ev);
      const cx = p?.cx ?? clamp01(ev.x) * W;
      const cy = p?.cy ?? clamp01(ev.y) * H;
      const dy = Math.max(-2, Math.min(2, Number(ev.dy) || 0)) * H;
      const dx = Math.max(-2, Math.min(2, Number(ev.dx) || 0)) * W;
      const target = scrollableAncestor(p?.el ?? elementAt(cx, cy), dy, dx);
      target.scrollBy({ top: dy, left: dx, behavior: "auto" });
      break;
    }
    case "text":
      if (typeof ev.value === "string") typeText(ev.value.slice(0, 500));
      break;
    case "key":
      if (["Enter", "Backspace", "Tab", "Escape"].includes(ev.key)) pressKey(ev.key);
      break;
    case "nav":
      if (ev.to === "back") history.back();
      else if (ev.to === "forward") history.forward();
      else if (ev.to === "home") {
        history.pushState(null, "", "/");
        window.dispatchEvent(new PopStateEvent("popstate"));
      }
      break;
  }
}
