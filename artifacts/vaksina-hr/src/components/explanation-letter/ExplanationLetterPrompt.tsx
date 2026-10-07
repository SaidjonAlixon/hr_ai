import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { useQueryClient } from "@tanstack/react-query";
import { useMyLetters, type ExplanationLetter } from "@/lib/explanation-letters-api";
import { EXPLANATION_REQUIRED_EVENT } from "@/lib/davomat-api";
import { ExplanationLetterDialog } from "./ExplanationLetterDialog";

const SNOOZE_KEY = "vaksina-tx-snooze";
const SNOOZE_MS = 30 * 60_000;

function snoozedUntil() {
  return Number(sessionStorage.getItem(SNOOZE_KEY) || 0);
}

/**
 * Imzolanmagan tushuntirish xati o‘zi ochiladi. «Keldim» xat sababli rad etilsa —
 * kechiktirish (snooze) va jim sahifalardan qat’i nazar darhol ochiladi.
 */
export function ExplanationLetterPrompt() {
  const { user } = useAuth();
  const [location] = useLocation();
  const watched = !!user;
  const my = useMyLetters(watched);
  const qc = useQueryClient();
  const [now, setNow] = useState(() => Date.now());
  const [openId, setOpenId] = useState<number | null>(null);

  const { refetch } = my;
  useEffect(() => {
    if (!watched) return;
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        setNow(Date.now());
        void refetch();
      }
    };
    const onRequired = (e: Event) => {
      const id = Number((e as CustomEvent<{ letterId?: number }>).detail?.letterId);
      void refetch().then((r) => {
        if (!r.data?.items.some((l) => l.id === id)) return;
        sessionStorage.removeItem(SNOOZE_KEY);
        setOpenId(id);
      });
    };
    const tick = window.setInterval(() => setNow(Date.now()), 60_000);
    window.addEventListener("focus", onVisible);
    window.addEventListener(EXPLANATION_REQUIRED_EVENT, onRequired);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(tick);
      window.removeEventListener("focus", onVisible);
      window.removeEventListener(EXPLANATION_REQUIRED_EVENT, onRequired);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [watched, refetch]);

  const next = useMemo(() => {
    if (my.data?.enabled === false) return null;
    const open = (my.data?.items ?? []).filter((l) => l.status !== "signed" && l.reviewStatus !== "cancelled");
    return open.length ? open[open.length - 1]! : null;
  }, [my.data]);

  const quietPage =
    location.startsWith("/oylik") ||
    location.startsWith("/tx/") ||
    location.startsWith("/login") ||
    location.startsWith("/admin/tushuntirish-xatlari") ||
    location.startsWith("/tushuntirish-xatim") ||
    location.startsWith("/admin/test");

  useEffect(() => {
    if (openId != null || !next || quietPage || snoozedUntil() > now) return;
    setOpenId(next.id);
  }, [next, quietPage, now, openId]);

  if (!watched) return null;

  const snooze = () => {
    sessionStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_MS));
    setOpenId(null);
  };

  return (
    <ExplanationLetterDialog
      letterId={openId}
      mode="employee"
      onSnooze={snooze}
      onClose={() => {
        const current = qc.getQueryData<ExplanationLetter>(["explanation-letters", "one", openId]);
        if (current?.status !== "signed") sessionStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_MS));
        setOpenId(null);
      }}
    />
  );
}
