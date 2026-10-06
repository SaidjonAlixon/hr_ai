import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useAuth } from "@/contexts/AuthContext";

const DISCIPLINE_ROLES = new Set(["mudir", "farmasevt", "stajyor", "stajor"]);
const FALLBACK_MESSAGE = "Sizga bugun tizimga kirishga ruxsat yo‘q. Admin va HR lar bilan bog‘laning";

/** 5-marta va undan keyingi jarima kuni — butun platforma qotadi, faqat qizil yozuv qoladi */
export function DisciplineLockOverlay() {
  const { user } = useAuth();
  const watched = !!user && DISCIPLINE_ROLES.has(String(user.role || "").toLowerCase());
  const [message, setMessage] = useState<string | null>(null);

  const check = useCallback(async () => {
    try {
      const res = await fetch("/api/discipline/my-lock", { credentials: "include", cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { locked: boolean; message?: string };
      setMessage(data.locked ? data.message || FALLBACK_MESSAGE : null);
    } catch {
      /* tarmoq xatosi — joriy holat saqlanadi */
    }
  }, []);

  useEffect(() => {
    if (!watched) {
      setMessage(null);
      return;
    }
    void check();
    const onLocked = (ev: Event) => {
      setMessage((ev as CustomEvent<{ message?: string }>).detail?.message || FALLBACK_MESSAGE);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    window.addEventListener("vaksina-discipline-lock", onLocked);
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("vaksina-discipline-lock", onLocked);
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [watched, check]);

  useEffect(() => {
    if (!watched) return;
    const id = window.setInterval(() => void check(), message ? 30_000 : 60_000);
    return () => window.clearInterval(id);
  }, [watched, message, check]);

  useEffect(() => {
    if (!message) return;
    const root = document.getElementById("root");
    root?.setAttribute("inert", "");
    root?.setAttribute("aria-hidden", "true");
    (document.activeElement as HTMLElement | null)?.blur?.();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const block = (e: Event) => {
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    const events = ["keydown", "keypress", "keyup", "paste", "contextmenu", "wheel", "touchmove"] as const;
    for (const t of events) window.addEventListener(t, block, { capture: true, passive: false });
    return () => {
      root?.removeAttribute("inert");
      root?.removeAttribute("aria-hidden");
      document.body.style.overflow = prevOverflow;
      for (const t of events) window.removeEventListener(t, block, { capture: true });
    };
  }, [message]);

  if (!message) return null;

  return createPortal(
    <div
      role="alertdialog"
      aria-live="assertive"
      className="fixed inset-0 z-[2147483647] flex select-none items-center justify-center bg-black px-6"
      onMouseDown={(e) => e.preventDefault()}
    >
      <style>{`@keyframes vaksina-lock-blink{0%,45%{opacity:1}55%,100%{opacity:.08}}`}</style>
      <div className="max-w-3xl text-center">
        <p
          className="text-3xl font-extrabold leading-tight text-red-600 sm:text-5xl"
          style={{ animation: "vaksina-lock-blink 1.1s steps(1, end) infinite", textShadow: "0 0 24px rgba(220,38,38,.65)" }}
        >
          {message}
        </p>
      </div>
    </div>,
    document.body,
  );
}
