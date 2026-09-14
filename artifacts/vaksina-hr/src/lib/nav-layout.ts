import type { ComponentType } from "react";

/** Sidebar menyu tartibi — localStorage da foydalanuvchi bo‘yicha saqlanadi */

export type NavLayoutState = {
  version: 1;
  /** Bo‘limlar tartibi */
  sectionOrder: string[];
  /** path → bo‘lim id */
  placement: Record<string, string>;
  /** bo‘lim id → pathlar tartibi */
  orders: Record<string, string[]>;
};

export type NavLayoutItem = {
  name: string;
  path: string;
  icon: ComponentType<{ className?: string }>;
};

export type NavLayoutSection = {
  id: string;
  label: string;
  items: NavLayoutItem[];
  icon: ComponentType<{ className?: string }>;
};

const STORAGE_PREFIX = "vaksina-nav-layout-v1";

export function navLayoutStorageKey(userId?: number | string | null) {
  return userId != null ? `${STORAGE_PREFIX}:${userId}` : STORAGE_PREFIX;
}

export function loadNavLayout(userId?: number | string | null): NavLayoutState | null {
  try {
    const raw = localStorage.getItem(navLayoutStorageKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as NavLayoutState;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.sectionOrder)) return null;
    if (!parsed.placement || typeof parsed.placement !== "object") return null;
    if (!parsed.orders || typeof parsed.orders !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveNavLayout(layout: NavLayoutState, userId?: number | string | null) {
  try {
    localStorage.setItem(navLayoutStorageKey(userId), JSON.stringify(layout));
  } catch {
    /* ignore quota */
  }
}

export function clearNavLayout(userId?: number | string | null) {
  try {
    localStorage.removeItem(navLayoutStorageKey(userId));
  } catch {
    /* ignore */
  }
}

export function layoutFromSections(sections: NavLayoutSection[]): NavLayoutState {
  const placement: Record<string, string> = {};
  const orders: Record<string, string[]> = {};
  for (const s of sections) {
    orders[s.id] = s.items.map((i) => i.path);
    for (const item of s.items) placement[item.path] = s.id;
  }
  return {
    version: 1,
    sectionOrder: sections.map((s) => s.id),
    placement,
    orders,
  };
}

export function applyNavLayout(
  defaultSections: NavLayoutSection[],
  layout: NavLayoutState | null,
  opts?: { keepEmpty?: boolean },
): NavLayoutSection[] {
  if (!layout) return defaultSections;

  const itemByPath = new Map<string, NavLayoutItem>();
  const sectionMeta = new Map<string, Pick<NavLayoutSection, "label" | "icon">>();
  const defaultPlacement = new Map<string, string>();

  for (const s of defaultSections) {
    sectionMeta.set(s.id, { label: s.label, icon: s.icon });
    for (const item of s.items) {
      itemByPath.set(item.path, item);
      defaultPlacement.set(item.path, s.id);
    }
  }

  const knownIds = new Set(defaultSections.map((s) => s.id));
  const sectionIds: string[] = [];
  for (const id of layout.sectionOrder) {
    if (knownIds.has(id) && !sectionIds.includes(id)) sectionIds.push(id);
  }
  for (const s of defaultSections) {
    if (!sectionIds.includes(s.id)) sectionIds.push(s.id);
  }

  const buckets = new Map<string, string[]>();
  for (const id of sectionIds) buckets.set(id, []);

  for (const path of itemByPath.keys()) {
    const preferred = layout.placement[path];
    const secId =
      preferred && buckets.has(preferred) ? preferred : defaultPlacement.get(path) ?? sectionIds[0]!;
    buckets.get(secId)!.push(path);
  }

  for (const [secId, paths] of buckets) {
    const order = layout.orders[secId] ?? [];
    paths.sort((a, b) => {
      const ia = order.indexOf(a);
      const ib = order.indexOf(b);
      if (ia === -1 && ib === -1) return 0;
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    });
  }

  return sectionIds
    .map((id) => {
      const paths = buckets.get(id) ?? [];
      if (!paths.length && !opts?.keepEmpty) return null;
      const meta = sectionMeta.get(id);
      if (!meta) return null;
      return {
        id,
        label: meta.label,
        icon: meta.icon,
        items: paths.map((p) => itemByPath.get(p)!).filter(Boolean),
      };
    })
    .filter((s): s is NavLayoutSection => !!s);
}

/** Elementni boshqa bo‘limga / indeksga ko‘chirish */
export function moveNavItem(
  layout: NavLayoutState,
  path: string,
  toSectionId: string,
  toIndex: number,
): NavLayoutState {
  const next: NavLayoutState = {
    version: 1,
    sectionOrder: [...layout.sectionOrder],
    placement: { ...layout.placement },
    orders: Object.fromEntries(
      Object.entries(layout.orders).map(([k, v]) => [k, v.filter((p) => p !== path)]),
    ),
  };
  next.placement[path] = toSectionId;
  const list = [...(next.orders[toSectionId] ?? [])];
  const idx = Math.max(0, Math.min(toIndex, list.length));
  list.splice(idx, 0, path);
  next.orders[toSectionId] = list;
  if (!next.sectionOrder.includes(toSectionId)) {
    next.sectionOrder = [...next.sectionOrder, toSectionId];
  }
  return next;
}

/** Bo‘limlar tartibini o‘zgartirish */
export function moveNavSection(
  layout: NavLayoutState,
  fromId: string,
  toIndex: number,
): NavLayoutState {
  const order = layout.sectionOrder.filter((id) => id !== fromId);
  const idx = Math.max(0, Math.min(toIndex, order.length));
  order.splice(idx, 0, fromId);
  return { ...layout, sectionOrder: order };
}

export function isNavLayoutCustom(layout: NavLayoutState | null): boolean {
  return !!layout;
}
