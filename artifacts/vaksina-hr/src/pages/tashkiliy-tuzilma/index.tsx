import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
  Pill,
  Landmark,
  Building2,
  Truck,
  Wallet,
  Users,
  Cpu,
  ClipboardCheck,
  Warehouse,
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
  founder: {
    card: "from-[#071E33] to-[#0B3A5C]",
    ring: "ring-[#071E33]/30",
    soft: "bg-[#0B3A5C]/10 text-[#0B3A5C]",
    line: "#94A3B8",
  },
  director: {
    card: "from-[#0B3A5C] to-[#145A8A]",
    ring: "ring-[#0B3A5C]/25",
    soft: "bg-[#0B3A5C]/10 text-[#0B3A5C]",
    line: "#94A3B8",
  },
  dept: {
    card: "from-[#334155] to-[#64748B]",
    ring: "ring-slate-500/25",
    soft: "bg-slate-500/10 text-slate-700",
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
  intern: {
    card: "from-[#4338CA] to-[#6366F1]",
    ring: "ring-indigo-500/25",
    soft: "bg-indigo-500/10 text-indigo-900",
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
  "admin",
  "director",
  "hr",
  "hr_direktor",
  "hr_auditor",
  "hr_menejer",
  "recruiter",
  "koordinator",
  "mudir",
  "farmasevt",
  "stajyor",
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
            id: `${prefix}-stajyor`,
            label: "Stajyor",
            hint: "O‘quv / amaliyot",
            tone: "intern",
            icon: GraduationCap,
          },
          {
            id: `${prefix}-farmasevt`,
            label: "Farmasevt",
            hint: "Smena / savdo",
            tone: "staff",
            icon: Pill,
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

function makeDeptHead(id: string, label: string, hint?: string): OrgNode {
  return {
    id,
    label,
    hint: hint || "Bo‘lim rahbari",
    tone: "lead",
    icon: Briefcase,
  };
}

const HR_TREE: OrgNode = {
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

const ORG_TREE: OrgNode = {
  id: "tasischi",
  label: "Ta’sischi",
  hint: "Muassis",
  tone: "founder",
  icon: Landmark,
  children: [
    {
      id: "direktor",
      label: "Direktor",
      hint: "Umumiy rahbar",
      tone: "director",
      icon: Building2,
      children: [
        {
          id: "taminot",
          label: "Ta’minot",
          hint: "Taminot bo‘limi",
          tone: "dept",
          icon: Truck,
          children: [makeDeptHead("taminot-boshliq", "Bo‘lim boshlig‘i")],
        },
        {
          id: "moliya",
          label: "Moliya",
          hint: "Moliya bo‘limi",
          tone: "dept",
          icon: Wallet,
          children: [makeDeptHead("moliya-boshliq", "Bo‘lim boshlig‘i")],
        },
        {
          id: "hr-bolimi",
          label: "HR bo‘limi",
          hint: "Kadrlar",
          tone: "dept",
          icon: Users,
          children: [HR_TREE],
        },
        {
          id: "cb-it",
          label: "CB va IT",
          hint: "Xavfsizlik / IT",
          tone: "dept",
          icon: Cpu,
          children: [
            makeDeptHead("cb-boshliq", "CB bo‘lim boshlig‘i", "Xavfsizlik"),
            makeDeptHead("it-boshliq", "IT bo‘lim boshlig‘i", "Texnika"),
          ],
        },
        {
          id: "reviziya",
          label: "Reviziya",
          hint: "Ichki audit",
          tone: "dept",
          icon: ClipboardCheck,
          children: [makeDeptHead("reviziya-boshliq", "Bo‘lim boshlig‘i")],
        },
        {
          id: "axo-gpp",
          label: "AXO va GPP",
          hint: "Ma’muriyat / GPP",
          tone: "dept",
          icon: Warehouse,
          children: [
            makeDeptHead("axo-boshliq", "AXO boshlig‘i", "Ma’muriyat"),
            makeDeptHead("gpp-boshliq", "GPP bo‘lim boshlig‘i", "Farmatsevtika amaliyoti"),
          ],
        },
      ],
    },
  ],
};

function collectEdges(node: OrgNode, edges: Array<[string, string]>) {
  if (node.mergePair) {
    edges.push([node.id, node.mergePair[0].id]);
    edges.push([node.id, node.mergePair[1].id]);
    for (const child of node.children ?? []) {
      edges.push([node.mergePair[0].id, child.id]);
      edges.push([node.mergePair[1].id, child.id]);
      collectEdges(child, edges);
    }
    return;
  }
  for (const child of node.children ?? []) {
    edges.push([node.id, child.id]);
    collectEdges(child, edges);
  }
}

const ORG_EDGES = (() => {
  const edges: Array<[string, string]> = [];
  collectEdges(ORG_TREE, edges);
  return edges;
})();

function orthoPath(x1: number, y1: number, x2: number, y2: number) {
  const midY = Math.round((y1 + y2) / 2);
  return `M ${x1} ${y1} L ${x1} ${midY} L ${x2} ${midY} L ${x2} ${y2}`;
}

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
      data-org-id={node.id}
      onClick={() => onSelect(node.id)}
      className={cn(
        "group relative z-[2] overflow-hidden rounded-2xl text-left shadow-[0_10px_28px_-14px_rgba(15,58,92,0.4)] transition-shadow duration-200",
        "hover:shadow-[0_16px_36px_-12px_rgba(15,58,92,0.45)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b3a5c]/40 focus-visible:ring-offset-2",
        highlight && cn("ring-2 ring-offset-2", tone.ring),
        size === "lg" && "min-w-[200px]",
        size === "md" && "min-w-[168px]",
        size === "sm" && "min-w-[148px]",
      )}
    >
      <div className={cn("bg-gradient-to-br p-[1.5px]", tone.card)}>
        <div className="rounded-[15px] bg-white">
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
    <div className="flex items-start justify-center gap-10 sm:gap-14">
      {[left, right].map((n) => (
        <div key={n.id} className="flex flex-col items-center pt-10">
          <NodeCard node={n} highlight={selectedId === n.id} onSelect={onSelect} size="sm" />
        </div>
      ))}
    </div>
  );
}

function OrgTree({
  node,
  selectedId,
  onSelect,
  depth = 0,
}: {
  node: OrgNode;
  selectedId: string | null;
  onSelect: (id: string) => void;
  depth?: number;
}) {
  const kids = node.children ?? [];
  const hasMerge = !!node.mergePair;
  const size = depth === 0 ? "lg" : depth <= 2 ? "md" : "sm";

  return (
    <div className="flex flex-col items-center">
      <NodeCard
        node={node}
        highlight={selectedId === node.id}
        onSelect={onSelect}
        size={size}
      />

      {(hasMerge || kids.length > 0) && (
        <div className="flex flex-col items-center pt-10">
          {hasMerge && node.mergePair ? (
            <>
              <MergePair
                left={node.mergePair[0]}
                right={node.mergePair[1]}
                selectedId={selectedId}
                onSelect={onSelect}
              />
              {kids.map((child) => (
                <div key={child.id} className="pt-10">
                  <OrgTree
                    node={child}
                    selectedId={selectedId}
                    onSelect={onSelect}
                    depth={depth + 1}
                  />
                </div>
              ))}
            </>
          ) : (
            <div className="flex items-start">
              {kids.map((child) => (
                <div
                  key={child.id}
                  className={cn(
                    "flex flex-col items-center",
                    kids.length > 4 ? "px-4 sm:px-6" : "px-7 sm:px-10 md:px-12",
                  )}
                >
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
        </div>
      )}
    </div>
  );
}

const LEGEND: { label: string; tone: ToneKey }[] = [
  { label: "Ta’sischi", tone: "founder" },
  { label: "Direktor / HR rahbariyat", tone: "director" },
  { label: "Bo‘limlar", tone: "dept" },
  { label: "Bo‘lim boshlig‘i", tone: "lead" },
  { label: "HR Menejer", tone: "manager" },
  { label: "Rekruter / Trener", tone: "specialist" },
  { label: "Koordinator", tone: "coord" },
  { label: "Filial mudiri", tone: "branch" },
  { label: "Stajyor", tone: "intern" },
  { label: "Farmasevt", tone: "staff" },
];

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 2.4;

export default function TashkiliyTuzilmaPage() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const [selectedId, setSelectedId] = useState<string | null>("tasischi");
  const [zoom, setZoom] = useState(0.55);
  const [pan, setPan] = useState({ x: 40, y: 40 });
  const [paths, setPaths] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);

  const viewportRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef(zoom);
  const panRef = useRef(pan);
  const dragRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const didFit = useRef(false);

  zoomRef.current = zoom;
  panRef.current = pan;

  const allowed = useMemo(() => (user?.role ? ALLOWED_ROLES.has(user.role) : false), [user?.role]);

  const redrawLines = useCallback(() => {
    const world = worldRef.current;
    if (!world) return;
    const z = zoomRef.current || 1;
    const wr = world.getBoundingClientRect();
    if (wr.width < 8) return;

    const box = (id: string) => {
      const el = world.querySelector(`[data-org-id="${id}"]`) as HTMLElement | null;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        cx: (r.left + r.width / 2 - wr.left) / z,
        top: (r.top - wr.top) / z,
        bottom: (r.bottom - wr.top) / z,
      };
    };

    const next: string[] = [];
    for (const [fromId, toId] of ORG_EDGES) {
      const a = box(fromId);
      const b = box(toId);
      if (!a || !b) continue;
      next.push(orthoPath(Math.round(a.cx), Math.round(a.bottom), Math.round(b.cx), Math.round(b.top)));
    }
    setPaths((prev) => {
      if (prev.length === next.length && prev.every((p, i) => p === next[i])) return prev;
      return next;
    });
  }, []);

  const fitToView = useCallback(() => {
    const vp = viewportRef.current;
    const world = worldRef.current;
    if (!vp || !world) return;
    if (vp.clientWidth < 80 || vp.clientHeight < 80) return;
    const zNow = zoomRef.current || 1;
    const wr = world.getBoundingClientRect();
    const naturalW = wr.width / zNow;
    const naturalH = wr.height / zNow;
    if (naturalW < 40 || naturalH < 40) return;
    const nextZ = Math.min(
      (vp.clientWidth - 72) / naturalW,
      (vp.clientHeight - 72) / naturalH,
      1,
    );
    const z = Math.max(MIN_ZOOM, Number(nextZ.toFixed(3)));
    const x = (vp.clientWidth - naturalW * z) / 2;
    const y = Math.max(28, (vp.clientHeight - naturalH * z) / 2);
    setZoom(z);
    setPan({ x, y });
  }, []);

  useLayoutEffect(() => {
    redrawLines();
  }, [zoom, pan, selectedId, allowed, redrawLines]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      redrawLines();
      if (!didFit.current) {
        didFit.current = true;
        fitToView();
      }
    }, 80);
    return () => window.clearTimeout(t);
  }, [allowed, redrawLines, fitToView]);

  useEffect(() => {
    if (user && !allowed) setLocation("/dashboard");
  }, [user, allowed, setLocation]);

  const applyZoomAt = useCallback((clientX: number, clientY: number, nextZoom: number) => {
    const vp = viewportRef.current;
    if (!vp) return;
    const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextZoom));
    const rect = vp.getBoundingClientRect();
    const mx = clientX - rect.left;
    const my = clientY - rect.top;
    const worldX = (mx - panRef.current.x) / zoomRef.current;
    const worldY = (my - panRef.current.y) / zoomRef.current;
    setZoom(Number(z.toFixed(3)));
    setPan({ x: mx - worldX * z, y: my - worldY * z });
  }, []);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest("button")) return;
    dragRef.current = {
      x: e.clientX,
      y: e.clientY,
      panX: panRef.current.x,
      panY: panRef.current.y,
    };
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    setPan({ x: d.panX + dx, y: d.panY + dy });
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = null;
    setDragging(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheelNative = (ev: WheelEvent) => {
      if (!(ev.ctrlKey || ev.metaKey)) return;
      ev.preventDefault();
      const factor = ev.deltaY > 0 ? 0.92 : 1.08;
      applyZoomAt(ev.clientX, ev.clientY, zoomRef.current * factor);
    };
    el.addEventListener("wheel", onWheelNative, { passive: false });
    return () => el.removeEventListener("wheel", onWheelNative);
  }, [allowed, applyZoomAt]);

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
              Sichqoncha bilan ushlab siljiting. Ctrl + g‘ildirak — yaqinlashtirish. Kartani bosing —
              lavozim ajralib ko‘rinadi.
            </p>
          </div>

          <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white p-1.5 shadow-sm">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-9 w-9"
              onClick={() =>
                applyZoomAt(
                  (viewportRef.current?.getBoundingClientRect().left ?? 0) +
                    (viewportRef.current?.clientWidth ?? 0) / 2,
                  (viewportRef.current?.getBoundingClientRect().top ?? 0) +
                    (viewportRef.current?.clientHeight ?? 0) / 2,
                  zoomRef.current - 0.1,
                )
              }
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
              onClick={() =>
                applyZoomAt(
                  (viewportRef.current?.getBoundingClientRect().left ?? 0) +
                    (viewportRef.current?.clientWidth ?? 0) / 2,
                  (viewportRef.current?.getBoundingClientRect().top ?? 0) +
                    (viewportRef.current?.clientHeight ?? 0) / 2,
                  zoomRef.current + 0.1,
                )
              }
              aria-label="Kattalashtirish"
            >
              <ZoomIn className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-9 w-9"
              onClick={() => fitToView()}
              aria-label="Ekranga sig‘dirish"
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

      <div
        ref={viewportRef}
        className={cn(
          "relative min-h-0 flex-1 overflow-hidden touch-none",
          dragging ? "cursor-grabbing" : "cursor-grab",
        )}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              "radial-gradient(ellipse 80% 50% at 50% -10%, rgba(11,58,92,0.08), transparent 55%), radial-gradient(circle at 1px 1px, rgba(15,58,92,0.07) 1px, transparent 0)",
            backgroundSize: "auto, 28px 28px",
          }}
        />
        <div
          className="absolute left-0 top-0"
          style={{
            transform: `translate(${Math.round(pan.x)}px, ${Math.round(pan.y)}px)`,
          }}
        >
          <div
            ref={worldRef}
            className="relative w-max [text-rendering:geometricPrecision]"
            style={{ zoom }}
          >
            <svg
              className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
              aria-hidden
            >
              {paths.map((d, i) => (
                <path
                  key={i}
                  d={d}
                  fill="none"
                  stroke="#0B3A5C"
                  strokeOpacity="0.45"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  shapeRendering="geometricPrecision"
                />
              ))}
            </svg>
            <div className="relative p-8 sm:p-10">
              <OrgTree node={ORG_TREE} selectedId={selectedId} onSelect={setSelectedId} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
