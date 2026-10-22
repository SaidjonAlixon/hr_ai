import { useEffect, useState } from "react";
import { RoomEvent, Track, type Participant, type Room } from "livekit-client";
import { hhmmOf, type ConfSettings, type Spotlight } from "@/lib/conference/api";

/**
 * Xona hodisalarida qayta chizish.
 * Gapirish / sifat o‘zgarishi — sekinroq (xonani qotirib qo‘ymaslik uchun).
 * Trek/ishtirokchi o‘zgarishi — darhol.
 */
export function useRoomTick(room: Room | null): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!room) return;
    let frame = 0;
    let softTimer: ReturnType<typeof setTimeout> | null = null;
    let softDue = 0;
    const bumpNow = () => {
      if (frame) return;
      if (document.hidden) {
        if (softTimer) return;
        softTimer = setTimeout(() => {
          softTimer = null;
          setTick((t) => t + 1);
        }, 400);
        return;
      }
      frame = requestAnimationFrame(() => {
        frame = 0;
        setTick((t) => t + 1);
      });
    };
    /** Speaking/quality — max ~4 marta/sek */
    const bumpSoft = () => {
      const now = Date.now();
      const wait = Math.max(0, softDue - now);
      if (softTimer) return;
      softTimer = setTimeout(() => {
        softTimer = null;
        softDue = Date.now() + 250;
        bumpNow();
      }, wait || 250);
    };
    const structural = [
      RoomEvent.ParticipantConnected,
      RoomEvent.ParticipantDisconnected,
      RoomEvent.TrackSubscribed,
      RoomEvent.TrackUnsubscribed,
      RoomEvent.TrackPublished,
      RoomEvent.TrackUnpublished,
      RoomEvent.LocalTrackPublished,
      RoomEvent.LocalTrackUnpublished,
      RoomEvent.TrackMuted,
      RoomEvent.TrackUnmuted,
      RoomEvent.ParticipantAttributesChanged,
      RoomEvent.ParticipantPermissionsChanged,
      RoomEvent.ParticipantNameChanged,
      RoomEvent.RoomMetadataChanged,
      RoomEvent.ConnectionStateChanged,
      RoomEvent.AudioPlaybackStatusChanged,
      RoomEvent.ActiveDeviceChanged,
    ] as const;
    const soft = [RoomEvent.ActiveSpeakersChanged, RoomEvent.ConnectionQualityChanged, RoomEvent.TrackStreamStateChanged] as const;
    for (const e of structural) room.on(e, bumpNow);
    for (const e of soft) room.on(e, bumpSoft);
    return () => {
      for (const e of structural) room.off(e, bumpNow);
      for (const e of soft) room.off(e, bumpSoft);
      if (frame) cancelAnimationFrame(frame);
      if (softTimer) clearTimeout(softTimer);
    };
  }, [room]);
  return tick;
}

export type RoomMeta = { title?: string; hostId?: number; spotlight: Spotlight | null; settings: ConfSettings | null };

export function parseRoomMeta(raw: string | undefined): RoomMeta {
  try {
    const m = JSON.parse(raw || "{}") as Partial<RoomMeta>;
    return { title: m.title, hostId: m.hostId, spotlight: m.spotlight ?? null, settings: m.settings ?? null };
  } catch {
    return { spotlight: null, settings: null };
  }
}

export type PRole = "host" | "cohost" | "participant";

export function roleOf(p: Participant): PRole {
  const r = p.attributes?.role;
  return r === "host" || r === "cohost" ? r : "participant";
}

export function isMod(p: Participant): boolean {
  return roleOf(p) !== "participant";
}

export function userIdOf(p: Participant): number {
  const fromAttr = Number(p.attributes?.uid);
  if (Number.isInteger(fromAttr) && fromAttr > 0) return fromAttr;
  const m = /^u(\d+)$/.exec(p.identity);
  return m ? Number(m[1]) : 0;
}

export function handOf(p: Participant): number {
  return Number(p.attributes?.hand) || 0;
}

/** Server ruxsati (LiveKit TrackSource raqamlari: 1 kamera, 2 mikrofon, 3 ekran) */
const SOURCE_CODE: Partial<Record<Track.Source, number>> = {
  [Track.Source.Camera]: 1,
  [Track.Source.Microphone]: 2,
  [Track.Source.ScreenShare]: 3,
};

export function canPublish(p: Participant, source: Track.Source): boolean {
  const perm = p.permissions;
  if (!perm) return true;
  if (!perm.canPublish) return false;
  const list = perm.canPublishSources ?? [];
  if (!list.length) return true;
  const code = SOURCE_CODE[source];
  return code != null && list.includes(code as never);
}

export function displayName(p: Participant): string {
  return p.name || p.identity;
}

/** n ta 16:9 plitkani konteynerga eng katta o‘lchamda joylash */
export function bestGrid(n: number, width: number, height: number, gap = 8): { cols: number; rows: number; tileW: number; tileH: number } {
  if (n <= 0 || width <= 0 || height <= 0) return { cols: 1, rows: 1, tileW: width, tileH: height };
  let best = { cols: 1, rows: n, tileW: 0, tileH: 0 };
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const maxW = (width - gap * (cols - 1)) / cols;
    const maxH = (height - gap * (rows - 1)) / rows;
    let tileW = maxW;
    let tileH = (tileW * 9) / 16;
    if (tileH > maxH) {
      tileH = maxH;
      tileW = (tileH * 16) / 9;
    }
    if (tileW * tileH > best.tileW * best.tileH) best = { cols, rows, tileW, tileH };
  }
  return best;
}

export function useElementSize<T extends HTMLElement>(el: T | null): { width: number; height: number } {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const r = entry.contentRect;
      setSize((s) => (Math.abs(s.width - r.width) < 1 && Math.abs(s.height - r.height) < 1 ? s : { width: r.width, height: r.height }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return size;
}

export function useMediaQuery(query: string): boolean {
  const [match, setMatch] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatch(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return match;
}

export function canShareScreen(): boolean {
  return typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getDisplayMedia);
}

export function hhmm(iso: string): string {
  return hhmmOf(iso);
}
