import { useEffect, useState } from "react";
import { RoomEvent, Track, type Participant, type Room } from "livekit-client";
import { hhmmOf, type ConfSettings, type Spotlight } from "@/lib/conference/api";

/** Xona hodisalarida qayta chizish — bir kadrda bir marta (25 kishilik xonada ham silliq) */
export function useRoomTick(room: Room | null): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!room) return;
    let frame = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const bump = () => {
      if (frame || timer) return;
      // Yashirin tabda rAF ishlamaydi (ekran ulashib boshqa oynaga o‘tganda) — taymer bilan
      if (document.hidden) {
        timer = setTimeout(() => {
          timer = null;
          setTick((t) => t + 1);
        }, 500);
        return;
      }
      frame = requestAnimationFrame(() => {
        frame = 0;
        setTick((t) => t + 1);
      });
    };
    const events = [
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
      RoomEvent.ActiveSpeakersChanged,
      RoomEvent.ParticipantAttributesChanged,
      RoomEvent.ParticipantPermissionsChanged,
      RoomEvent.ParticipantNameChanged,
      RoomEvent.RoomMetadataChanged,
      RoomEvent.ConnectionQualityChanged,
      RoomEvent.ConnectionStateChanged,
      RoomEvent.AudioPlaybackStatusChanged,
      RoomEvent.TrackStreamStateChanged,
      RoomEvent.ActiveDeviceChanged,
    ] as const;
    for (const e of events) room.on(e, bump);
    return () => {
      for (const e of events) room.off(e, bump);
      if (frame) cancelAnimationFrame(frame);
      if (timer) clearTimeout(timer);
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
