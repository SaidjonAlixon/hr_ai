import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, MapPin } from "lucide-react";

const STORAGE_KEY = "davomat-coach-arrows-v2";
const MAX_VISITS = 3;

type CoachPhase = "gps" | "scroll" | "methods" | "hidden";

type Props = {
  enabled: boolean;
  needsGps?: boolean;
  gpsDenied?: boolean;
  showMethods?: boolean;
  onEnableGps?: () => void;
};

type Anchor = { top: number; left: number };

type Store = { visits: number };

function readStore(): Store {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { visits: 0 };
    const parsed = JSON.parse(raw) as Partial<Store>;
    return { visits: Math.max(0, Number(parsed.visits) || 0) };
  } catch {
    return { visits: 0 };
  }
}

function writeStore(store: Store) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    /* ignore */
  }
}

function visitsLeft(): number {
  return Math.max(0, MAX_VISITS - readStore().visits);
}

function bumpVisitOnce(flag: { current: boolean }) {
  if (flag.current) return;
  flag.current = true;
  const s = readStore();
  if (s.visits >= MAX_VISITS) return;
  writeStore({ visits: s.visits + 1 });
}

function clamp(n: number, min: number, max: number) {
  return Math.min(Math.max(n, min), max);
}

function isInView(el: HTMLElement) {
  const rect = el.getBoundingClientRect();
  const vh = window.innerHeight || 1;
  return rect.top < vh * 0.78 && rect.bottom > vh * 0.15;
}

export function DavomatCoachFinger({
  enabled,
  needsGps = false,
  gpsDenied = false,
  showMethods = true,
  onEnableGps,
}: Props) {
  const [sessionDone, setSessionDone] = useState(false);
  const [phase, setPhase] = useState<CoachPhase>("hidden");
  const [faceAnchor, setFaceAnchor] = useState<Anchor | null>(null);
  const [qrAnchor, setQrAnchor] = useState<Anchor | null>(null);
  const [gpsAnchor, setGpsAnchor] = useState<Anchor | null>(null);
  const visitCounted = useRef(false);
  const allowed = useRef(false);
  const sawScrollHint = useRef(false);

  const finishSession = useCallback(() => {
    setSessionDone(true);
    setPhase("hidden");
  }, []);

  useEffect(() => {
    if (!enabled) {
      allowed.current = false;
      return;
    }
    if (visitsLeft() <= 0) {
      allowed.current = false;
      setSessionDone(true);
      return;
    }
    allowed.current = true;
    bumpVisitOnce(visitCounted);
  }, [enabled]);

  const updatePhase = useCallback(() => {
    if (!enabled || sessionDone || !allowed.current) {
      setPhase("hidden");
      return;
    }

    const gpsEl = document.getElementById("dv-coach-gps");
    const methodsEl = document.getElementById("dv-coach-methods");
    const faceEl = document.getElementById("dv-coach-face");
    const qrEl = document.getElementById("dv-coach-qr");
    const vh = window.innerHeight || 1;
    const vw = window.innerWidth || 360;

    // 1) Avval lokatsiya ruxsati
    if (needsGps && gpsEl) {
      if (!isInView(gpsEl)) {
        sawScrollHint.current = true;
        setPhase("gps");
        setGpsAnchor(null);
        setFaceAnchor(null);
        setQrAnchor(null);
        return;
      }
      const g = gpsEl.getBoundingClientRect();
      setPhase("gps");
      setGpsAnchor({
        top: clamp(g.top - 40, 56, vh - 110),
        left: clamp(g.left + g.width / 2, 40, vw - 40),
      });
      setFaceAnchor(null);
      setQrAnchor(null);
      return;
    }

    const target = showMethods && methodsEl ? methodsEl : null;
    if (!target) {
      setPhase("hidden");
      return;
    }

    if (!isInView(target)) {
      sawScrollHint.current = true;
      setPhase("scroll");
      setFaceAnchor(null);
      setQrAnchor(null);
      setGpsAnchor(null);
      return;
    }

    // «Pasga bosing» dan keyin pastga tushsa — shu bosqich tugaydi / yo‘qoladi
    if (sawScrollHint.current) {
      finishSession();
      return;
    }

    setPhase("methods");
    setGpsAnchor(null);
    if (faceEl) {
      const f = faceEl.getBoundingClientRect();
      setFaceAnchor({
        top: clamp(f.top - 42, 48, vh - 90),
        left: clamp(f.left + f.width / 2, 36, vw - 36),
      });
    } else setFaceAnchor(null);

    if (qrEl) {
      const q = qrEl.getBoundingClientRect();
      setQrAnchor({
        top: clamp(q.top - 42, 48, vh - 90),
        left: clamp(q.left + q.width / 2, 36, vw - 36),
      });
    } else setQrAnchor(null);
  }, [enabled, finishSession, needsGps, sessionDone, showMethods]);

  useEffect(() => {
    if (!enabled || sessionDone) return;
    updatePhase();
    const onScroll = () => updatePhase();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    const id = window.setInterval(updatePhase, 500);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      window.clearInterval(id);
    };
  }, [enabled, sessionDone, updatePhase]);

  useEffect(() => {
    if (!enabled) return;
    const onPick = () => finishSession();
    window.addEventListener("davomat-coach-done", onPick);
    return () => window.removeEventListener("davomat-coach-done", onPick);
  }, [enabled, finishSession]);

  if (!enabled || sessionDone || phase === "hidden") return null;

  const scrollToGps = () => {
    document.getElementById("dv-coach-gps")?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  };

  const scrollToMethods = () => {
    document.getElementById("dv-coach-methods")?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  };

  const askGps = () => {
    scrollToGps();
    onEnableGps?.();
  };

  return (
    <div className="dv-coach-root pointer-events-none" aria-live="polite">
      {phase === "gps" ? (
        <>
          <div className="dv-coach-scroll pointer-events-auto">
            <div className="dv-coach-bubble dv-coach-bubble-gps">
              <p className="dv-coach-bubble-kicker">
                <MapPin className="h-3.5 w-3.5" />
                1-qadam
              </p>
              <p className="dv-coach-bubble-title">
                {gpsDenied ? "Joylashuvga ruxsat bering" : "Avval joylashuvni yoqing"}
              </p>
              <p className="dv-coach-bubble-sub">
                {gpsDenied
                  ? "Sozlamadan lokatsiyaga ruxsat bering, keyin «Yoqing» ni bosing"
                  : "Davomat ishlashi uchun avval lokatsiyaga ruxsat bering"}
              </p>
              <button type="button" className="dv-coach-primary" onClick={askGps}>
                {gpsDenied ? "Ruxsat / Yoqing" : "Joylashuvni yoqing"}
              </button>
            </div>
            {!gpsAnchor ? (
              <button type="button" className="dv-coach-scroll-arrows" onClick={scrollToGps}>
                <ChevronDown className="dv-coach-chevron dv-coach-chevron-1" />
                <ChevronDown className="dv-coach-chevron dv-coach-chevron-2" />
                <ChevronDown className="dv-coach-chevron dv-coach-chevron-3" />
                <span className="dv-coach-mini">Pasga — «Yoqing»</span>
              </button>
            ) : null}
          </div>
          {gpsAnchor ? (
            <div
              className="dv-coach-arrow-pin"
              style={{ top: gpsAnchor.top, left: gpsAnchor.left }}
            >
              <div className="dv-coach-arrow-down dv-coach-arrow-gps" aria-hidden>
                <ChevronDown className="dv-coach-arrow-icon" />
              </div>
              <p className="dv-coach-arrow-label">Yoqing</p>
            </div>
          ) : null}
        </>
      ) : null}

      {phase === "scroll" ? (
        <button
          type="button"
          className="dv-coach-scroll pointer-events-auto"
          onClick={scrollToMethods}
        >
          <div className="dv-coach-bubble dv-coach-bubble-strong">
            <p className="dv-coach-bubble-title">Pasga bosing</p>
            <p className="dv-coach-bubble-sub">
              Face ID va QR skaner pastroqda — bosing yoki pastga aylantiring
            </p>
          </div>
          <div className="dv-coach-scroll-arrows" aria-hidden>
            <ChevronDown className="dv-coach-chevron dv-coach-chevron-1" />
            <ChevronDown className="dv-coach-chevron dv-coach-chevron-2" />
            <ChevronDown className="dv-coach-chevron dv-coach-chevron-3" />
          </div>
        </button>
      ) : null}

      {phase === "methods" ? (
        <>
          {faceAnchor ? (
            <div
              className="dv-coach-arrow-pin"
              style={{ top: faceAnchor.top, left: faceAnchor.left }}
            >
              <div className="dv-coach-arrow-down dv-coach-arrow-face" aria-hidden>
                <ChevronDown className="dv-coach-arrow-icon" />
              </div>
              <p className="dv-coach-arrow-label">Face ID</p>
            </div>
          ) : null}
          {qrAnchor ? (
            <div
              className="dv-coach-arrow-pin"
              style={{ top: qrAnchor.top, left: qrAnchor.left }}
            >
              <div className="dv-coach-arrow-down dv-coach-arrow-qr" aria-hidden>
                <ChevronDown className="dv-coach-arrow-icon" />
              </div>
              <p className="dv-coach-arrow-label">QR Scanner</p>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

/** Face ID / QR tanlanganda — shu sessiyada o‘rgatuvchi yo‘qoladi */
export function signalDavomatCoachDone() {
  try {
    window.dispatchEvent(new Event("davomat-coach-done"));
  } catch {
    /* ignore */
  }
}
