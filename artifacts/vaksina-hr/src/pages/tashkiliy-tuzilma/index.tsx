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
  User,
  Shield,
  MonitorSmartphone,
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
    ink: "#071E33",
    fill: "from-[#071E33] via-[#0B3A5C] to-[#145A8A]",
    soft: "bg-[#0B3A5C]/10 text-[#0B3A5C]",
    chip: "bg-[#0B3A5C]/10 text-[#0B3A5C]",
  },
  director: {
    ink: "#0B3A5C",
    fill: "from-[#0B3A5C] to-[#1D6AA5]",
    soft: "bg-[#0B3A5C]/10 text-[#0B3A5C]",
    chip: "bg-[#0B3A5C]/10 text-[#0B3A5C]",
  },
  taminot: {
    ink: "#C2410C",
    fill: "from-[#C2410C] to-[#EA580C]",
    soft: "bg-orange-50 text-orange-800",
    chip: "bg-orange-100 text-orange-700",
    lane: "bg-orange-50/80 ring-orange-200/80",
  },
  moliya: {
    ink: "#047857",
    fill: "from-[#047857] to-[#10B981]",
    soft: "bg-emerald-50 text-emerald-800",
    chip: "bg-emerald-100 text-emerald-700",
    lane: "bg-emerald-50/80 ring-emerald-200/80",
  },
  hrDept: {
    ink: "#1D4E89",
    fill: "from-[#1D4E89] to-[#3B82C4]",
    soft: "bg-sky-50 text-sky-900",
    chip: "bg-sky-100 text-sky-800",
    lane: "bg-sky-50/80 ring-sky-200/80",
  },
  cbit: {
    ink: "#0E7490",
    fill: "from-[#0E7490] to-[#22D3EE]",
    soft: "bg-cyan-50 text-cyan-900",
    chip: "bg-cyan-100 text-cyan-800",
    lane: "bg-cyan-50/80 ring-cyan-200/80",
  },
  reviziya: {
    ink: "#6D28D9",
    fill: "from-[#6D28D9] to-[#A78BFA]",
    soft: "bg-violet-50 text-violet-900",
    chip: "bg-violet-100 text-violet-800",
    lane: "bg-violet-50/80 ring-violet-200/80",
  },
  axogpp: {
    ink: "#BE185D",
    fill: "from-[#BE185D] to-[#F472B6]",
    soft: "bg-pink-50 text-pink-900",
    chip: "bg-pink-100 text-pink-800",
    lane: "bg-pink-50/80 ring-pink-200/80",
  },
  manager: {
    ink: "#1D4E89",
    fill: "from-[#1D4E89] to-[#2E6FAF]",
    soft: "bg-[#1D4E89]/10 text-[#1D4E89]",
    chip: "bg-[#1D4E89]/10 text-[#1D4E89]",
  },
  specialist: {
    ink: "#5B4B8A",
    fill: "from-[#5B4B8A] to-[#7A68B0]",
    soft: "bg-[#5B4B8A]/10 text-[#5B4B8A]",
    chip: "bg-[#5B4B8A]/10 text-[#5B4B8A]",
  },
  coord: {
    ink: "#0F766E",
    fill: "from-[#0F766E] to-[#14B8A6]",
    soft: "bg-teal-50 text-teal-800",
    chip: "bg-teal-50 text-teal-700",
  },
  branch: {
    ink: "#9A6B3F",
    fill: "from-[#9A6B3F] to-[#C48A54]",
    soft: "bg-amber-50 text-amber-900",
    chip: "bg-amber-50 text-amber-800",
  },
  lead: {
    ink: "#2F6B4F",
    fill: "from-[#2F6B4F] to-[#3F8F6A]",
    soft: "bg-emerald-50 text-emerald-900",
    chip: "bg-emerald-50 text-emerald-800",
  },
  intern: {
    ink: "#4338CA",
    fill: "from-[#4338CA] to-[#6366F1]",
    soft: "bg-indigo-50 text-indigo-900",
    chip: "bg-indigo-50 text-indigo-700",
  },
  staff: {
    ink: "#B4535A",
    fill: "from-[#B4535A] to-[#D4737A]",
    soft: "bg-rose-50 text-rose-900",
    chip: "bg-rose-50 text-rose-800",
  },
} as const;

const DEPT_TONES = new Set<ToneKey>(["taminot", "moliya", "hrDept", "cbit", "reviziya", "axogpp"]);

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

function makeDeptStaff(id: string, hint: string, tone: ToneKey, icon = User): OrgNode {
  return {
    id,
    label: "Bo‘lim xodimi",
    hint,
    tone,
    icon,
  };
}

function makeDeptHead(
  id: string,
  label: string,
  hint: string,
  staffHint: string,
  tone: ToneKey,
  staffIcon?: React.ComponentType<{ className?: string }>,
): OrgNode {
  return {
    id,
    label,
    hint,
    tone,
    icon: Briefcase,
    children: [makeDeptStaff(`${id}-xodim`, staffHint, tone, staffIcon)],
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
          hint: "Logistika",
          tone: "taminot",
          icon: Truck,
          children: [
            makeDeptHead(
              "taminot-boshliq",
              "Bo‘lim boshlig‘i",
              "Ta’minot rahbari",
              "Logistika",
              "taminot",
              Truck,
            ),
          ],
        },
        {
          id: "moliya",
          label: "Moliya",
          hint: "Moliya bo‘limi",
          tone: "moliya",
          icon: Wallet,
          children: [
            makeDeptHead(
              "moliya-boshliq",
              "Bo‘lim boshlig‘i",
              "Moliya rahbari",
              "Hisob-kitob",
              "moliya",
              Wallet,
            ),
          ],
        },
        {
          id: "hr-bolimi",
          label: "HR bo‘limi",
          hint: "Kadrlar",
          tone: "hrDept",
          icon: Users,
          children: [HR_TREE],
        },
        {
          id: "cb-it",
          label: "CB va IT",
          hint: "Xavfsizlik / IT",
          tone: "cbit",
          icon: Cpu,
          children: [
            makeDeptHead("cb-boshliq", "CB bo‘lim boshlig‘i", "Xavfsizlik", "Nazorat xodimi", "cbit", Shield),
            makeDeptHead(
              "it-boshliq",
              "IT bo‘lim boshlig‘i",
              "Texnika",
              "IT mutaxassisi",
              "cbit",
              MonitorSmartphone,
            ),
          ],
        },
        {
          id: "reviziya",
          label: "Reviziya",
          hint: "Ichki audit",
          tone: "reviziya",
          icon: ClipboardCheck,
          children: [
            makeDeptHead(
              "reviziya-boshliq",
              "Bo‘lim boshlig‘i",
              "Reviziya rahbari",
              "Ichki auditor",
              "reviziya",
              ClipboardCheck,
            ),
          ],
        },
        {
          id: "axo-gpp",
          label: "AXO va GPP",
          hint: "Ma’muriyat / GPP",
          tone: "axogpp",
          icon: Warehouse,
          children: [
            makeDeptHead("axo-boshliq", "AXO boshlig‘i", "Ma’muriyat", "AXO xodimi", "axogpp", Warehouse),
            makeDeptHead(
              "gpp-boshliq",
              "GPP bo‘lim boshlig‘i",
              "Farmatsevtika amaliyoti",
              "GPP mutaxassisi",
              "axogpp",
              Pill,
            ),
          ],
        },
      ],
    },
  ],
};

type OrgBus = { from: string[]; to: string[] };

function collectBuses(node: OrgNode, buses: OrgBus[]) {
  if (node.mergePair) {
    buses.push({ from: [node.id], to: [node.mergePair[0].id, node.mergePair[1].id] });
    const kids = node.children ?? [];
    if (kids.length) {
      buses.push({ from: [node.mergePair[0].id, node.mergePair[1].id], to: kids.map((k) => k.id) });
    }
    for (const child of kids) collectBuses(child, buses);
    return;
  }
  const kids = node.children ?? [];
  if (kids.length) {
    buses.push({ from: [node.id], to: kids.map((k) => k.id) });
    for (const child of kids) collectBuses(child, buses);
  }
}

const ORG_BUSES = (() => {
  const buses: OrgBus[] = [];
  collectBuses(ORG_TREE, buses);
  return buses;
})();

type Box = { cx: number; top: number; bottom: number };

function drawBus(from: Box[], to: Box[]) {
  const lines: string[] = [];
  const dots: Array<[number, number]> = [];
  if (!from.length || !to.length) return { lines, dots };

  const parentBottom = Math.max(...from.map((b) => b.bottom));
  const childTop = Math.min(...to.map((b) => b.top));
  const busY = Math.round(parentBottom + (childTop - parentBottom) * 0.48);
  const xs = [...from.map((b) => b.cx), ...to.map((b) => b.cx)];
  const minX = Math.round(Math.min(...xs));
  const maxX = Math.round(Math.max(...xs));

  for (const a of from) {
    const x = Math.round(a.cx);
    lines.push(`M ${x} ${Math.round(a.bottom)} L ${x} ${busY}`);
    dots.push([x, Math.round(a.bottom)]);
  }
  if (maxX - minX > 2) {
    lines.push(`M ${minX} ${busY} L ${maxX} ${busY}`);
  }
  dots.push([Math.round((minX + maxX) / 2), busY]);
  for (const b of to) {
    const x = Math.round(b.cx);
    lines.push(`M ${x} ${busY} L ${x} ${Math.round(b.top)}`);
    dots.push([x, Math.round(b.top)]);
  }
  return { lines, dots };
}

function findNode(node: OrgNode, id: string): OrgNode | null {
  if (node.id === id) return node;
  if (node.mergePair) {
    for (const side of node.mergePair) {
      const hit = findNode(side, id);
      if (hit) return hit;
    }
  }
  for (const child of node.children ?? []) {
    const hit = findNode(child, id);
    if (hit) return hit;
  }
  return null;
}

function findParent(node: OrgNode, id: string, parent: OrgNode | null = null): OrgNode | null {
  if (node.id === id) return parent;
  if (node.mergePair) {
    for (const side of node.mergePair) {
      const hit = findParent(side, id, node);
      if (hit) return hit;
    }
  }
  for (const child of node.children ?? []) {
    const hit = findParent(child, id, node);
    if (hit) return hit;
  }
  return null;
}

function childSummaries(node: OrgNode): string[] {
  const names: string[] = [];
  if (node.mergePair) names.push(node.mergePair[0].label, node.mergePair[1].label);
  for (const child of node.children ?? []) names.push(child.label);
  return names;
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
  const exec = node.id === "tasischi" || node.id === "direktor";
  const dept = DEPT_TONES.has(node.tone);

  return (
    <button
      type="button"
      data-org-id={node.id}
      onClick={() => onSelect(node.id)}
      className={cn(
        "group relative z-[2] text-left transition-shadow duration-200",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b3a5c]/35 focus-visible:ring-offset-2",
        exec && "min-w-[228px] rounded-[22px]",
        dept && "min-w-[188px] rounded-[18px]",
        !exec && !dept && "rounded-[16px]",
        !exec && size === "lg" && "min-w-[200px]",
        !exec && size === "md" && "min-w-[176px]",
        !exec && size === "sm" && "min-w-[158px]",
        highlight && "ring-2 ring-offset-2",
        highlight && (exec ? "ring-white/70" : "ring-[#0b3a5c]/25"),
      )}
    >
      {exec ? (
        <div
          className={cn(
            "relative overflow-hidden rounded-[22px] bg-gradient-to-br px-4 py-3.5 text-white shadow-[0_18px_40px_-18px_rgba(7,30,51,0.7)]",
            tone.fill,
          )}
        >
          <div className="pointer-events-none absolute -right-6 -top-8 h-24 w-24 rounded-full bg-white/10" />
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/20">
              <Icon className="h-5 w-5" />
            </span>
            <span className="min-w-0">
              <span className="block text-[15px] font-semibold leading-tight tracking-tight">{node.label}</span>
              {node.hint ? (
                <span className="mt-0.5 block text-[11px] text-white/75">{node.hint}</span>
              ) : null}
            </span>
          </div>
        </div>
      ) : dept ? (
        <div
          className={cn(
            "overflow-hidden rounded-[18px] shadow-[0_10px_28px_-16px_rgba(15,58,92,0.35)] ring-1 ring-black/5",
            tone.soft,
          )}
        >
          <div className={cn("h-1.5 bg-gradient-to-r", tone.fill)} />
          <div className="flex items-center gap-3 px-3.5 py-3">
            <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", tone.chip)}>
              <Icon className="h-5 w-5" />
            </span>
            <span className="min-w-0">
              <span className="block text-[8px] font-semibold uppercase tracking-[0.16em] text-slate-400">Bo‘lim</span>
              <span className="block text-[14px] font-semibold leading-tight text-slate-900">{node.label}</span>
              {node.hint ? <span className="mt-0.5 block text-[11px] text-slate-500">{node.hint}</span> : null}
            </span>
          </div>
        </div>
      ) : (
        <div className="relative overflow-hidden rounded-[16px] bg-white shadow-[0_8px_24px_-16px_rgba(15,58,92,0.38)] ring-1 ring-slate-200/70 transition-shadow group-hover:shadow-[0_14px_30px_-16px_rgba(15,58,92,0.42)]">
          <span className={cn("absolute inset-y-0 left-0 w-[3px] bg-gradient-to-b", tone.fill)} />
          <div className="flex items-center gap-2.5 py-2.5 pl-3.5 pr-3">
            <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", tone.chip)}>
              <Icon className="h-4 w-4" />
            </span>
            <span className="min-w-0">
              <span className="block text-[13px] font-semibold leading-tight tracking-tight text-slate-900">
                {node.label}
              </span>
              {node.hint ? (
                <span className="mt-0.5 block text-[11px] leading-tight text-slate-500">{node.hint}</span>
              ) : null}
            </span>
          </div>
        </div>
      )}
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
    <div className="flex items-start justify-center gap-8 sm:gap-12">
      {[left, right].map((n) => (
        <div key={n.id} className="flex flex-col items-center pt-14">
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
  const lanes = node.id === "direktor";

  return (
    <div className="flex flex-col items-center">
      <NodeCard node={node} highlight={selectedId === node.id} onSelect={onSelect} size={size} />

      {(hasMerge || kids.length > 0) && (
        <div className="flex flex-col items-center pt-14">
          {hasMerge && node.mergePair ? (
            <>
              <MergePair
                left={node.mergePair[0]}
                right={node.mergePair[1]}
                selectedId={selectedId}
                onSelect={onSelect}
              />
              {kids.map((child) => (
                <div key={child.id} className="pt-14">
                  <OrgTree node={child} selectedId={selectedId} onSelect={onSelect} depth={depth + 1} />
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
                    lanes
                      ? cn(
                          "mx-2 rounded-[26px] px-4 pb-6 pt-4 shadow-[0_12px_40px_-28px_rgba(15,58,92,0.45)] ring-1",
                          "lane" in TONES[child.tone] ? TONES[child.tone].lane : "bg-white/70 ring-white/80",
                        )
                      : kids.length > 4
                        ? "px-4 sm:px-5"
                        : "px-6 sm:px-8 md:px-10",
                  )}
                >
                  <OrgTree node={child} selectedId={selectedId} onSelect={onSelect} depth={depth + 1} />
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
  { label: "Ta’minot", tone: "taminot" },
  { label: "Moliya", tone: "moliya" },
  { label: "HR bo‘limi", tone: "hrDept" },
  { label: "CB va IT", tone: "cbit" },
  { label: "Reviziya", tone: "reviziya" },
  { label: "AXO va GPP", tone: "axogpp" },
];

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 2.4;

export default function TashkiliyTuzilmaPage() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const [selectedId, setSelectedId] = useState<string | null>("tasischi");
  const [zoom, setZoom] = useState(0.55);
  const [pan, setPan] = useState({ x: 40, y: 40 });
  const [paths, setPaths] = useState<{ lines: string[]; dots: Array<[number, number]> }>({
    lines: [],
    dots: [],
  });
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
  const selected = useMemo(() => (selectedId ? findNode(ORG_TREE, selectedId) : null), [selectedId]);
  const parent = useMemo(() => (selectedId ? findParent(ORG_TREE, selectedId) : null), [selectedId]);

  const redrawLines = useCallback(() => {
    const world = worldRef.current;
    if (!world) return;
    const wr = world.getBoundingClientRect();
    if (wr.width < 8 || world.offsetWidth < 8) return;
    const z = wr.width / world.offsetWidth;

    const box = (id: string): Box | null => {
      const el = world.querySelector(`[data-org-id="${id}"]`) as HTMLElement | null;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        cx: (r.left + r.width / 2 - wr.left) / z,
        top: (r.top - wr.top) / z,
        bottom: (r.bottom - wr.top) / z,
      };
    };

    const lines: string[] = [];
    const dots: Array<[number, number]> = [];
    for (const bus of ORG_BUSES) {
      const from = bus.from.map(box).filter((b): b is Box => !!b);
      const to = bus.to.map(box).filter((b): b is Box => !!b);
      if (from.length !== bus.from.length || to.length !== bus.to.length) continue;
      const drawn = drawBus(from, to);
      lines.push(...drawn.lines);
      dots.push(...drawn.dots);
    }
    setPaths((prev) => {
      if (
        prev.lines.length === lines.length &&
        prev.dots.length === dots.length &&
        prev.lines.every((d, i) => d === lines[i]) &&
        prev.dots.every((d, i) => d[0] === dots[i][0] && d[1] === dots[i][1])
      ) {
        return prev;
      }
      return { lines, dots };
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
    const nextZ = Math.min((vp.clientWidth - 64) / naturalW, (vp.clientHeight - 64) / naturalH, 1);
    const z = Math.max(MIN_ZOOM, Number(nextZ.toFixed(3)));
    const x = (vp.clientWidth - naturalW * z) / 2;
    const y = Math.max(24, (vp.clientHeight - naturalH * z) / 2);
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
    const onResize = () => redrawLines();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [redrawLines]);

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

  const zoomFromCenter = (next: number) => {
    const vp = viewportRef.current;
    if (!vp) return;
    const r = vp.getBoundingClientRect();
    applyZoomAt(r.left + r.width / 2, r.top + r.height / 2, next);
  };

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
    setPan({ x: d.panX + (e.clientX - d.x), y: d.panY + (e.clientY - d.y) });
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
      applyZoomAt(ev.clientX, ev.clientY, zoomRef.current * (ev.deltaY > 0 ? 0.92 : 1.08));
    };
    el.addEventListener("wheel", onWheelNative, { passive: false });
    return () => el.removeEventListener("wheel", onWheelNative);
  }, [allowed, applyZoomAt]);

  if (!user || !allowed) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-slate-500">Ruxsat yo‘q…</div>
    );
  }

  const reports = selected ? childSummaries(selected) : [];

  return (
    <div className="flex h-full min-h-[calc(100vh-4rem)] flex-col bg-[#E8EEF4]">
      <div className="shrink-0 border-b border-slate-200/80 bg-white/90 px-4 py-3.5 backdrop-blur-xl sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="mb-1 inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
              <Network className="h-3.5 w-3.5 text-[#0b3a5c]" />
              VAKSINA MED
            </div>
            <h1 className="text-xl font-semibold tracking-tight text-[#0b3a5c] sm:text-2xl">Tashkiliy tuzilma</h1>
          </div>
          <p className="max-w-md text-xs leading-relaxed text-slate-500 sm:text-sm">
            Ushlab siljiting · Ctrl + g‘ildirak — zoom · kartani bosing
          </p>
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
              "radial-gradient(ellipse 70% 45% at 50% -8%, rgba(11,58,92,0.09), transparent 55%), radial-gradient(circle at 1px 1px, rgba(15,58,92,0.06) 1px, transparent 0)",
            backgroundSize: "auto, 26px 26px",
          }}
        />

        <div
          className="absolute left-0 top-0"
          style={{ transform: `translate(${Math.round(pan.x)}px, ${Math.round(pan.y)}px)` }}
        >
          <div
            ref={worldRef}
            className="relative w-max [text-rendering:geometricPrecision]"
            style={{ zoom }}
          >
            <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" aria-hidden>
              {paths.lines.map((d, i) => (
                <path
                  key={`h-${i}`}
                  d={d}
                  fill="none"
                  stroke="#F8FAFC"
                  strokeWidth="8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ))}
              {paths.lines.map((d, i) => (
                <path
                  key={`l-${i}`}
                  d={d}
                  fill="none"
                  stroke="#0B3A5C"
                  strokeOpacity="0.92"
                  strokeWidth="3.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  shapeRendering="geometricPrecision"
                />
              ))}
              {paths.dots.map(([x, y], i) => (
                <circle key={`d-${i}`} cx={x} cy={y} r="3.5" fill="#0B3A5C" stroke="#F8FAFC" strokeWidth="1.5" />
              ))}
            </svg>
            <div className="relative px-10 py-12">
              <OrgTree node={ORG_TREE} selectedId={selectedId} onSelect={setSelectedId} />
            </div>
          </div>
        </div>

        {selected ? (
          <aside className="pointer-events-none absolute bottom-4 left-4 z-10 w-[min(100%-2rem,280px)] rounded-2xl border border-white/80 bg-white/92 p-4 shadow-[0_18px_50px_-28px_rgba(15,58,92,0.55)] backdrop-blur-md sm:bottom-5 sm:left-5">
            <div className="flex items-start gap-3">
              <span
                className={cn(
                  "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
                  TONES[selected.tone].chip,
                )}
              >
                <selected.icon className="h-[18px] w-[18px]" />
              </span>
              <div className="min-w-0">
                <p className="text-[15px] font-semibold leading-tight text-slate-900">{selected.label}</p>
                {selected.hint ? <p className="mt-0.5 text-[12px] text-slate-500">{selected.hint}</p> : null}
              </div>
            </div>
            <dl className="mt-3 space-y-1.5 text-[12px]">
              <div className="flex justify-between gap-3">
                <dt className="text-slate-400">Hisobot</dt>
                <dd className="text-right font-medium text-slate-700">{parent?.label ?? "—"}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-slate-400">Ostida</dt>
                <dd className="text-right font-medium text-slate-700">
                  {reports.length ? reports.join(", ") : "—"}
                </dd>
              </div>
            </dl>
          </aside>
        ) : null}

        <div className="absolute bottom-4 right-4 z-10 flex flex-col items-end gap-2 sm:bottom-5 sm:right-5">
          <div className="hidden max-w-[420px] flex-wrap justify-end gap-1.5 rounded-2xl border border-white/80 bg-white/90 p-2 shadow-sm backdrop-blur-md md:flex">
            {LEGEND.map((item) => (
              <span
                key={item.label}
                className="inline-flex items-center gap-1.5 rounded-full bg-slate-50 px-2 py-1 text-[10px] font-medium text-slate-600"
              >
                <span className={cn("h-1.5 w-1.5 rounded-full bg-gradient-to-br", TONES[item.tone].fill)} />
                {item.label}
              </span>
            ))}
          </div>
          <div className="flex items-center gap-1 rounded-2xl border border-white/80 bg-white/95 p-1.5 shadow-[0_12px_32px_-18px_rgba(15,58,92,0.5)] backdrop-blur-md">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-9 w-9"
              onClick={() => zoomFromCenter(zoomRef.current - 0.1)}
              aria-label="Kichiklashtirish"
            >
              <ZoomOut className="h-4 w-4" />
            </Button>
            <span className="min-w-[3.25rem] text-center text-xs font-semibold tabular-nums text-slate-600">
              {Math.round(zoom * 100)}%
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-9 w-9"
              onClick={() => zoomFromCenter(zoomRef.current + 0.1)}
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
      </div>
    </div>
  );
}
