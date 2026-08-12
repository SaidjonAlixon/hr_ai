import React, { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useLocation } from "wouter";
import { cn } from "@/lib/utils";
import {
  Network,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Crown,
  ShieldCheck,
  Briefcase,
  UserSearch,
  GraduationCap,
  Waypoints,
  Store,
  Users,
  Pill,
} from "lucide-react";
import { Button } from "@/components/ui/button";

type ToneKey = keyof typeof TONES;

type OrgNode = {
  id: string;
  label: string;
  hint?: string;
  tone: ToneKey;
  icon: React.ComponentType<{ className?: string }>;
  children?: OrgNode[];
  mergePair?: [OrgNode, OrgNode];
};

const TONES = {
  director: {
    card: "from-[#0B3A5C] to-[#145A8A]",
    ring: "ring-[#0B3A5C]/25",
    soft: "bg-[#0B3A5C]/10 text-[#0B3A5C]",
    line: "#94A3B8",
  },
  manager: {
    card: "from-[#1D4E89] to-[#2E6FAF]",
    ring: "ring-[#1D4E89]/25",
    soft: "bg-[#1D4E89]/10 text-[#1D4E89]",
    line: "#94A3B8",
  },
  specialist: {
    card: "from-[#5B4B8A] to-[#7A68B0]",
    ring: "ring-[#5B4B8A]/25",
    soft: "bg-[#5B4B8A]/10 text-[#5B4B8A]",
    line: "#94A3B8",
  },
  coord: {
    card: "from-[#0F766E] to-[#14B8A6]",
    ring: "ring-teal-500/25",
    soft: "bg-teal-500/10 text-teal-800",
    line: "#94A3B8",
  },
  branch: {
    card: "from-[#9A6B3F] to-[#C48A54]",
    ring: "ring-amber-700/20",
    soft: "bg-amber-700/10 text-amber-900",
    line: "#94A3B8",
  },
  lead: {
    card: "from-[#2F6B4F] to-[#3F8F6A]",
    ring: "ring-emerald-600/20",
    soft: "bg-emerald-600/10 text-emerald-900",
    line: "#94A3B8",
  },
  staff: {
    card: "from-[#B4535A] to-[#D4737A]",
    ring: "ring-rose-500/20",
    soft: "bg-rose-500/10 text-rose-900",
    line: "#94A3B8",
  },
} as const;

const ALLOWED_ROLES = new Set([
  "hr",
  "hr_direktor",
  "hr_auditor",
  "hr_menejer",
  "recruiter",
  "koordinator",
  "mudir",
  "farmasevt",
]);

function makeBranchChain(prefix: string): OrgNode {
  return {
    id: `${prefix}-koordinator`,
    label: "Koordinator",
    hint: "Filiallar nazorati",
    tone: "coord",
    icon: Waypoints,
    children: [
      {
        id: `${prefix}-filial-mudiri`,
        label: "Filial mudiri",
        hint: "Apteka rahbari",
        tone: "branch",
        icon: Store,
        children: [
          {
            id: `${prefix}-boshqaruvchi`,
            label: "Boshqaruvchi",
            hint: "Smena / jamoa",
            tone: "lead",
            icon: Users,
            children: [
              {
                id: `${prefix}-farmasevt-1`,
                label: "Farmasevt",
                hint: "1-smena",
                tone: "staff",
                icon: Pill,
              },
              {
                id: `${prefix}-farmasevt-2`,
                label: "Farmasevt",
                hint: "2-smena",
                tone: "staff",
                icon: Pill,
              },
            ],
          },
        ],
      },
    ],
  };
}

function makeManagerBranch(n: number): OrgNode {
  return {
    id: `hr-menejer-${n}`,
    label: "HR Menejer",
    hint: `${n}-yo‘nalish`,
    tone: "manager",
    icon: Briefcase,
    mergePair: [
      {
        id: `rekruter-${n}`,
        label: "Rekruter",
        hint: "Tanlov",
        tone: "specialist",
        icon: UserSearch,
      },
      {
        id: `trener-${n}`,
        label: "Trener",
        hint: "O‘qitish",
        tone: "specialist",
        icon: GraduationCap,
      },
    ],
    children: [makeBranchChain(`m${n}`)],
  };
}

const ORG_TREE: OrgNode = {
  id: "hr-direktor",
  label: "HR Direktor",
  hint: "Strategiya",
  tone: "director",
  icon: Crown,
  children: [
    {
      id: "hr-auditor",
      label: "HR Auditor",
      hint: "Nazorat",
      tone: "director",
      icon: ShieldCheck,
      children: [makeManagerBranch(1), makeManagerBranch(2)],
    },
  ],
};

function NodeCard({
  node,
  highlight,
  onSelect,
  size = "md",
}: {
  node: OrgNode;
  highlight: boolean;
  onSelect: (id: string) => void;
  size?: "sm" | "md" | "lg";
}) {
  const tone = TONES[node.tone];
  const Icon = node.icon;
  return (
    <button
      type="button"
      onClick={() => onSelect(node.id)}
      className={cn(
        "group relative z-[2] overflow-hidden rounded-2xl text-left shadow-[0_10px_30px_-12px_rgba(15,58,92,0.35)] transition-all duration-300",
        "hover:-translate-y-1 hover:shadow-[0_18px_40px_-14px_rgba(15,58,92,0.45)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b3a5c]/40 focus-visible:ring-offset-2",
        highlight && cn("ring-2 ring-offset-2", tone.ring),
        size === "lg" && "min-w-[200px]",
        size === "md" && "min-w-[168px]",
        size === "sm" && "min-w-[148px]",
      )}
    >
      <div className={cn("bg-gradient-to-br p-[1px]", tone.card)}>
        <div className="rounded-[15px] bg-white/95 backdrop-blur-sm">
          <div className="flex items-center gap-3 px-3.5 py-3">
            <span
              className={cn(
                "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-inner",
                tone.card,
              )}
            >
              <Icon className="h-5 w-5" />
            </span>
            <span className="min-w-0">
              <span className="block text-[13px] font-semibold leading-tight tracking-tight text-slate-900">
                {node.label}
              </span>
              {node.hint ? (
                <span className="mt-0.5 block text-[11px] text-slate-500">{node.hint}</span>
              ) : null}
            </span>
          </div>
        </div>
      </div>
    </button>
  );
}

function Connector({ tall = false }: { tall?: boolean }) {
  return (
    <div className="relative z-0 flex flex-col items-center">
      <div
        className={cn("w-[2.5px] rounded-full bg-slate-500", tall ? "h-10" : "h-7")}
      />
      <div className="h-2 w-2 shrink-0 rounded-full border-2 border-slate-500 bg-white" />
    </div>
  );
}

function MergePair({
  left,
  right,
  selectedId,
  onSelect,
}: {
  left: OrgNode;
  right: OrgNode;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="flex w-full flex-col items-center">
      <div className="relative flex items-start justify-center gap-10 sm:gap-14">
        {/* Yuqori gorizontal — to‘liq ko‘rinadigan */}
        <div className="pointer-events-none absolute top-0 left-[22%] right-[22%] h-[2.5px] rounded-full bg-slate-500" />
        {[left, right].map((n) => (
          <div key={n.id} className="relative z-[1] flex flex-col items-center">
            <div className="h-7 w-[2.5px] rounded-full bg-slate-500" />
            <NodeCard node={n} highlight={selectedId === n.id} onSelect={onSelect} size="sm" />
            <div className="h-7 w-[2.5px] rounded-full bg-slate-500" />
          </div>
        ))}
        {/* Pastki gorizontal — birlashish */}
        <div className="pointer-events-none absolute bottom-0 left-[22%] right-[22%] h-[2.5px] rounded-full bg-slate-500" />
      </div>
      <div className="h-7 w-[2.5px] rounded-full bg-slate-500" />
      <div className="h-2 w-2 shrink-0 rounded-full border-2 border-slate-500 bg-white" />
    </div>
  );
}

function OrgTree({
  node,
  selectedId,
  onSelect,
  isRoot = false,
  depth = 0,
}: {
  node: OrgNode;
  selectedId: string | null;
  onSelect: (id: string) => void;
  isRoot?: boolean;
  depth?: number;
}) {
  const kids = node.children ?? [];
  const hasMerge = !!node.mergePair;
  const size = depth === 0 ? "lg" : depth <= 2 ? "md" : "sm";

  return (
    <div
      className="flex flex-col items-center"
      style={{
        opacity: 1,
        transform: "translateY(0)",
        transition: "opacity 0.4s ease, transform 0.4s ease",
        transitionDelay: `${Math.min(depth, 8) * 35}ms`,
      }}
    >
      <NodeCard
        node={node}
        highlight={selectedId === node.id}
        onSelect={onSelect}
        size={size}
      />

      {(hasMerge || kids.length > 0) && (
        <>
          <Connector tall={depth === 0} />

          {hasMerge && node.mergePair ? (
            <div className="flex flex-col items-center">
              <MergePair
                left={node.mergePair[0]}
                right={node.mergePair[1]}
                selectedId={selectedId}
                onSelect={onSelect}
              />
              {kids.map((child) => (
                <OrgTree
                  key={child.id}
                  node={child}
                  selectedId={selectedId}
                  onSelect={onSelect}
                  depth={depth + 1}
                />
              ))}
            </div>
          ) : (
            <div className="relative flex items-start">
              {kids.length > 1 && (
                <div
                  className="pointer-events-none absolute top-0 h-[2.5px] rounded-full bg-slate-500"
                  style={{
                    left: `calc(100% / ${kids.length * 2})`,
                    right: `calc(100% / ${kids.length * 2})`,
                  }}
                />
              )}
              {kids.map((child) => (
                <div
                  key={child.id}
                  className="flex flex-col items-center px-6 sm:px-10 md:px-14 lg:px-16"
                >
                  {kids.length > 1 && (
                    <>
                      <div className="h-7 w-[2.5px] rounded-full bg-slate-500" />
                      <div className="mb-0 h-2 w-2 shrink-0 rounded-full border-2 border-slate-500 bg-white" />
                    </>
                  )}
                  <OrgTree
                    node={child}
                    selectedId={selectedId}
                    onSelect={onSelect}
                    depth={depth + 1}
                  />
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

const LEGEND: { label: string; tone: ToneKey }[] = [
  { label: "HR rahbariyat", tone: "director" },
  { label: "HR Menejer", tone: "manager" },
  { label: "Rekruter / Trener", tone: "specialist" },
  { label: "Koordinator", tone: "coord" },
  { label: "Filial mudiri", tone: "branch" },
  { label: "Boshqaruvchi", tone: "lead" },
  { label: "Farmasevt", tone: "staff" },
];

export default function TashkiliyTuzilmaPage() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const [selectedId, setSelectedId] = useState<string | null>("hr-direktor");
  const [zoom, setZoom] = useState(0.9);

  const allowed = useMemo(() => (user?.role ? ALLOWED_ROLES.has(user.role) : false), [user?.role]);

  useEffect(() => {
    if (user && !allowed) setLocation("/dashboard");
  }, [user, allowed, setLocation]);

  if (!user || !allowed) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-slate-500">
        Ruxsat yo‘q…
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-[calc(100vh-4rem)] flex-col bg-[#EEF2F6]">
      <div className="shrink-0 border-b border-white/60 bg-white/80 px-4 py-5 backdrop-blur-xl sm:px-8">
        <div className="mx-auto flex max-w-[1700px] flex-wrap items-end justify-between gap-5">
          <div className="max-w-2xl">
            <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
              <Network className="h-3.5 w-3.5 text-[#0b3a5c]" />
              VAKSINA MED · Org chart
            </div>
            <h1 className="font-serif text-3xl font-semibold tracking-tight text-[#0b3a5c] sm:text-4xl">
              Tashkiliy tuzilma
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-slate-500 sm:text-[15px]">
              Yuqoridan pastga: rahbariyat → menejerlar → rekruter/trener → koordinator → filial →
              boshqaruvchi → farmasevtlar. Kartani bosing — tanlangan lavozim ajralib ko‘rinadi.
            </p>
          </div>

          <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white p-1.5 shadow-sm">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-9 w-9"
              onClick={() => setZoom((z) => Math.max(0.45, Number((z - 0.1).toFixed(2))))}
              aria-label="Kichiklashtirish"
            >
              <ZoomOut className="h-4 w-4" />
            </Button>
            <span className="min-w-[3.5rem] text-center text-xs font-semibold tabular-nums text-slate-600">
              {Math.round(zoom * 100)}%
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-9 w-9"
              onClick={() => setZoom((z) => Math.min(1.35, Number((z + 0.1).toFixed(2))))}
              aria-label="Kattalashtirish"
            >
              <ZoomIn className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-9 w-9"
              onClick={() => setZoom(0.9)}
              aria-label="Qayta o‘lchash"
            >
              <Maximize2 className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="mx-auto mt-5 flex max-w-[1700px] flex-wrap gap-2">
          {LEGEND.map((item) => (
            <span
              key={item.label}
              className={cn(
                "inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[11px] font-medium",
                TONES[item.tone].soft,
              )}
            >
              <span
                className={cn("h-2 w-2 rounded-full bg-gradient-to-br", TONES[item.tone].card)}
              />
              {item.label}
            </span>
          ))}
        </div>
      </div>

      <div className="relative min-h-0 flex-1 overflow-auto">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              "radial-gradient(ellipse 80% 50% at 50% -10%, rgba(11,58,92,0.08), transparent 55%), radial-gradient(circle at 1px 1px, rgba(15,58,92,0.06) 1px, transparent 0)",
            backgroundSize: "auto, 28px 28px",
          }}
        />
        <div className="relative flex min-h-full min-w-max items-start justify-center px-10 py-12 sm:px-16 sm:py-14">
          <div
            className="origin-top transition-transform duration-300 ease-out"
            style={{ transform: `scale(${zoom})` }}
          >
            <div className="rounded-[28px] border border-white/70 bg-white/40 p-8 shadow-[0_30px_80px_-40px_rgba(15,58,92,0.45)] backdrop-blur-sm sm:p-12">
              <OrgTree
                node={ORG_TREE}
                selectedId={selectedId}
                onSelect={setSelectedId}
                isRoot
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
