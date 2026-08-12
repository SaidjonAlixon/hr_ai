import React, { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { Network, ZoomIn, ZoomOut, Maximize2 } from "lucide-react";
import { Button } from "@/components/ui/button";

type OrgNode = {
  id: string;
  label: string;
  tone: keyof typeof TONES;
  children?: OrgNode[];
};

const TONES = {
  orange: {
    bg: "bg-[#F4A261]",
    border: "border-[#E08E4A]",
    text: "text-[#3D2314]",
  },
  blue: {
    bg: "bg-[#7EB6D9]",
    border: "border-[#5A9BC4]",
    text: "text-[#0F2F44]",
  },
  purple: {
    bg: "bg-[#B08FD8]",
    border: "border-[#9470C4]",
    text: "text-[#2A1842]",
  },
  teal: {
    bg: "bg-[#6EC9B8]",
    border: "border-[#4DAF9C]",
    text: "text-[#0E332C]",
  },
  sky: {
    bg: "bg-[#7DB7E0]",
    border: "border-[#5A9BC8]",
    text: "text-[#0F2F44]",
  },
  sand: {
    bg: "bg-[#E2C9A0]",
    border: "border-[#C9AD7E]",
    text: "text-[#3D2E14]",
  },
  green: {
    bg: "bg-[#9ED4B0]",
    border: "border-[#78B98E]",
    text: "text-[#163222]",
  },
  rose: {
    bg: "bg-[#F0A8A0]",
    border: "border-[#D88A82]",
    text: "text-[#3D1A16]",
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

function makePharmacyChain(prefix: string): OrgNode {
  return {
    id: `${prefix}-koordinator`,
    label: "Koordinator",
    tone: "teal",
    children: [
      {
        id: `${prefix}-filyal`,
        label: "Filyal",
        tone: "sky",
        children: [
          {
            id: `${prefix}-mudir`,
            label: "Mudir",
            tone: "sand",
            children: [
              {
                id: `${prefix}-boshqaruvchi`,
                label: "Boshqaruvchi",
                tone: "green",
                children: [
                  { id: `${prefix}-farmasevt-1`, label: "Farmasevt", tone: "rose" },
                  { id: `${prefix}-farmasevt-2`, label: "Farmasevt", tone: "rose" },
                ],
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
    tone: "blue",
    children: [
      {
        id: `rekruter-${n}`,
        label: "Rekruter",
        tone: "purple",
        children: [makePharmacyChain(`r${n}`)],
      },
      {
        id: `trener-${n}`,
        label: "Trener",
        tone: "purple",
        children: [makePharmacyChain(`t${n}`)],
      },
    ],
  };
}

const ORG_TREE: OrgNode = {
  id: "hr-direktor",
  label: "HR Direktor",
  tone: "orange",
  children: [
    {
      id: "hr-auditor",
      label: "HR Auditor",
      tone: "orange",
      children: [makeManagerBranch(1), makeManagerBranch(2)],
    },
  ],
};

function NodeCard({
  node,
  highlight,
  onSelect,
}: {
  node: OrgNode;
  highlight: boolean;
  onSelect: (id: string) => void;
}) {
  const tone = TONES[node.tone];
  return (
    <button
      type="button"
      onClick={() => onSelect(node.id)}
      className={cn(
        "relative z-[2] min-w-[120px] rounded-xl border-2 px-3.5 py-2.5 text-center text-[13px] font-semibold shadow-sm transition-all duration-200",
        "hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b3a5c]/40",
        tone.bg,
        tone.border,
        tone.text,
        highlight && "ring-2 ring-[#0b3a5c] ring-offset-2 scale-[1.03]",
      )}
    >
      {node.label}
    </button>
  );
}

function OrgTree({
  node,
  selectedId,
  onSelect,
  isRoot = false,
}: {
  node: OrgNode;
  selectedId: string | null;
  onSelect: (id: string) => void;
  isRoot?: boolean;
}) {
  const kids = node.children ?? [];

  return (
    <div className={cn("flex flex-col items-center", !isRoot && "pt-0")}>
      <NodeCard node={node} highlight={selectedId === node.id} onSelect={onSelect} />

      {kids.length > 0 && (
        <>
          <div className="h-6 w-px bg-slate-300" />
          <div className="relative flex items-start">
            {kids.length > 1 && (
              <div
                className="pointer-events-none absolute top-0 h-px bg-slate-300"
                style={{
                  left: `calc(100% / ${kids.length * 2})`,
                  right: `calc(100% / ${kids.length * 2})`,
                }}
              />
            )}
            {kids.map((child) => (
              <div key={child.id} className="flex flex-col items-center px-2 sm:px-3 md:px-4">
                {kids.length > 1 && <div className="h-6 w-px bg-slate-300" />}
                <OrgTree node={child} selectedId={selectedId} onSelect={onSelect} />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

const LEGEND: { label: string; tone: keyof typeof TONES }[] = [
  { label: "HR rahbariyat", tone: "orange" },
  { label: "HR Menejer", tone: "blue" },
  { label: "Rekruter / Trener", tone: "purple" },
  { label: "Koordinator", tone: "teal" },
  { label: "Filyal", tone: "sky" },
  { label: "Mudir", tone: "sand" },
  { label: "Boshqaruvchi", tone: "green" },
  { label: "Farmasevt", tone: "rose" },
];

export default function TashkiliyTuzilmaPage() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(0.8);

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
    <div className="flex h-full min-h-[calc(100vh-4rem)] flex-col bg-[#F3F5F8]">
      <div className="shrink-0 border-b border-slate-200/80 bg-white/90 px-4 py-4 backdrop-blur sm:px-6">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-start justify-between gap-4">
          <div>
            <div className="mb-1 flex items-center gap-2 text-[#0b3a5c]">
              <Network className="h-5 w-5" />
              <span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                VAKSINA MED
              </span>
            </div>
            <h1 className="font-serif text-2xl font-semibold tracking-tight text-[#0b3a5c] sm:text-3xl">
              Tashkiliy tuzilma
            </h1>
            <p className="mt-1 max-w-xl text-sm text-slate-500">
              HR → filial → mudir → boshqaruvchi → farmasevt. Har bir boshqaruvchi ostida 2 ta
              farmasevt.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-9 w-9"
              onClick={() => setZoom((z) => Math.max(0.4, Number((z - 0.1).toFixed(2))))}
              aria-label="Kichiklashtirish"
            >
              <ZoomOut className="h-4 w-4" />
            </Button>
            <span className="min-w-[3.25rem] text-center text-xs font-medium text-slate-500">
              {Math.round(zoom * 100)}%
            </span>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-9 w-9"
              onClick={() => setZoom((z) => Math.min(1.4, Number((z + 0.1).toFixed(2))))}
              aria-label="Kattalashtirish"
            >
              <ZoomIn className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-9 w-9"
              onClick={() => setZoom(0.8)}
              aria-label="Qayta o‘lchash"
            >
              <Maximize2 className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="mx-auto mt-4 flex max-w-[1600px] flex-wrap gap-2">
          {LEGEND.map((item) => (
            <span
              key={item.label}
              className={cn(
                "inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium",
                TONES[item.tone].bg,
                TONES[item.tone].border,
                TONES[item.tone].text,
              )}
            >
              {item.label}
            </span>
          ))}
        </div>
      </div>

      <div className="relative min-h-0 flex-1 overflow-auto">
        <div
          className="pointer-events-none absolute inset-0 opacity-40"
          style={{
            backgroundImage:
              "radial-gradient(circle at 1px 1px, rgba(15,58,92,0.09) 1px, transparent 0)",
            backgroundSize: "22px 22px",
          }}
        />
        <div className="relative flex min-h-full min-w-max items-start justify-center px-8 py-10">
          <div
            className="origin-top transition-transform duration-300 ease-out"
            style={{ transform: `scale(${zoom})` }}
          >
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
  );
}
