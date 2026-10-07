import { useId, useRef, useState, type CSSProperties, type ReactNode, type SyntheticEvent } from "react";
import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { userRoleLabel, verifiedTier, type VerifiedTier } from "@/lib/roles";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import {
  PRO_CRITERIA,
  PRO_DESCRIPTION,
  PRO_META,
  PRO_TIER_TEXT,
  TITLE_META,
  isEmployeeTitle,
  isProTier,
  useTitleMap,
  type EmployeeTitle,
  type TitleMap,
} from "@/lib/user-titles";

export type BadgeKind = { type: "pro"; tier: VerifiedTier } | { type: "title"; title: EmployeeTitle };

/** Rahbar — PRO (admin o‘chirmagan bo‘lsa); boshqalar — admin bergan unvon. */
export function resolveBadgeKind(
  role: string | null | undefined,
  userId: number | null | undefined,
  map: TitleMap,
): BadgeKind | null {
  const entry = userId ? map[userId] : undefined;
  const tier = isProTier(entry?.proTier) ? entry.proTier : verifiedTier(role);
  if (tier && !entry?.proHidden) return { type: "pro", tier };
  if (entry && isEmployeeTitle(entry.title)) return { type: "title", title: entry.title };
  return null;
}

const SIZES = { xs: 15, sm: 17, md: 19, lg: 23, xl: 28 } as const;
export type VerifiedBadgeSize = keyof typeof SIZES;

const stops = (colors: string[]) =>
  colors.map((c, i) => <stop key={i} offset={i / (colors.length - 1)} stopColor={c} />);

const SPARKLE_PATH =
  "M0 -2.6 C0.35 -0.75 0.75 -0.35 2.6 0 C0.75 0.35 0.35 0.75 0 2.6 C-0.35 0.75 -0.75 0.35 -2.6 0 C-0.75 -0.35 -0.35 -0.75 0 -2.6Z";

const CROWN = "M5.6 4.6 L7.2 -0.9 L10 2.1 L12 -2.6 L14 2.1 L16.8 -0.9 L18.4 4.6 Z";

function Sparkle({ x, y, dur = "1.8s" }: { x: number; y: number; dur?: string }) {
  return (
    <path d={SPARKLE_PATH} fill="#fff" transform={`translate(${x} ${y})`}>
      <animate attributeName="opacity" values="0;1;0" dur={dur} repeatCount="indefinite" />
      <animateTransform attributeName="transform" type="scale" values="0.35;1;0.35" dur={dur} additive="sum" repeatCount="indefinite" />
    </path>
  );
}

/* ───────────────────────── Rahbarlar: PRO (dumaloq) ───────────────────────── */

type LeaderStyle = { fill: string[]; ring: string[]; core: string; glow: string; innerRing?: string; crown?: boolean };

const LEADER: Record<VerifiedTier, LeaderStyle> = {
  founder: {
    fill: ["#FFF3B0", "#FFC83D", "#F08A00", "#B85500"],
    ring: ["#FFFBE0", "#FFB800", "#FF6B3D", "#FFFBE0"],
    core: "#5A2A00",
    glow: "rgba(255,170,0,0.6)",
    crown: true,
  },
  director: {
    fill: ["#D6B4FF", "#9B4DFF", "#5B21E6", "#2A0F8F"],
    ring: ["#FFF1B8", "#F5C542", "#B8860B", "#FFF1B8"],
    core: "#1E0A5E",
    glow: "rgba(140,70,255,0.55)",
    innerRing: "#F5C542",
  },
  hr: {
    fill: ["#9DFFDA", "#2EE6A6", "#0FA876", "#06705A"],
    ring: ["#E6FFF6", "#5BFFD0", "#00B3A4", "#E6FFF6"],
    core: "#033D33",
    glow: "rgba(20,200,140,0.55)",
  },
  lead: {
    fill: ["#21E6FF", "#2F7BFF", "#7A3CFF", "#E040FB"],
    ring: ["#FFE66D", "#FF5FA2", "#6DF7FF", "#FFE66D"],
    core: "#1B1464",
    glow: "rgba(80,90,255,0.55)",
  },
  master: {
    fill: ["#3F3F46", "#18181B", "#09090B", "#000000"],
    ring: ["#FFF7CC", "#F5C542", "#A86A04", "#FFE79A", "#B8860B", "#FFF7CC"],
    core: "#000000",
    glow: "rgba(234,179,8,0.6)",
  },
};

const LEADER_CHECK = "M7.4 12.3l3.05 3.05 6.15-6.3";

function hexPath(r: number, cy = 12): string {
  const pts = Array.from({ length: 6 }, (_, i) => {
    const a = -Math.PI / 2 + (i * Math.PI) / 3;
    return `${(12 + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`;
  });
  return `M${pts.join("L")}Z`;
}

const HEX_OUTER = hexPath(10.9);
const HEX_BODY = hexPath(9.35);
const HEX_INNER = hexPath(7.9);
const MASTER_CHECK = "M7.6 12.5l2.9 2.9 5.9-6.05";

/** «PRO xodim» — qora olti burchak, oltin hoshiya va oltin galochka. */
function MasterArt({ px, still }: { px: number; still: boolean }) {
  const uid = useId().replace(/:/g, "");
  const t = LEADER.master;
  const id = (k: string) => `vbm-${k}-${uid}`;
  const star = starPathAt(12, 0.9, 3.1, 1.3);
  return (
    <svg viewBox="0 0 24 24" width={px} height={px} aria-hidden="true" className={cn(!still && "verified-badge-sway")} style={{ overflow: "visible" }}>
      <defs>
        <linearGradient id={id("ring")} x1="0" y1="0" x2="24" y2="24" gradientUnits="userSpaceOnUse">
          {stops(t.ring)}
          <animateTransform attributeName="gradientTransform" type="rotate" values="0 12 12;360 12 12" dur="4s" repeatCount="indefinite" />
        </linearGradient>
        <linearGradient id={id("body")} x1="5" y1="3" x2="19" y2="21" gradientUnits="userSpaceOnUse">
          {stops(t.fill)}
        </linearGradient>
        <linearGradient id={id("gold")} x1="0" y1="7" x2="0" y2="17" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#FFF7CC" />
          <stop offset="0.45" stopColor="#F5C542" />
          <stop offset="1" stopColor="#B07800" />
        </linearGradient>
        <linearGradient id={id("star")} x1="0" y1="-2.5" x2="0" y2="4.5" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#FFFBE6" />
          <stop offset="0.5" stopColor="#FACC15" />
          <stop offset="1" stopColor="#B45309" />
        </linearGradient>
        <linearGradient id={id("gloss")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.32" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={id("shine")} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#FDE68A" stopOpacity="0" />
          <stop offset="0.5" stopColor="#FDE68A" stopOpacity="0.55" />
          <stop offset="1" stopColor="#FDE68A" stopOpacity="0" />
        </linearGradient>
        <clipPath id={id("clip")}>
          <path d={HEX_BODY} />
        </clipPath>
      </defs>

      <path d={HEX_OUTER} fill="#000" opacity="0.35" transform="translate(0 0.6)" strokeLinejoin="round" />
      <path d={HEX_OUTER} fill={`url(#${id("ring")})`} stroke={`url(#${id("ring")})`} strokeWidth="1.1" strokeLinejoin="round" />
      <path d={HEX_BODY} fill={`url(#${id("body")})`} stroke="#000" strokeOpacity="0.6" strokeWidth="0.4" strokeLinejoin="round" />
      <g clipPath={`url(#${id("clip")})`}>
        <ellipse cx="12" cy="6.2" rx="8" ry="4.4" fill={`url(#${id("gloss")})`} />
        <rect x="-14" y="-4" width="5" height="32" fill={`url(#${id("shine")})`} transform="rotate(22 12 12)">
          <animate attributeName="x" values="-14;-14;30" keyTimes="0;0.55;1" dur="3.4s" repeatCount="indefinite" />
        </rect>
      </g>
      <path d={HEX_INNER} fill="none" stroke="#F5C542" strokeOpacity="0.75" strokeWidth="0.45" strokeLinejoin="round" />

      <path d={MASTER_CHECK} fill="none" stroke="#000" strokeOpacity="0.6" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" transform="translate(0 0.7)" />
      <path d={MASTER_CHECK} fill="none" stroke={`url(#${id("gold")})`} strokeWidth="2.9" strokeLinecap="round" strokeLinejoin="round" />

      <path d={star} fill="#000" opacity="0.45" transform="translate(0 0.5)" />
      <path d={star} fill={`url(#${id("star")})`} stroke="#78350F" strokeWidth="0.4" strokeLinejoin="round" />
      <Sparkle x={20.4} y={4.6} dur="2.2s" />
      <Sparkle x={3.8} y={18.6} dur="2.9s" />
    </svg>
  );
}

function starPathAt(cx: number, cy: number, outer: number, inner: number): string {
  let d = "";
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? inner : outer;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    d += `${i ? "L" : "M"}${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`;
  }
  return `${d}Z`;
}

function LeaderArt({ tier, px, still }: { tier: VerifiedTier; px: number; still: boolean }) {
  const uid = useId().replace(/:/g, "");
  const t = LEADER[tier];
  const id = (k: string) => `vbl-${k}-${uid}`;
  return (
    <svg viewBox="0 0 24 24" width={px} height={px} aria-hidden="true" className={cn(!still && "verified-badge-sway")} style={{ overflow: "visible" }}>
      <defs>
        <linearGradient id={id("fill")} x1="3" y1="3" x2="21" y2="21" gradientUnits="userSpaceOnUse">
          {stops(t.fill)}
        </linearGradient>
        <linearGradient id={id("ring")} x1="0" y1="0" x2="24" y2="24" gradientUnits="userSpaceOnUse">
          {stops(t.ring)}
          <animateTransform attributeName="gradientTransform" type="rotate" values="0 12 12;360 12 12" dur="3s" repeatCount="indefinite" />
        </linearGradient>
        <linearGradient id={id("gloss")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.75" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <radialGradient id={id("shade")} cx="12" cy="19" r="10" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={t.core} stopOpacity="0.35" />
          <stop offset="1" stopColor={t.core} stopOpacity="0" />
        </radialGradient>
        <linearGradient id={id("shine")} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0.85" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={id("crown")} x1="0" y1="-3" x2="0" y2="5" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#FFFBE0" />
          <stop offset="0.5" stopColor="#FFC83D" />
          <stop offset="1" stopColor="#C26A00" />
        </linearGradient>
        <clipPath id={id("clip")}>
          <circle cx="12" cy="12" r="9.6" />
        </clipPath>
      </defs>

      <circle cx="12" cy="12" r="11.1" fill="none" stroke={`url(#${id("ring")})`} strokeWidth="1.9" />
      <circle cx="12" cy="12" r="9.9" fill={t.core} />
      <circle cx="12" cy="12" r="9.6" fill={`url(#${id("fill")})`} />
      <g clipPath={`url(#${id("clip")})`}>
        <circle cx="12" cy="12" r="9.6" fill={`url(#${id("shade")})`} />
        <ellipse cx="12" cy="6.4" rx="7.6" ry="4.6" fill={`url(#${id("gloss")})`} />
        <rect x="-14" y="-4" width="6" height="32" fill={`url(#${id("shine")})`} transform="rotate(22 12 12)">
          <animate attributeName="x" values="-14;-14;30" keyTimes="0;0.6;1" dur="3s" repeatCount="indefinite" />
        </rect>
      </g>
      {t.innerRing ? (
        <circle cx="12" cy="12" r="8.2" fill="none" stroke={t.innerRing} strokeOpacity="0.9" strokeWidth="0.75" />
      ) : (
        <circle cx="12" cy="12" r="8.1" fill="none" stroke="#fff" strokeOpacity="0.28" strokeWidth="0.5" />
      )}
      <path d={LEADER_CHECK} fill="none" stroke={t.core} strokeOpacity="0.45" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" transform="translate(0 0.7)" />
      <path d={LEADER_CHECK} fill="none" stroke="#fff" strokeWidth="2.9" strokeLinecap="round" strokeLinejoin="round" />
      {t.crown ? (
        <g transform="translate(0 -4.4)">
          <path d={CROWN} fill={`url(#${id("crown")})`} stroke={t.core} strokeWidth="0.7" strokeLinejoin="round" />
          <circle cx="12" cy="-2.6" r="1" fill="#FF3D6E" stroke="#fff" strokeWidth="0.35" />
          <circle cx="7.2" cy="-0.9" r="0.7" fill="#FFFBE0" />
          <circle cx="16.8" cy="-0.9" r="0.7" fill="#FFFBE0" />
        </g>
      ) : null}
      <Sparkle x={t.crown ? 21 : 20} y={t.crown ? 6 : 3.6} />
    </svg>
  );
}

/* ──────────────────────── Xodim unvonlari: rozetka ──────────────────────── */

function scallop(R: number, amp: number, lobes = 12, steps = 192): string {
  let d = "";
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2 - Math.PI / 2;
    const r = R + amp * Math.cos(lobes * (a + Math.PI / 2));
    d += `${i ? "L" : "M"}${(12 + r * Math.cos(a)).toFixed(2)} ${(12 + r * Math.sin(a)).toFixed(2)}`;
  }
  return `${d}Z`;
}

function starPath(cx: number, cy: number, outer: number, inner: number): string {
  let d = "";
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? inner : outer;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    d += `${i ? "L" : "M"}${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`;
  }
  return `${d}Z`;
}

const RIM = scallop(10.45, 0.72);
const RIM_EDGE = scallop(10.05, 0.66);
const BODY = scallop(9.05, 0.6);
const STAR = starPath(12, 0.6, 3.6, 1.55);
const ROSETTE_CHECK = "M7.7 12.25l2.85 2.85 5.75-5.9";
const WARN_BAR = "M12 7.4v5.3";

type RosetteStyle = {
  body: string[];
  rim: string[];
  core: string;
  glow: string;
  disc: [string, string];
  top?: "star" | "crown";
  icon?: "warning";
};

const GOLD_RIM = ["#FFF6CC", "#F9CF4F", "#C98A12", "#FFE7A0", "#B9780A"];
const IRON_RIM = ["#9CA3AF", "#4B5563", "#1F2937", "#6B7280", "#111827"];

const ROSETTE: Record<EmployeeTitle, RosetteStyle> = {
  faol: {
    body: ["#8FDBFF", "#3A9BFF", "#1A5FE0", "#0B318F"],
    rim: GOLD_RIM,
    core: "#0A2A6B",
    glow: "rgba(40,120,255,0.55)",
    disc: ["#5FB6FF", "#1446C2"],
  },
  ishonchli: {
    body: ["#E7C2FF", "#B064FF", "#7C2BD9", "#3E0F86"],
    rim: GOLD_RIM,
    core: "#2A0A5E",
    glow: "rgba(150,70,255,0.55)",
    disc: ["#C084FC", "#5B1BB8"],
  },
  professional: {
    body: ["#FFF3B0", "#FFCC3D", "#EA9A0B", "#9A5A00"],
    rim: ["#FFFBE6", "#FFE08A", "#B8790A", "#FFF1B8", "#A86A04"],
    core: "#5C3300",
    glow: "rgba(255,170,0,0.6)",
    disc: ["#FFD966", "#C77A00"],
    top: "star",
  },
  premium: {
    body: ["#FF9A9A", "#F43B4B", "#B3121F", "#6E0510"],
    rim: GOLD_RIM,
    core: "#4A0008",
    glow: "rgba(240,40,60,0.55)",
    disc: ["#FF5A68", "#9E0B1A"],
    top: "crown",
  },
  rivojlanish: {
    body: ["#7F1D1D", "#5B1218", "#3B0A10", "#1C0508"],
    rim: IRON_RIM,
    core: "#14040A",
    glow: "rgba(127,29,29,0.5)",
    disc: ["#B91C1C", "#450A0A"],
    icon: "warning",
  },
};

function RosetteArt({ title, px, still }: { title: EmployeeTitle; px: number; still: boolean }) {
  const uid = useId().replace(/:/g, "");
  const s = ROSETTE[title];
  const id = (k: string) => `vbr-${k}-${uid}`;
  return (
    <svg viewBox="0 0 24 24" width={px} height={px} aria-hidden="true" className={cn(!still && "verified-badge-sway")} style={{ overflow: "visible" }}>
      <defs>
        <linearGradient id={id("rim")} x1="2" y1="1" x2="22" y2="23" gradientUnits="userSpaceOnUse">
          {stops(s.rim)}
        </linearGradient>
        <linearGradient id={id("body")} x1="4" y1="3" x2="20" y2="21" gradientUnits="userSpaceOnUse">
          {stops(s.body)}
        </linearGradient>
        <radialGradient id={id("disc")} cx="10" cy="8.5" r="9" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={s.disc[0]} />
          <stop offset="1" stopColor={s.disc[1]} />
        </radialGradient>
        <linearGradient id={id("gloss")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.8" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={id("shine")} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0.9" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={id("gold")} x1="0" y1="-4" x2="0" y2="5" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#FFFBE0" />
          <stop offset="0.45" stopColor="#FFD24A" />
          <stop offset="1" stopColor="#C26A00" />
        </linearGradient>
        <clipPath id={id("clip")}>
          <path d={BODY} />
        </clipPath>
      </defs>

      {/* oltin hoshiya (rasmdagidek to‘lqinsimon chekka) */}
      <path d={RIM} fill={s.core} transform="translate(0 0.55)" opacity="0.35" />
      <path d={RIM} fill={`url(#${id("rim")})`} />
      <path d={RIM_EDGE} fill="none" stroke="#fff" strokeOpacity="0.55" strokeWidth="0.35" />

      {/* rangli tana */}
      <path d={BODY} fill={s.core} transform="translate(0 0.35)" opacity="0.55" />
      <path d={BODY} fill={`url(#${id("body")})`} />
      <g clipPath={`url(#${id("clip")})`}>
        <circle cx="12" cy="12.3" r="7.15" fill={s.core} opacity="0.35" />
        <circle cx="12" cy="12" r="7" fill={`url(#${id("disc")})`} />
        <ellipse cx="12" cy="7.2" rx="6.8" ry="3.9" fill={`url(#${id("gloss")})`} />
        <rect x="-14" y="-4" width="5.5" height="32" fill={`url(#${id("shine")})`} transform="rotate(22 12 12)">
          <animate attributeName="x" values="-14;-14;30" keyTimes="0;0.55;1" dur="3.2s" repeatCount="indefinite" />
        </rect>
      </g>
      <circle cx="12" cy="12" r="7" fill="none" stroke="#fff" strokeOpacity="0.35" strokeWidth="0.4" />

      {/* belgi: qalin oq galochka yoki ogohlantirish undovi */}
      {s.icon === "warning" ? (
        <>
          <g transform="translate(0 0.7)" fill={s.core} stroke={s.core} opacity="0.55">
            <path d={WARN_BAR} fill="none" strokeWidth="3.3" strokeLinecap="round" />
            <circle cx="12" cy="16.1" r="1.65" stroke="none" />
          </g>
          <path d={WARN_BAR} fill="none" stroke="#fff" strokeWidth="2.7" strokeLinecap="round" />
          <circle cx="12" cy="16.1" r="1.45" fill="#fff" />
        </>
      ) : (
        <>
          <path d={ROSETTE_CHECK} fill="none" stroke={s.core} strokeOpacity="0.5" strokeWidth="3.8" strokeLinecap="round" strokeLinejoin="round" transform="translate(0 0.8)" />
          <path d={ROSETTE_CHECK} fill="none" stroke="#fff" strokeWidth="3.1" strokeLinecap="round" strokeLinejoin="round" />
          <path d={ROSETTE_CHECK} fill="none" stroke="#fff" strokeOpacity="0.9" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" transform="translate(0 -0.35)" />
        </>
      )}

      {s.top === "star" ? (
        <g>
          <path d={STAR} fill={s.core} opacity="0.4" transform="translate(0 0.5)" />
          <path d={STAR} fill={`url(#${id("gold")})`} stroke="#8A5200" strokeWidth="0.45" strokeLinejoin="round" />
          <path d={starPath(12, 0.6, 1.6, 0.7)} fill="#FFFBE6" opacity="0.85" />
        </g>
      ) : null}
      {s.top === "crown" ? (
        <g transform="translate(0 -2.7)">
          <path d={CROWN} fill={s.core} opacity="0.4" transform="translate(0 0.5)" />
          <path d={CROWN} fill={`url(#${id("gold")})`} stroke="#7A4300" strokeWidth="0.6" strokeLinejoin="round" />
          <circle cx="12" cy="-2.6" r="1" fill="#FF2E4D" stroke="#fff" strokeWidth="0.35" />
          <circle cx="7.2" cy="-0.9" r="0.7" fill="#FFFBE0" />
          <circle cx="16.8" cy="-0.9" r="0.7" fill="#FFFBE0" />
        </g>
      ) : null}

      {title !== "rivojlanish" ? <Sparkle x={20.6} y={4.4} dur="2s" /> : null}
    </svg>
  );
}

/* ───────────────────────────── Umumiy qismlar ───────────────────────────── */

const RIBBON: Record<string, { bg: [string, string]; border: [string, string] }> = {
  faol: { bg: ["#4FA8FF", "#1552CC"], border: ["#FFF4C2", "#D99A1E"] },
  ishonchli: { bg: ["#B26BFF", "#6420C9"], border: ["#FFF4C2", "#D99A1E"] },
  professional: { bg: ["#FFC93C", "#B86E00"], border: ["#FFFBE6", "#C98A12"] },
  premium: { bg: ["#FF4D5E", "#A8001C"], border: ["#FFF4C2", "#D99A1E"] },
  rivojlanish: { bg: ["#B91C1C", "#450A0A"], border: ["#9CA3AF", "#1F2937"] },
  founder: { bg: ["#FFC83D", "#B85500"], border: ["#FFFBE0", "#C98A12"] },
  director: { bg: ["#9B4DFF", "#3B12A8"], border: ["#FFF1B8", "#C9A227"] },
  hr: { bg: ["#22D39A", "#06705A"], border: ["#E6FFF6", "#2AA889"] },
  lead: { bg: ["#4F7BFF", "#8B3CFF"], border: ["#FFE66D", "#FF5FA2"] },
  master: { bg: ["#27272A", "#000000"], border: ["#FFF3B0", "#B8860B"] },
};

const RIBBON_CLIP = "polygon(0 0, 100% 0, 93% 50%, 100% 100%, 0 100%, 7% 50%)";

function kindKey(kind: BadgeKind): string {
  return kind.type === "pro" ? kind.tier : kind.title;
}

export function badgeLabel(kind: BadgeKind): string {
  return kind.type === "pro" ? "PRO" : TITLE_META[kind.title].label;
}

export function badgeName(kind: BadgeKind): string {
  return kind.type === "pro" ? PRO_META[kind.tier].name : TITLE_META[kind.title].name;
}

function badgeGlow(kind: BadgeKind): string {
  return kind.type === "pro" ? LEADER[kind.tier].glow : ROSETTE[kind.title].glow;
}

export function BadgeArt({ kind, px, still = false }: { kind: BadgeKind; px: number; still?: boolean }) {
  if (kind.type === "title") return <RosetteArt title={kind.title} px={px} still={still} />;
  return kind.tier === "master" ? <MasterArt px={px} still={still} /> : <LeaderArt tier={kind.tier} px={px} still={still} />;
}

export function BadgeRibbon({ kind, className }: { kind: BadgeKind; className?: string }) {
  const r = RIBBON[kindKey(kind)];
  return (
    <span
      className={cn("inline-block p-[1.5px] drop-shadow-[0_2px_3px_rgba(0,0,0,0.25)]", className)}
      style={{ clipPath: RIBBON_CLIP, background: `linear-gradient(180deg, ${r.border[0]}, ${r.border[1]})` }}
    >
      <span
        className="block whitespace-nowrap px-5 py-[3px] text-[10.5px] font-black uppercase leading-none tracking-[0.16em] text-white [text-shadow:0_1px_1px_rgba(0,0,0,0.35)]"
        style={{ clipPath: RIBBON_CLIP, background: `linear-gradient(180deg, ${r.bg[0]}, ${r.bg[1]})` }}
      >
        {badgeLabel(kind)}
      </span>
    </span>
  );
}

/** Katta medal: belgi + lenta (izoh kartasi va admin sahifasi uchun). */
export function BadgeMedal({ kind, px = 72, still = false, className }: { kind: BadgeKind; px?: number; still?: boolean; className?: string }) {
  return (
    <span className={cn("inline-flex flex-col items-center", className)}>
      <span className="inline-flex items-center justify-center" style={{ width: px, height: px, filter: `drop-shadow(0 4px 10px ${badgeGlow(kind)})` }}>
        <BadgeArt kind={kind} px={px} still={still} />
      </span>
      <BadgeRibbon kind={kind} className="-mt-1.5" />
    </span>
  );
}

export function BadgeInfoCard({ kind, role, name }: { kind: BadgeKind; role?: string | null; name?: ReactNode }) {
  const isPro = kind.type === "pro";
  const meta = isPro ? PRO_META[kind.tier] : TITLE_META[kind.title];
  const title = isPro ? PRO_META[kind.tier].name : TITLE_META[kind.title].name;
  const proText = isPro ? PRO_TIER_TEXT[kind.tier] : undefined;
  const tagline = isPro ? proText?.tagline ?? "Kompaniya professionali" : TITLE_META[kind.title].tagline;
  const description = isPro ? proText?.description ?? PRO_DESCRIPTION : TITLE_META[kind.title].description;
  const criteria = isPro ? proText?.criteria ?? PRO_CRITERIA : TITLE_META[kind.title].criteria;
  const warning = !isPro && TITLE_META[kind.title].tone === "warning";
  return (
    <div
      className="overflow-hidden rounded-2xl bg-white dark:bg-slate-900"
      style={{ "--acc": meta.accent, "--soft": meta.soft } as CSSProperties}
    >
      <div className="relative flex flex-col items-center gap-1 px-5 pb-4 pt-6 text-center">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_90%_at_50%_0%,var(--soft)_0%,transparent_75%)] dark:bg-[radial-gradient(120%_90%_at_50%_0%,color-mix(in_srgb,var(--acc)_32%,transparent)_0%,transparent_75%)]"
        />
        <BadgeMedal kind={kind} px={76} className="relative" />
        <div className="relative mt-2 text-base font-bold text-slate-900 dark:text-white">{title}</div>
        <div className="relative text-xs font-semibold uppercase tracking-wider text-[var(--acc)] dark:text-[color-mix(in_srgb,var(--acc)_45%,white)]">
          {tagline}
        </div>
        {name ? (
          <div className="relative mt-1 max-w-full truncate text-xs text-slate-500 dark:text-slate-400">
            {name}
            {isPro && role ? ` · ${userRoleLabel(role)}` : ""}
          </div>
        ) : null}
      </div>
      <div className="space-y-3 border-t border-slate-100 px-5 py-4 dark:border-slate-800">
        <p className="text-[13px] leading-relaxed text-slate-700 dark:text-slate-200">{description}</p>
        <ul className="space-y-1.5">
          {criteria.map((c) => (
            <li key={c} className="flex items-start gap-2 text-[12.5px] text-slate-600 dark:text-slate-300">
              <span className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[var(--soft)] text-[var(--acc)] dark:bg-[color-mix(in_srgb,var(--acc)_28%,transparent)] dark:text-[color-mix(in_srgb,var(--acc)_45%,white)]">
                {warning ? <X className="h-3 w-3" strokeWidth={3} /> : <Check className="h-3 w-3" strokeWidth={3} />}
              </span>
              {c}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

const stop = (e: SyntheticEvent) => e.stopPropagation();

export function VerifiedBadge({
  role,
  userId,
  name,
  size = "sm",
  className,
  still = false,
  interactive = true,
}: {
  role?: string | null;
  userId?: number | null;
  /** Izoh kartasida ko‘rsatiladigan ism */
  name?: ReactNode;
  size?: VerifiedBadgeSize;
  className?: string;
  /** Tebranishsiz (masalan, juda zich ro‘yxatlarda) */
  still?: boolean;
  /** false — bosilganda izoh ochilmaydi */
  interactive?: boolean;
}) {
  const map = useTitleMap();
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const kind = resolveBadgeKind(role, userId, map);
  if (!kind) return null;
  const px = SIZES[size];
  const label =
    kind.type === "title"
      ? `${badgeLabel(kind)} unvoni`
      : kind.tier === "master"
        ? badgeName(kind)
        : `PRO · ${userRoleLabel(role) || badgeName(kind)}`;
  const art = (
    <span
      ref={anchorRef}
      role={interactive ? "button" : "img"}
      tabIndex={interactive ? 0 : undefined}
      aria-label={label}
      title={interactive ? undefined : label}
      className={cn(
        "verified-badge inline-flex shrink-0 items-center justify-center align-[-0.18em] outline-none",
        interactive && "cursor-pointer rounded-full focus-visible:ring-2 focus-visible:ring-sky-400",
        className,
      )}
      style={{ width: px, height: px, filter: `drop-shadow(0 1.5px 3px ${badgeGlow(kind)})` }}
      onPointerDown={interactive ? stop : undefined}
      onClick={
        interactive
          ? (e) => {
              e.preventDefault();
              e.stopPropagation();
              setOpen((o) => !o);
            }
          : undefined
      }
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                setOpen((o) => !o);
              }
            }
          : undefined
      }
    >
      <BadgeArt kind={kind} px={px} still={still} />
    </span>
  );
  if (!interactive) return art;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>{art}</PopoverAnchor>
      <PopoverContent
        side="bottom"
        align="center"
        sideOffset={8}
        collisionPadding={12}
        className="z-[1000] w-80 rounded-2xl border-slate-200 p-0 shadow-2xl dark:border-slate-700"
        onPointerDownOutside={(e) => {
          if (anchorRef.current?.contains(e.target as Node)) e.preventDefault();
        }}
        onClick={stop}
        onPointerDown={stop}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <BadgeInfoCard kind={kind} role={role} name={name} />
      </PopoverContent>
    </Popover>
  );
}

/** Ism + belgi (ism uzun bo‘lsa qisqaradi, belgi doim ko‘rinadi). */
export function VerifiedName({
  name,
  role,
  userId,
  size = "sm",
  className,
  nameClassName,
}: {
  name: ReactNode;
  role?: string | null;
  userId?: number | null;
  size?: VerifiedBadgeSize;
  className?: string;
  nameClassName?: string;
}) {
  return (
    <span className={cn("inline-flex min-w-0 max-w-full items-center gap-1.5", className)}>
      <span className={cn("truncate", nameClassName)}>{name}</span>
      <VerifiedBadge role={role} userId={userId} name={name} size={size} />
    </span>
  );
}
