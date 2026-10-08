import { useSyncExternalStore } from "react";
import { applyControl, hideRemoteCursor, type ControlEvent } from "./remote-control";
import { canCaptureTab, canShareScreen, startAppShare, type AppShare } from "./app-share";
import type { MirrorRecorder } from "./dom-mirror";
import { canZip, fixSafariCss, gunzip, readZipFrame } from "./mirror-wire";
import * as snd from "./sounds";
import type { eventWithTime } from "rrweb";

export type CallPeer = { id: number; fullName: string; role: string };
export type CallPhase = "idle" | "outgoing" | "incoming" | "connecting" | "active" | "ended";
/** tab — joriy brauzer tabi (real vaqt, boshqaruv mumkin); app — DOM dan chizilgan ko‘rinish (telefonlar) */
export type ShareMode = "none" | "screen" | "app" | "tab";

/** Boshqaruv koordinatalari faqat ilova oynasiga mos keladigan rejimlarda ishlaydi */
export function isControllableShare(share: ShareMode): boolean {
  return share === "app" || share === "tab";
}
export type Facing = "user" | "environment";
export type MediaFlags = { mic: boolean; cam: boolean; share: ShareMode; facing: Facing };
export type CallPrompt = { kind: "screen" | "control" } | null;
export type ConnState = "new" | "connecting" | "connected" | "reconnecting" | "failed";

export type CallSnapshot = {
  me: { id: number; isAdmin: boolean; canCall: boolean } | null;
  online: boolean;
  phase: CallPhase;
  callId: string | null;
  peer: CallPeer | null;
  outgoing: boolean;
  video: boolean;
  answeredAt: number | null;
  endedReason: string | null;
  conn: ConnState;
  local: MediaFlags;
  remote: MediaFlags;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  minimized: boolean;
  prompt: CallPrompt;
  waiting: { screen: boolean; control: boolean };
  controlGranted: boolean;
  /** controller — men boshqaryapman; controlled — meni boshqarishyapti */
  controlSide: "none" | "controller" | "controlled";
  canFlip: boolean;
  notice: { text: string; tone: "info" | "warn" | "error"; at: number } | null;
  /** Qarshi tomondan video kadrlar haqiqatda kelyapti (getStats bo‘yicha) */
  rxVideo: boolean;
  quality: "good" | "weak" | "poor" | null;
  dcOpen: boolean;
  /** Qarshi tomon ilovasini video emas, jonli DOM nusxasi sifatida yuboryapti */
  remoteMirror: boolean;
};

type PublicCall = {
  id: string;
  video: boolean;
  status: string;
  createdAt: number;
  answeredAt: number | null;
  caller: CallPeer;
  callee: CallPeer;
};

type Signal =
  | { type: "offer"; sdp: RTCSessionDescriptionInit }
  | { type: "answer"; sdp: RTCSessionDescriptionInit }
  | { type: "ice"; candidate: RTCIceCandidateInit }
  | { type: "restart" }
  | { type: "reneg" };

type DcMsg =
  | { t: "kf" }
  | ({ t: "state" } & MediaFlags)
  | { t: "req"; what: "screen" | "control" }
  | { t: "res"; what: "screen" | "control"; ok: boolean }
  | { t: "stop"; what: "screen" | "control" }
  | { t: "ctl"; ev: ControlEvent }
  | { t: "caps"; mirror: boolean; zip?: boolean }
  | { t: "mfull" };

const MIRROR_DC_ID = 42;

const API = "/api/calls";
const RING_CLIENT_MS = 50_000;
const RECONNECT_FAIL_MS = 25_000;
const CONNECT_TIMEOUT_MS = 40_000;

const END_TEXT: Record<string, string> = {
  missed: "Javob berilmadi",
  declined: "Rad etildi",
  cancelled: "Bekor qilindi",
  ended: "Qo‘ng‘iroq tugadi",
  failed: "Aloqa uzildi",
  busy: "Band",
  offline: "Oflayn — platformada emas",
  taken: "Boshqa qurilmada ko‘tarildi",
};

export function endedText(reason: string | null): string {
  return (reason && END_TEXT[reason]) || "Qo‘ng‘iroq tugadi";
}

/** Har bir sahifa yuklanishi uchun alohida — nusxalangan tablar bir-birini uzib qo‘ymasin */
function clientId(): string {
  const raw = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}${Math.random()}`;
  return `c${raw.replace(/[^A-Za-z0-9]/g, "").slice(0, 31)}`;
}

class CallError extends Error {
  code?: string;
  status?: number;
}

const flagsDefault = (video: boolean): MediaFlags => ({ mic: true, cam: video, share: "none", facing: "user" });

const initial: CallSnapshot = {
  me: null,
  online: false,
  phase: "idle",
  callId: null,
  peer: null,
  outgoing: false,
  video: false,
  answeredAt: null,
  endedReason: null,
  conn: "new",
  local: flagsDefault(false),
  remote: flagsDefault(false),
  localStream: null,
  remoteStream: null,
  minimized: false,
  prompt: null,
  waiting: { screen: false, control: false },
  controlGranted: false,
  controlSide: "none",
  canFlip: false,
  notice: null,
  rxVideo: false,
  quality: null,
  dcOpen: false,
  remoteMirror: false,
};

/**
 * H264 birinchi: iPhone/Mac Safari uni apparat orqali kodlaydi (VP8 dasturiy — qiziydi, kadr tashlaydi).
 * Ikkala tomon ham shunday tartib bersa, har biri H264 yuboradi; qo‘llamasa VP8 ga tushadi.
 */
function preferCodecs(t: RTCRtpTransceiver | null) {
  if (!t || typeof t.setCodecPreferences !== "function" || typeof RTCRtpReceiver?.getCapabilities !== "function") return;
  const codecs = RTCRtpReceiver.getCapabilities("video")?.codecs;
  if (!codecs?.length) return;
  const rank = (c: { mimeType: string; sdpFmtpLine?: string }) => {
    const m = c.mimeType.toLowerCase();
    const fmtp = c.sdpFmtpLine ?? "";
    if (m === "video/h264") return /packetization-mode=1/.test(fmtp) ? (/profile-level-id=42e01f/i.test(fmtp) ? 0 : 1) : 2;
    if (m === "video/vp8") return 3;
    if (m === "video/vp9") return 4;
    if (m === "video/av1") return 5;
    return 6;
  };
  try {
    t.setCodecPreferences([...codecs].sort((a, b) => rank(a) - rank(b)));
  } catch {
    /* brauzer qo‘llamasa — standart tartib */
  }
}

/**
 * Chrome yuborishni ~300 kbit/s dan boshlaydi — birinchi soniyalarda tasvir xira. Boshlang‘ich tezlik 1 Mbit/s;
 * tarmoq sust bo‘lsa, baribir avtomatik pasayadi. Boshqa brauzerlar noma’lum parametrni e’tiborsiz qoldiradi.
 */
function boostVideoStart(desc: RTCSessionDescriptionInit): RTCSessionDescriptionInit {
  if (!desc.sdp) return desc;
  const PARAM = "x-google-start-bitrate=1000";
  const lines = desc.sdp.split("\r\n");
  const videoPts = new Set<string>();
  const withFmtp = new Set<string>();
  let inVideo = false;
  for (const l of lines) {
    if (l.startsWith("m=")) inVideo = l.startsWith("m=video");
    const m = inVideo && /^a=rtpmap:(\d+) (H264|VP8|VP9|AV1)\//i.exec(l);
    if (m) videoPts.add(m[1]);
    const f = /^a=fmtp:(\d+) /.exec(l);
    if (f) withFmtp.add(f[1]);
  }
  const out: string[] = [];
  for (const l of lines) {
    const f = /^a=fmtp:(\d+) /.exec(l);
    if (f && videoPts.has(f[1]) && !l.includes("x-google-start-bitrate")) {
      out.push(`${l};${PARAM}`);
      continue;
    }
    out.push(l);
    const r = /^a=rtpmap:(\d+) /.exec(l);
    if (r && videoPts.has(r[1]) && !withFmtp.has(r[1])) out.push(`a=fmtp:${r[1]} ${PARAM}`);
  }
  return { type: desc.type, sdp: out.join("\r\n") };
}

type StatsAcc = {
  dec: number;
  enc: number;
  rxIdle: number;
  txIdle: number;
  heals: number;
  healAt: number;
  txHealAt: number;
  camMuted: number;
  lost: number;
  recv: number;
};

const statsInit = (): StatsAcc => ({ dec: -1, enc: -1, rxIdle: 0, txIdle: 0, heals: 0, healAt: 0, txHealAt: 0, camMuted: 0, lost: 0, recv: 0 });

class CallEngine {
  private snap: CallSnapshot = initial;
  private listeners = new Set<() => void>();
  private cid = "";
  private userId: number | null = null;
  private es: EventSource | null = null;
  private esRetry: ReturnType<typeof setTimeout> | null = null;
  private iceServers: RTCIceServer[] = [];
  private configAt = 0;

  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private isCaller = false;
  private audioTx: RTCRtpTransceiver | null = null;
  private videoTx: RTCRtpTransceiver | null = null;
  private micTrack: MediaStreamTrack | null = null;
  private camTrack: MediaStreamTrack | null = null;
  private camBusy = false;
  private camRestartAt = 0;
  private camRestarts = 0;
  private screenTrack: MediaStreamTrack | null = null;
  private appShare: AppShare | null = null;
  private mirrorDc: RTCDataChannel | null = null;
  private mirror: MirrorRecorder | null = null;
  private peerMirror = false;
  private peerZip = false;
  private mirrorBuf: eventWithTime[] = [];
  private mirrorParts = new Map<string, { parts: string[]; got: number }>();
  private mirrorZip = new Map<number, { parts: Uint8Array[]; got: number; size: number }>();
  /** Siqilgan voqea ochilayotganda keyingi xabarlar navbatda kutadi — tartib buzilmasin */
  private mirrorRxChain: Promise<void> = Promise.resolve();
  private mirrorRxPending = 0;
  private mirrorGen = 0;
  private mirrorSubs = new Set<(ev: eventWithTime | null) => void>();
  private mirrorFullAt = 0;
  private mirrorRx = 0;
  private pendingIce: RTCIceCandidateInit[] = [];
  private sigChain: Promise<unknown> = Promise.resolve();
  private ringTimer: ReturnType<typeof setTimeout> | null = null;
  private failTimer: ReturnType<typeof setTimeout> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private cancelled = false;
  private connectedOnce = false;
  /** Shu qurilma boshqaruvga ruxsat bergan (ijrochi tomoni) */
  private iGranted = false;
  private wakeLock: { release: () => Promise<void> } | null = null;
  private statsTimer: ReturnType<typeof setInterval> | null = null;
  private st: StatsAcc = statsInit();
  private lastDiag: Record<string, unknown> = {};
  private diagCount = 0;
  /** Bildirishnomadagi «Ko‘tarish» bosilgan, qo‘ng‘iroq hali kelib ulgurmagan */
  private pendingAnswer: string | null = null;

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  getSnapshot = () => this.snap;

  private set(patch: Partial<CallSnapshot>) {
    const next = { ...this.snap, ...patch };
    next.controlSide = !next.controlGranted ? "none" : this.iGranted ? "controlled" : "controller";
    if (this.snap.controlSide === "controlled" && next.controlSide !== "controlled") hideRemoteCursor();
    this.snap = next;
    for (const fn of this.listeners) fn();
  }

  private notify(text: string, tone: "info" | "warn" | "error" = "info") {
    this.set({ notice: { text, tone, at: Date.now() } });
  }

  // ------------------------------------------------------------ server

  private async api<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(API + path, {
      ...init,
      credentials: "include",
      headers: { "Content-Type": "application/json", "X-Call-Client": this.cid, ...(init.headers || {}) },
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
    if (!res.ok) {
      const err = new CallError(data.error || "Xatolik yuz berdi");
      err.code = data.code;
      err.status = res.status;
      throw err;
    }
    return data as T;
  }

  private async loadConfig(force = false) {
    if (!force && Date.now() - this.configAt < 6 * 3600_000 && this.iceServers.length) return;
    const cfg = await this.api<{ me: { id: number; isAdmin: boolean; canCall: boolean }; iceServers: RTCIceServer[] }>(
      "/config",
    );
    this.iceServers = cfg.iceServers;
    this.configAt = Date.now();
    this.set({ me: cfg.me });
  }

  start(userId: number) {
    if (this.userId === userId && this.es) return;
    this.stop();
    this.userId = userId;
    this.cid = clientId();
    snd.primeCallAudio();
    void this.loadConfig(true).catch(() => undefined);
    this.readAnswerLink();
    this.openStream();
    window.addEventListener("pagehide", this.onPageHide);
    document.addEventListener("visibilitychange", this.onVisible);
    navigator.serviceWorker?.addEventListener("message", this.onSwMessage);
  }

  stop() {
    if (this.snap.callId) void this.finish("ended", { silent: true });
    this.es?.close();
    this.es = null;
    if (this.esRetry) clearTimeout(this.esRetry);
    this.esRetry = null;
    this.userId = null;
    window.removeEventListener("pagehide", this.onPageHide);
    document.removeEventListener("visibilitychange", this.onVisible);
    navigator.serviceWorker?.removeEventListener("message", this.onSwMessage);
    this.snap = initial;
    for (const fn of this.listeners) fn();
  }

  private onPageHide = () => {
    const id = this.snap.callId;
    if (!id || this.snap.phase === "idle" || this.snap.phase === "ended") return;
    if (this.snap.phase === "incoming") return;
    try {
      navigator.sendBeacon(`${API}/${id}/end`, new Blob([JSON.stringify({ reason: "hangup" })], { type: "application/json" }));
    } catch {
      /* ignore */
    }
  };

  /** iOS fon rejimidan qaytganda kamera/mikrofon o‘chirilgan bo‘lishi mumkin — qayta olinadi, videoga yangi kalit-kadr */
  private onVisible = () => {
    if (document.visibilityState === "visible" && this.snap.phase === "incoming") {
      this.clearCallNotification(this.snap.callId);
      snd.playRingtone();
      return;
    }
    if (document.visibilityState !== "visible" || this.snap.phase !== "active") return;
    void (async () => {
      if (this.micTrack?.readyState === "ended") {
        try {
          const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
          this.micTrack = s.getAudioTracks()[0] ?? null;
          await this.audioTx?.sender.replaceTrack(this.currentAudioTrack()).catch(() => undefined);
        } catch {
          /* */
        }
      }
      if (this.snap.local.cam && (!this.camTrack || this.camTrack.readyState === "ended" || this.camTrack.muted)) {
        await this.restartCam(true);
        return;
      }
      await this.refreshVideo();
    })();
  };

  private openStream() {
    if (!this.userId) return;
    const es = new EventSource(`${API}/stream?cid=${encodeURIComponent(this.cid)}`, { withCredentials: true });
    this.es = es;
    const on = <T,>(name: string, fn: (d: T) => void) =>
      es.addEventListener(name, (e) => {
        try {
          fn(JSON.parse((e as MessageEvent).data) as T);
        } catch {
          /* buzuq xabar */
        }
      });
    let first = true;
    on("hello", () => {
      this.set({ online: true });
      if (!first) void this.rejoin();
      first = false;
    });
    on<PublicCall>("incoming", (c) => this.onIncoming(c));
    on<PublicCall>("accepted", (c) => void this.onAccepted(c));
    on<{ id: string }>("taken", (d) => {
      if (this.snap.callId === d.id && this.snap.phase === "incoming") void this.finish("taken", { silent: true });
    });
    on<{ id: string; reason: string }>("ended", (d) => {
      if (this.snap.callId === d.id) void this.finish(d.reason);
    });
    on<{ id: string; data: Signal }>("signal", (d) => {
      if (this.snap.callId === d.id) void this.handleSignal(d.data);
    });
    on<{ canCall: boolean }>("perm", (d) => {
      if (this.snap.me) this.set({ me: { ...this.snap.me, canCall: d.canCall || this.snap.me.isAdmin } });
    });
    es.onerror = () => {
      this.set({ online: false });
      if (es.readyState === EventSource.CLOSED && this.es === es) {
        this.es = null;
        this.esRetry = setTimeout(() => this.openStream(), 5000);
      }
    };
  }

  /** Server qisqa vaqt yiqilsa (502/503, tarmoq) — bir necha marta qayta urinadi */
  private async post<T>(path: string, body: unknown, tries = 4): Promise<T> {
    let last: unknown;
    for (let i = 0; i < tries; i++) {
      try {
        return await this.api<T>(path, { method: "POST", body: JSON.stringify(body) });
      } catch (err) {
        last = err;
        const status = (err as CallError).status;
        if (status && status < 500) throw err;
        await new Promise((r) => setTimeout(r, 800 * (i + 1)));
      }
    }
    throw last;
  }

  private signal(data: Signal) {
    const id = this.snap.callId;
    if (!id) return;
    this.sigChain = this.sigChain
      .then(() => (this.snap.callId === id ? this.post(`/${id}/signal`, { cid: this.cid, data }) : undefined))
      .catch(() => undefined);
  }

  private sendEnd(id: string, reason: string) {
    void this.post(`/${id}/end`, { reason }).catch(() => undefined);
  }

  /** SSE qayta ulanganda (server qayta ishga tushgan bo‘lishi mumkin) — qo‘ng‘iroqdagi joyni qayta egallash */
  private async rejoin() {
    const id = this.snap.callId;
    if (!id || !this.busyNow() || this.snap.phase === "incoming") return;
    try {
      await this.post(`/${id}/rejoin`, { cid: this.cid });
      if (this.snap.callId !== id) return;
      if (this.pc && this.snap.conn !== "connected") {
        if (this.isCaller) void this.restartIce();
        else this.signal({ type: "restart" });
      }
    } catch (err) {
      if ((err as CallError).status === 404 && this.snap.callId === id && this.snap.conn !== "connected") {
        this.notify("Qo‘ng‘iroq server tomonidan yakunlangan", "warn");
        await this.finish("failed");
      }
    }
  }

  // ------------------------------------------------------------ hayot sikli

  private resetCall(patch: Partial<CallSnapshot>) {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    this.cancelled = false;
    this.connectedOnce = false;
    this.pendingIce = [];
    this.st = statsInit();
    this.lastDiag = {};
    this.diagCount = 0;
    this.set({
      ...patch,
      rxVideo: false,
      quality: null,
      dcOpen: false,
      answeredAt: null,
      endedReason: null,
      conn: "new",
      remote: flagsDefault(Boolean(patch.video)),
      localStream: null,
      remoteStream: null,
      minimized: false,
      prompt: null,
      waiting: { screen: false, control: false },
      controlGranted: false,
      notice: null,
    });
  }

  private busyNow() {
    return this.snap.phase !== "idle" && this.snap.phase !== "ended";
  }

  private onIncoming(c: PublicCall) {
    if (this.snap.callId === c.id) return;
    if (this.busyNow()) return;
    this.resetCall({ phase: "incoming", callId: c.id, peer: c.caller, outgoing: false, video: c.video, local: flagsDefault(c.video) });
    snd.playRingtone();
    if (this.ringTimer) clearTimeout(this.ringTimer);
    this.ringTimer = setTimeout(() => {
      if (this.snap.callId === c.id && this.snap.phase === "incoming") void this.finish("missed", { silent: true });
    }, RING_CLIENT_MS);
    if (this.pendingAnswer === c.id) {
      this.pendingAnswer = null;
      void this.accept();
      return;
    }
    if (document.visibilityState === "hidden") this.ringInBackground(c);
  }

  /** Tab/ilova fonda: tizim bildirishnomasi «Ko‘tarish» / «Rad etish» tugmalari bilan, jiringlash takrorlanadi */
  private ringInBackground(c: PublicCall) {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    void navigator.serviceWorker?.ready
      .then((reg) =>
        reg.active?.postMessage({
          type: "vaksina-call-ring",
          callId: c.id,
          title: c.video ? "📹 Video qo‘ng‘iroq" : "📞 Qo‘ng‘iroq",
          body: `${c.caller.fullName} sizga qo‘ng‘iroq qilmoqda`,
          ringMs: RING_CLIENT_MS,
        }),
      )
      .catch(() => undefined);
  }

  private clearCallNotification(id: string | null) {
    if (!id) return;
    void navigator.serviceWorker?.ready
      .then(async (reg) => {
        reg.active?.postMessage({ type: "vaksina-call-stop", callId: id });
        for (const n of await reg.getNotifications({ tag: `call-${id}` })) {
          if ((n.data as { kind?: string } | null)?.kind === "call") n.close();
        }
      })
      .catch(() => undefined);
  }

  /** Service worker bildirishnomasidagi tugmalar */
  private onSwMessage = (e: MessageEvent) => {
    const d = e.data as { type?: string; op?: string; id?: string } | null;
    if (d?.type !== "vaksina-call" || !d.id) return;
    const mine = this.snap.callId === d.id;
    if (d.op === "answer") {
      if (mine && this.snap.phase === "incoming") void this.accept();
      else if (!mine) this.pendingAnswer = d.id;
    } else if (d.op === "declined") {
      if (mine && this.snap.phase === "incoming") void this.finish("declined", { silent: true });
    } else if (d.op === "show" && mine) {
      this.set({ minimized: false });
    }
  };

  /** Bildirishnomadan yangi oyna ochilgan: /qongiroq?call=ID&answer=1 */
  private readAnswerLink() {
    try {
      const url = new URL(window.location.href);
      const id = url.searchParams.get("call");
      if (!id) return;
      if (url.searchParams.get("answer") === "1") this.pendingAnswer = id;
      url.searchParams.delete("call");
      url.searchParams.delete("answer");
      window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    } catch {
      /* */
    }
  }

  async call(peer: CallPeer, video: boolean) {
    if (this.busyNow()) {
      this.notify("Avval joriy qo‘ng‘iroqni yakunlang", "warn");
      return;
    }
    snd.unlockAudio();
    this.resetCall({ phase: "outgoing", callId: null, peer, outgoing: true, video, local: flagsDefault(video) });
    try {
      await this.acquire(video);
      if (this.cancelled) return;
      const out = await this.api<{ call: PublicCall; iceServers: RTCIceServer[] }>("", {
        method: "POST",
        body: JSON.stringify({ calleeId: peer.id, video, cid: this.cid }),
      });
      this.iceServers = out.iceServers;
      this.configAt = Date.now();
      if (this.cancelled) {
        this.sendEnd(out.call.id, "hangup");
        return;
      }
      this.set({ callId: out.call.id, peer: out.call.callee });
      snd.playRingback();
      this.keepAwake();
    } catch (err) {
      const e = err as CallError;
      this.releaseMedia();
      if (e.code === "busy" || e.code === "offline") snd.playBusy();
      else snd.stopSound();
      this.set({ phase: "ended", endedReason: e.code === "busy" || e.code === "offline" ? e.code : "failed" });
      this.notify(e.message || "Qo‘ng‘iroq boshlanmadi", "error");
      this.scheduleIdle(2600);
    }
  }

  async accept(asVideo?: boolean) {
    if (this.snap.phase !== "incoming" || !this.snap.callId) return;
    const id = this.snap.callId;
    const video = asVideo ?? this.snap.video;
    snd.stopSound();
    snd.unlockAudio();
    this.clearCallNotification(id);
    if (this.ringTimer) clearTimeout(this.ringTimer);
    this.set({ phase: "connecting", conn: "connecting", local: flagsDefault(video) });
    try {
      await this.loadConfig().catch(() => undefined);
      await this.acquire(video);
      this.createPeer(false);
      const out = await this.post<{ iceServers: RTCIceServer[] }>(`/${id}/accept`, { cid: this.cid });
      if (out.iceServers?.length) this.iceServers = out.iceServers;
      this.set({ answeredAt: Date.now() });
      this.armConnectTimer();
      this.keepAwake();
    } catch (err) {
      this.notify((err as Error).message || "Ulanib bo‘lmadi", "error");
      await this.finish("failed");
    }
  }

  async decline() {
    const id = this.snap.callId;
    if (!id || this.snap.phase !== "incoming") return;
    this.sendEnd(id, "declined");
    await this.finish("declined", { silent: true });
  }

  async hangup() {
    const id = this.snap.callId;
    if (this.snap.phase === "incoming") return this.decline();
    if (!id) {
      this.cancelled = true;
      await this.finish("cancelled", { silent: true });
      return;
    }
    this.sendEnd(id, "hangup");
    await this.finish(this.snap.phase === "outgoing" ? "cancelled" : "ended");
  }

  private scheduleIdle(ms: number) {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      if (this.snap.phase === "ended") this.set({ ...initial, me: this.snap.me, online: this.snap.online });
    }, ms);
  }

  private async finish(reason: string, opts: { silent?: boolean } = {}) {
    if (this.snap.phase === "ended" || this.snap.phase === "idle") return;
    if (this.ringTimer) clearTimeout(this.ringTimer);
    if (this.failTimer) clearTimeout(this.failTimer);
    this.ringTimer = null;
    this.failTimer = null;
    snd.stopSound();
    if (!this.snap.outgoing) this.clearCallNotification(this.snap.callId);
    if (this.connectedOnce) this.sendDiag(`end:${reason}`);
    this.stopStats();
    try {
      this.dc?.close();
      this.mirrorDc?.close();
    } catch {
      /* */
    }
    try {
      this.pc?.close();
    } catch {
      /* */
    }
    this.dc = null;
    this.mirrorDc = null;
    this.peerMirror = false;
    this.peerZip = false;
    this.resetMirrorFeed();
    this.pc = null;
    this.audioTx = null;
    this.videoTx = null;
    this.releaseMedia();
    this.releaseWake();
    this.iGranted = false;
    this.set({
      phase: "ended",
      endedReason: reason,
      conn: "new",
      localStream: null,
      remoteStream: null,
      prompt: null,
      controlGranted: false,
      waiting: { screen: false, control: false },
      minimized: false,
      rxVideo: false,
      quality: null,
      dcOpen: false,
    });
    if (!opts.silent) snd.playEnded();
    this.scheduleIdle(reason === "taken" ? 0 : 2200);
  }

  private keepAwake() {
    const wl = (navigator as unknown as { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } }).wakeLock;
    if (!wl || this.wakeLock) return;
    void wl
      .request("screen")
      .then((l) => {
        this.wakeLock = l;
      })
      .catch(() => undefined);
  }

  private releaseWake() {
    void this.wakeLock?.release().catch(() => undefined);
    this.wakeLock = null;
  }

  // ------------------------------------------------------------ media

  private camConstraints(facing: Facing): MediaTrackConstraints {
    return { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } };
  }

  /** Kamerani ochish: to‘liq sifat rad etilsa — faqat yo‘nalish bilan (ba’zi telefonlar orqa kamerada 720p bermaydi) */
  private async openCam(facing: Facing): Promise<MediaStreamTrack> {
    const md = navigator.mediaDevices;
    let s: MediaStream;
    try {
      s = await md.getUserMedia({ video: this.camConstraints(facing) });
    } catch (err) {
      const name = (err as { name?: string })?.name;
      if (name === "NotAllowedError" || name === "SecurityError") throw err;
      await new Promise((r) => setTimeout(r, 300));
      s = await md.getUserMedia({ video: { facingMode: { ideal: facing } } });
    }
    const track = s.getVideoTracks()[0];
    if (!track) throw new Error("no video track");
    return track;
  }

  /**
   * Kamera kadr bermay qolsa (iOS: trek «muted» — tizim uzib qo‘ygan) — kamerani yangidan ochish.
   * Ketma-ket cheksiz urinmaslik uchun cheklangan.
   */
  private async restartCam(force = false) {
    if (!this.snap.local.cam || this.camBusy) return;
    const now = Date.now();
    if (!force && now - this.camRestartAt < 4000) return;
    if (now - this.camRestartAt > 60_000) this.camRestarts = 0;
    if (!force && this.camRestarts >= 5) return;
    this.camRestartAt = now;
    this.camRestarts += 1;
    this.camBusy = true;
    const old = this.camTrack;
    try {
      old?.stop();
      const track = await this.openCam(this.snap.local.facing);
      if (!this.snap.local.cam || !this.busyNow()) {
        track.stop();
        return;
      }
      this.camTrack = track;
      this.watchCam(track);
    } catch {
      this.camTrack = null;
      this.setLocal({ cam: false });
      this.notify("Kamera ochilmadi — qayta yoqib ko‘ring", "warn");
    } finally {
      this.camBusy = false;
    }
    await this.syncVideo();
  }

  /** Mikrofon o‘chirilganda trek to‘xtatilmaydi (iOS da enabled=false kamerani ham uzib qo‘yadi) — faqat uzatilmaydi */
  private currentAudioTrack(): MediaStreamTrack | null {
    return this.snap.local.mic ? this.micTrack : null;
  }

  private async acquire(video: boolean) {
    const md = navigator.mediaDevices;
    if (!md?.getUserMedia) throw new CallError("Brauzer qo‘ng‘iroqni qo‘llab-quvvatlamaydi (HTTPS kerak)");
    const audio: MediaTrackConstraints = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
    let stream: MediaStream;
    try {
      stream = await md.getUserMedia({ audio, video: video ? this.camConstraints("user") : false });
    } catch (err) {
      if (!video) throw new CallError(this.mediaErrorText(err, "Mikrofon"));
      try {
        stream = await md.getUserMedia({ audio, video: false });
        this.notify("Kamera ochilmadi — ovozli davom etadi", "warn");
      } catch (err2) {
        throw new CallError(this.mediaErrorText(err2, "Mikrofon"));
      }
    }
    this.micTrack = stream.getAudioTracks()[0] ?? null;
    this.camTrack = stream.getVideoTracks()[0] ?? null;
    this.watchCam(this.camTrack);
    this.set({
      local: { mic: true, cam: Boolean(this.camTrack), share: "none", facing: "user" },
      localStream: this.camTrack ? new MediaStream([this.camTrack]) : null,
    });
    void this.detectFlip();
  }

  private mediaErrorText(err: unknown, what: string) {
    const name = (err as { name?: string })?.name;
    if (name === "NotAllowedError" || name === "SecurityError") return `${what}ga ruxsat berilmadi. Brauzer sozlamasidan ruxsat bering.`;
    if (name === "NotFoundError" || name === "OverconstrainedError") return `${what} topilmadi`;
    if (name === "NotReadableError") return `${what} boshqa ilovada band`;
    return `${what} ochilmadi`;
  }

  private async detectFlip() {
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      const cams = list.filter((d) => d.kind === "videoinput").length;
      this.set({ canFlip: cams > 1 || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) });
    } catch {
      /* */
    }
  }

  private releaseMedia() {
    for (const t of [this.micTrack, this.camTrack, this.screenTrack]) t?.stop();
    this.appShare?.stop();
    this.mirror?.stop();
    this.micTrack = this.camTrack = this.screenTrack = null;
    this.appShare = null;
    this.mirror = null;
  }

  private currentVideoTrack(): MediaStreamTrack | null {
    const s = this.snap.local.share;
    if (s === "screen" || s === "tab") return this.screenTrack;
    if (s === "app") return this.appShare?.track ?? null;
    return this.snap.local.cam ? this.camTrack : null;
  }

  /** Kamera tizim tomonidan to‘xtatilsa (boshqa ilova, iOS uzilishi) — holat yangilanadi */
  private watchCam(track: MediaStreamTrack | null) {
    if (!track) return;
    track.contentHint = "motion";
    track.onended = () => {
      if (this.camTrack !== track || !this.snap.local.cam || document.visibilityState !== "visible") return;
      void this.restartCam();
    };
    track.onmute = () => {
      setTimeout(() => {
        if (this.camTrack !== track || !track.muted || document.visibilityState !== "visible") return;
        void this.restartCam();
      }, 2500);
    };
  }

  private async syncVideo() {
    const track = this.currentVideoTrack();
    const tx = this.videoTx;
    if (tx) {
      try {
        await tx.sender.replaceTrack(track);
      } catch {
        // replaceTrack rad etilsa — trekni qayta biriktirib, yangidan kelishamiz
        try {
          await tx.sender.replaceTrack(null);
          await tx.sender.replaceTrack(track);
        } catch {
          /* */
        }
        this.renegotiate();
      }
      await this.tuneSender();
    }
    this.st.txIdle = 0;
    this.set({ localStream: this.camTrack && this.snap.local.cam ? new MediaStream([this.camTrack]) : null });
    this.sendState();
    if (track) this.diagSoon("video-on");
  }

  /** Bitrate/kadr chastotasi: kamera — silliq harakat, ekran — tiniq matn */
  private async tuneSender() {
    const sender = this.videoTx?.sender;
    if (!sender?.track || typeof sender.getParameters !== "function") return;
    const share = this.snap.local.share;
    const params = sender.getParameters() as RTCRtpSendParameters & { degradationPreference?: string };
    if (!params.encodings?.length) return;
    const enc = params.encodings[0];
    enc.maxBitrate = share === "screen" || share === "tab" ? 2_500_000 : share === "app" ? 1_500_000 : 1_800_000;
    enc.maxFramerate = share === "none" || share === "tab" ? 30 : share === "screen" ? 20 : 10;
    enc.scaleResolutionDownBy = 1;
    try {
      await sender.setParameters({ ...params, degradationPreference: share === "none" ? "balanced" : "maintain-resolution" } as RTCRtpSendParameters);
    } catch {
      try {
        await sender.setParameters(params);
      } catch {
        /* */
      }
    }
  }

  /** Yangi kalit-kadr: trekni qayta biriktirish (qabul qiluvchida tasvir qotib qolsa) */
  private async refreshVideo() {
    const tx = this.videoTx;
    const track = this.currentVideoTrack();
    if (!tx || !track || track.readyState !== "live") return;
    try {
      await tx.sender.replaceTrack(null);
      await tx.sender.replaceTrack(track);
    } catch {
      /* */
    }
    await this.tuneSender();
  }

  /** SDP ni yangidan kelishish — taklifni har doim chaqiruvchi yuboradi (to‘qnashuv bo‘lmasin) */
  private renegotiate() {
    if (!this.pc) return;
    if (this.isCaller) void this.negotiate(false);
    else this.signal({ type: "reneg" });
  }

  private async negotiate(iceRestart: boolean) {
    const pc = this.pc;
    if (!pc || !this.isCaller) return;
    if (pc.signalingState !== "stable" && !iceRestart) return;
    try {
      if (iceRestart) pc.restartIce?.();
      const offer = await pc.createOffer(iceRestart ? { iceRestart: true } : undefined);
      await pc.setLocalDescription(offer);
      this.signal({ type: "offer", sdp: pc.localDescription!.toJSON() });
    } catch {
      /* */
    }
  }

  private setLocal(patch: Partial<MediaFlags>) {
    this.set({ local: { ...this.snap.local, ...patch } });
  }

  toggleMic() {
    if (!this.micTrack) return;
    this.micTrack.enabled = true;
    this.setLocal({ mic: !this.snap.local.mic });
    void this.audioTx?.sender.replaceTrack(this.currentAudioTrack()).catch(() => undefined);
    this.sendState();
  }

  async toggleCam() {
    if (this.camBusy) return;
    if (this.snap.local.cam && this.camTrack) {
      this.camTrack.stop();
      this.camTrack = null;
      this.setLocal({ cam: false });
    } else {
      this.camBusy = true;
      try {
        this.camTrack?.stop();
        this.camTrack = await this.openCam(this.snap.local.facing);
        this.watchCam(this.camTrack);
        this.camRestarts = 0;
        this.setLocal({ cam: true });
        void this.detectFlip();
      } catch (err) {
        this.camTrack = null;
        this.notify(this.mediaErrorText(err, "Kamera"), "error");
        return;
      } finally {
        this.camBusy = false;
      }
    }
    await this.syncVideo();
  }

  async flipCamera() {
    if (!this.snap.local.cam || this.camBusy) return;
    const prev = this.snap.local.facing;
    const next: Facing = prev === "user" ? "environment" : "user";
    this.camBusy = true;
    // iOS bir vaqtda ikki kamerani ochmaydi — eskisi avval to‘xtatiladi
    this.camTrack?.stop();
    this.camTrack = null;
    try {
      this.camTrack = await this.openCam(next);
      this.watchCam(this.camTrack);
      this.camRestarts = 0;
      this.setLocal({ facing: next });
    } catch {
      try {
        this.camTrack = await this.openCam(prev);
        this.watchCam(this.camTrack);
      } catch {
        this.camTrack = null;
        this.setLocal({ cam: false });
      }
      this.notify("Kamerani almashtirib bo‘lmadi", "warn");
    } finally {
      this.camBusy = false;
    }
    await this.syncVideo();
  }

  /** Joriy tabni real vaqtda uzatish (Chromium kompyuter). Boshqa sirt tanlansa — null (koordinatalar mos kelmaydi) */
  private async captureTab(): Promise<MediaStreamTrack | null> {
    if (!canCaptureTab()) return null;
    try {
      const s = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: "browser", frameRate: { ideal: 30, max: 30 }, width: { max: 1920 }, height: { max: 1080 } },
        audio: false,
        preferCurrentTab: true,
        selfBrowserSurface: "include",
        surfaceSwitching: "exclude",
      } as DisplayMediaStreamOptions);
      const track = s.getVideoTracks()[0];
      if (!track) return null;
      const surface = (track.getSettings() as { displaySurface?: string }).displaySurface;
      if (surface && surface !== "browser") {
        track.stop();
        this.notify("Boshqaruv uchun «Shu tab» tanlanishi kerak — ilova ko‘rinishi orqali davom etamiz", "warn");
        return null;
      }
      track.contentHint = "detail";
      track.onended = () => {
        if (this.screenTrack === track) void this.stopShare();
      };
      return track;
    } catch {
      return null;
    }
  }

  async startShare(mode?: "screen" | "app" | "tab"): Promise<boolean> {
    let m: "screen" | "app" | "tab" = mode ?? (canShareScreen() ? "screen" : "app");
    this.stopShareTracks();
    if (m === "tab") {
      const track = await this.captureTab();
      if (track) this.screenTrack = track;
      else m = "app";
    }
    if (m === "tab") {
      this.set({ minimized: true });
    } else if (m === "screen") {
      try {
        const s = await navigator.mediaDevices.getDisplayMedia({
          video: { frameRate: { ideal: 20, max: 30 }, width: { max: 1920 }, height: { max: 1080 } },
          audio: false,
        });
        const track = s.getVideoTracks()[0];
        if (!track) return false;
        track.contentHint = "detail";
        track.onended = () => {
          if (this.screenTrack === track) void this.stopShare();
        };
        this.screenTrack = track;
      } catch {
        this.notify("Ekran ulashish bekor qilindi", "warn");
        return false;
      }
    } else {
      if (!(await this.startMirrorShare())) {
        this.appShare = startAppShare(this.snap.controlGranted ? 8 : 6, () =>
          this.notify("Ekran tasviri olinmayapti — sahifani yangilab, qayta ulashing", "warn"),
        );
      }
      this.set({ minimized: true });
    }
    this.setLocal({ share: m });
    await this.syncVideo();
    return true;
  }

  /** Qarshi tomon jonli nusxani qabul qila olsa — kadr chizish o‘rniga DOM o‘zgarishlari yuboriladi */
  private async startMirrorShare(): Promise<boolean> {
    const dc = this.mirrorDc;
    if (!this.peerMirror || dc?.readyState !== "open") return false;
    try {
      const { startMirror } = await import("./dom-mirror");
      if (this.mirrorDc !== dc) return false;
      this.mirror = startMirror(dc, { zip: this.peerZip });
    } catch {
      this.mirror = null;
    }
    return Boolean(this.mirror);
  }

  private stopShareTracks() {
    this.screenTrack?.stop();
    this.screenTrack = null;
    this.appShare?.stop();
    this.appShare = null;
    this.mirror?.stop();
    this.mirror = null;
  }

  async stopShare() {
    this.stopShareTracks();
    this.setLocal({ share: "none" });
    if (this.iGranted) this.revokeControl();
    await this.syncVideo();
  }

  setMinimized(v: boolean) {
    this.set({ minimized: v });
  }

  clearNotice() {
    this.set({ notice: null });
  }

  // ------------------------------------------------------------ ulashish / boshqaruv so‘rovlari

  private send(msg: DcMsg) {
    if (this.dc?.readyState === "open") {
      this.dc.send(JSON.stringify(msg));
      return true;
    }
    return false;
  }

  private sendState() {
    this.send({ t: "state", ...this.snap.local });
  }

  requestScreen() {
    if (this.send({ t: "req", what: "screen" })) {
      this.set({ waiting: { ...this.snap.waiting, screen: true } });
      this.notify("Ekran ulashish so‘rovi yuborildi");
    }
  }

  requestControl() {
    if (this.send({ t: "req", what: "control" })) {
      this.set({ waiting: { ...this.snap.waiting, control: true } });
      this.notify("Boshqaruv so‘rovi yuborildi");
    }
  }

  stopRemoteShare() {
    this.send({ t: "stop", what: "screen" });
  }

  stopControl() {
    this.send({ t: "stop", what: "control" });
    this.set({ controlGranted: false });
  }

  async respondPrompt(ok: boolean) {
    const p = this.snap.prompt;
    if (!p) return;
    this.set({ prompt: null });
    if (!ok) {
      this.send({ t: "res", what: p.kind, ok: false });
      return;
    }
    if (p.kind === "screen") {
      const done = await this.startShare();
      this.send({ t: "res", what: "screen", ok: done });
    } else {
      this.iGranted = true;
      this.set({ controlGranted: true });
      const done = isControllableShare(this.snap.local.share) ? true : await this.startShare(this.peerMirror ? "app" : "tab");
      if (!done) {
        this.iGranted = false;
        this.set({ controlGranted: false });
      }
      this.send({ t: "res", what: "control", ok: done });
      if (done) this.set({ minimized: true });
    }
  }

  revokeControl() {
    if (!this.snap.controlGranted) return;
    this.iGranted = false;
    this.set({ controlGranted: false });
    this.send({ t: "stop", what: "control" });
    this.notify("Boshqaruv to‘xtatildi");
  }

  sendControl(ev: ControlEvent) {
    if (this.snap.controlSide !== "controller") return;
    this.send({ t: "ctl", ev });
  }

  private onDcMessage(raw: string) {
    let msg: DcMsg;
    try {
      msg = JSON.parse(raw) as DcMsg;
    } catch {
      return;
    }
    switch (msg.t) {
      case "kf":
        void this.refreshVideo();
        break;
      case "state": {
        const remote: MediaFlags = { mic: Boolean(msg.mic), cam: Boolean(msg.cam), share: msg.share, facing: msg.facing };
        const patch: Partial<CallSnapshot> = { remote };
        if (!isControllableShare(remote.share) && this.snap.controlGranted && !this.iGranted) patch.controlGranted = false;
        if (remote.share !== "none" && this.snap.waiting.screen) patch.waiting = { ...this.snap.waiting, screen: false };
        if (remote.share !== "app" && this.snap.remoteMirror) this.resetMirrorFeed();
        this.set(patch);
        break;
      }
      case "caps":
        this.peerMirror = Boolean(msg.mirror);
        this.peerZip = Boolean(msg.zip);
        break;
      case "mfull":
        this.mirror?.full();
        break;
      case "req":
        if (msg.what === "control" && this.snap.peer?.role !== "admin") return;
        this.set({ prompt: { kind: msg.what }, minimized: false });
        snd.playConnected();
        break;
      case "res":
        this.set({
          waiting: { ...this.snap.waiting, [msg.what]: false },
          ...(msg.what === "control" ? { controlGranted: msg.ok } : {}),
        });
        this.notify(
          msg.ok
            ? msg.what === "control"
              ? "Boshqaruvga ruxsat berildi"
              : "Ekran ulashildi"
            : msg.what === "control"
              ? "Boshqaruv so‘rovi rad etildi"
              : "Ekran ulashish rad etildi",
          msg.ok ? "info" : "warn",
        );
        break;
      case "stop":
        if (msg.what === "control") {
          if (this.snap.controlGranted) this.notify("Boshqaruv yakunlandi", "warn");
          this.iGranted = false;
          this.set({ controlGranted: false });
        } else if (msg.what === "screen" && this.snap.local.share !== "none") {
          void this.stopShare();
        }
        break;
      case "ctl":
        if (this.iGranted && this.snap.controlGranted) {
          applyControl(msg.ev);
          if (msg.ev.e !== "move") this.appShare?.kick();
        }
        break;
    }
  }

  private setupDc(dc: RTCDataChannel) {
    this.dc = dc;
    let opened = false;
    const open = () => {
      if (opened) return;
      opened = true;
      this.set({ dcOpen: true });
      this.send({ t: "caps", mirror: true, zip: canZip });
      this.sendState();
    };
    dc.onopen = open;
    dc.onmessage = (e) => this.onDcMessage(String(e.data));
    dc.onclose = () => {
      if (this.dc !== dc) return;
      this.set({ dcOpen: false });
      if (this.snap.phase === "active") void this.finish("ended");
    };
    if (dc.readyState === "open") open();
    if (this.pc && !this.mirrorDc) {
      try {
        this.setupMirrorDc(this.pc.createDataChannel("mirror", { negotiated: true, id: MIRROR_DC_ID, ordered: true }));
      } catch {
        /* eski brauzer — video orqali ulashiladi */
      }
    }
  }

  // ------------------------------------------------------------ ilova ekranining jonli nusxasi

  private setupMirrorDc(dc: RTCDataChannel) {
    this.mirrorDc = dc;
    dc.binaryType = "arraybuffer";
    dc.onmessage = (e) => {
      const data = e.data as unknown;
      if (typeof data === "string" || data instanceof ArrayBuffer) this.onMirrorFrame(data);
    };
    dc.onclose = () => {
      if (this.mirrorDc !== dc) return;
      this.mirrorDc = null;
      this.peerMirror = false;
      this.resetMirrorFeed();
      if (this.mirror) {
        this.mirror.stop();
        this.mirror = null;
        if (this.snap.local.share === "app") void this.stopShare();
      }
    };
  }

  private onMirrorFrame(data: string | ArrayBuffer) {
    this.mirrorRx += typeof data === "string" ? data.length : data.byteLength;
    if (!this.mirrorRxPending) {
      const job = this.handleMirrorFrame(data);
      if (job) this.trackMirrorJob(job);
      return;
    }
    this.trackMirrorJob(this.mirrorRxChain.then(() => this.handleMirrorFrame(data) ?? undefined));
  }

  private trackMirrorJob(job: Promise<void>) {
    this.mirrorRxPending += 1;
    this.mirrorRxChain = this.mirrorRxChain
      .then(() => job)
      .catch(() => undefined)
      .finally(() => {
        this.mirrorRxPending -= 1;
      });
  }

  /** Siqilgan voqea to‘liq kelganda — ochish va’dasi qaytadi, aks holda sinxron qayta ishlanadi */
  private handleMirrorFrame(data: string | ArrayBuffer): Promise<void> | null {
    if (typeof data !== "string") {
      const f = readZipFrame(data);
      if (!f || !(f.total > 0) || f.idx >= f.total) return null;
      let entry = this.mirrorZip.get(f.id);
      if (!entry || entry.parts.length !== f.total) {
        entry = { parts: new Array<Uint8Array>(f.total), got: 0, size: 0 };
        this.mirrorZip.set(f.id, entry);
      }
      if (!entry.parts[f.idx]) {
        entry.parts[f.idx] = f.body;
        entry.got += 1;
        entry.size += f.body.length;
      }
      if (entry.got < f.total) return null;
      this.mirrorZip.delete(f.id);
      const all = new Uint8Array(entry.size);
      let at = 0;
      for (const p of entry.parts) {
        all.set(p, at);
        at += p.length;
      }
      const gen = this.mirrorGen;
      return gunzip(all).then((json) => {
        if (gen === this.mirrorGen) this.onMirrorEvent(json);
      });
    }
    this.onMirrorText(data);
    return null;
  }

  private onMirrorText(data: string) {
    const kind = data[0];
    if (kind === "S") {
      this.resetMirrorFeed();
      this.set({ remoteMirror: true });
    } else if (kind === "X") {
      this.resetMirrorFeed();
    } else if (kind === "e") {
      this.onMirrorEvent(data.slice(1));
    } else if (kind === "c") {
      const a = data.indexOf("|");
      const b = data.indexOf("|", a + 1);
      const c = data.indexOf("|", b + 1);
      if (a < 0 || b < 0 || c < 0) return;
      const id = data.slice(1, a);
      const idx = Number(data.slice(a + 1, b));
      const total = Number(data.slice(b + 1, c));
      if (!(total > 0) || !(idx >= 0) || idx >= total) return;
      let entry = this.mirrorParts.get(id);
      if (!entry || entry.parts.length !== total) {
        entry = { parts: new Array<string>(total), got: 0 };
        this.mirrorParts.set(id, entry);
      }
      if (entry.parts[idx] === undefined) {
        entry.parts[idx] = data.slice(c + 1);
        entry.got += 1;
      }
      if (entry.got === total) {
        this.mirrorParts.delete(id);
        this.onMirrorEvent(entry.parts.join(""));
      }
    }
  }

  private onMirrorEvent(json: string) {
    let ev: eventWithTime;
    try {
      ev = JSON.parse(fixSafariCss(json)) as eventWithTime;
    } catch {
      return;
    }
    if (!this.snap.remoteMirror) this.set({ remoteMirror: true });
    if (ev.type === 4) this.mirrorBuf = [];
    this.mirrorBuf.push(ev);
    // Uzoq seansda xotira o‘smasin — vaqti-vaqti bilan yangi to‘liq nusxa so‘raladi
    if (this.mirrorBuf.length > 20_000 && Date.now() - this.mirrorFullAt > 20_000) {
      this.mirrorFullAt = Date.now();
      this.send({ t: "mfull" });
    }
    for (const fn of this.mirrorSubs) fn(ev);
  }

  private resetMirrorFeed() {
    this.mirrorGen += 1;
    this.mirrorBuf = [];
    this.mirrorParts.clear();
    this.mirrorZip.clear();
    for (const fn of this.mirrorSubs) fn(null);
    if (this.snap.remoteMirror) this.set({ remoteMirror: false });
  }

  /** Ko‘rinish keyin ochilsa ham oxirgi to‘liq nusxadan boshlab tiklanadi; null — tozalash */
  subscribeMirror(fn: (ev: eventWithTime | null) => void): () => void {
    for (const ev of this.mirrorBuf) fn(ev);
    this.mirrorSubs.add(fn);
    return () => {
      this.mirrorSubs.delete(fn);
    };
  }

  // ------------------------------------------------------------ sifat kuzatuvi

  private startStats() {
    if (this.statsTimer) return;
    this.statsTimer = setInterval(() => void this.pollStats(), 1000);
  }

  private stopStats() {
    if (this.statsTimer) clearInterval(this.statsTimer);
    this.statsTimer = null;
  }

  /**
   * Har soniyada: video kadrlar haqiqatda kelyaptimi/ketyaptimi. Kelmasa — avval yangi kalit-kadr so‘raladi,
   * keyin SDP qayta kelishiladi. Shu orqali tasvir qotib qolmaydi.
   */
  private async pollStats() {
    const pc = this.pc;
    if (!pc || this.snap.phase !== "active") return;
    let report: RTCStatsReport;
    try {
      report = await pc.getStats();
    } catch {
      return;
    }
    if (this.pc !== pc) return;
    type Rec = Record<string, unknown> & { type: string; id: string };
    let inV: Rec | null = null;
    let outV: Rec | null = null;
    let pair: Rec | null = null;
    let selectedPairId: string | null = null;
    let lost = 0;
    let recv = 0;
    report.forEach((r: Rec) => {
      const kind = (r.kind ?? r.mediaType) as string | undefined;
      if (r.type === "inbound-rtp") {
        lost += Number(r.packetsLost ?? 0);
        recv += Number(r.packetsReceived ?? 0);
        if (kind === "video" && (!inV || Number(r.bytesReceived ?? 0) > Number(inV.bytesReceived ?? 0))) inV = r;
      } else if (r.type === "outbound-rtp" && kind === "video") {
        if (!outV || Number(r.bytesSent ?? 0) > Number(outV.bytesSent ?? 0)) outV = r;
      } else if (r.type === "transport" && r.selectedCandidatePairId) {
        selectedPairId = String(r.selectedCandidatePairId);
      } else if (r.type === "candidate-pair" && r.nominated && r.state === "succeeded" && !pair) {
        pair = r;
      }
    });
    if (selectedPairId) pair = (report.get(selectedPairId) as Rec | undefined) ?? pair;
    const iv = inV as Rec | null;
    const ov = outV as Rec | null;
    const cp = pair as Rec | null;

    const dec = Number(iv?.framesDecoded ?? 0);
    const flowing = this.st.dec >= 0 && dec > this.st.dec;
    this.st.dec = dec;
    this.st.rxIdle = flowing ? 0 : this.st.rxIdle + 1;
    const rxVideo = flowing || (this.snap.rxVideo && this.st.rxIdle < 3);

    const enc = Number(ov?.framesEncoded ?? 0);
    const sending = this.st.enc >= 0 && enc > this.st.enc;
    this.st.enc = enc;
    const vt = this.videoTx?.sender.track;
    this.st.txIdle = vt && vt.readyState === "live" && !sending ? this.st.txIdle + 1 : 0;

    const dLost = Math.max(0, lost - this.st.lost);
    const dRecv = Math.max(0, recv - this.st.recv);
    this.st.lost = lost;
    this.st.recv = recv;
    const lossPct = dRecv + dLost > 0 ? (dLost / (dRecv + dLost)) * 100 : 0;
    const rtt = Number(cp?.currentRoundTripTime ?? 0);
    const quality: CallSnapshot["quality"] = rtt > 0.45 || lossPct > 8 ? "poor" : rtt > 0.25 || lossPct > 3 ? "weak" : "good";

    const codecOf = (r: Rec | null) => (r?.codecId ? String((report.get(String(r.codecId)) as Rec | undefined)?.mimeType ?? "") : "");
    const candOf = (id: unknown) => {
      const c = id ? (report.get(String(id)) as Rec | undefined) : undefined;
      return c ? `${c.candidateType ?? "?"}/${c.protocol ?? "?"}${c.relayProtocol ? `(${c.relayProtocol})` : ""}` : "?";
    };
    this.lastDiag = {
      path: cp ? `${candOf(cp.localCandidateId)} -> ${candOf(cp.remoteCandidateId)}` : null,
      rttMs: Math.round(rtt * 1000),
      lossPct: Math.round(lossPct * 10) / 10,
      outKbps: cp?.availableOutgoingBitrate ? Math.round(Number(cp.availableOutgoingBitrate) / 1000) : null,
      tx: ov ? `${codecOf(ov)} ${ov.frameWidth ?? 0}x${ov.frameHeight ?? 0}@${ov.framesPerSecond ?? 0} enc=${enc} limit=${ov.qualityLimitationReason ?? "-"}` : null,
      rx: iv ? `${codecOf(iv)} ${iv.frameWidth ?? 0}x${iv.frameHeight ?? 0}@${iv.framesPerSecond ?? 0} dec=${dec} freeze=${iv.freezeCount ?? "-"}` : null,
      txTrack: vt ? `${vt.readyState}${vt.muted ? ":muted" : ""}` : null,
      camTrack: this.camTrack ? `${this.camTrack.readyState}${this.camTrack.muted ? ":muted" : ""} ${this.camTrack.getSettings().width ?? 0}x${this.camTrack.getSettings().height ?? 0}` : null,
      mirror: this.mirror ? `tx ${this.mirror.sentBytes()}` : this.snap.remoteMirror ? `rx ${this.mirrorRx} buf=${this.mirrorBuf.length}` : null,
      rxIdle: this.st.rxIdle,
      txIdle: this.st.txIdle,
    };

    if (rxVideo !== this.snap.rxVideo || quality !== this.snap.quality) this.set({ rxVideo, quality });

    const now = Date.now();
    const wantsVideo = this.snap.remote.cam || this.snap.remote.share !== "none";
    // «Ilova ko‘rinishi» kadrlarni sahifa o‘zgarganda yuboradi — siyrak kadr tarmoq nosozligi emas
    if (flowing || !wantsVideo || this.snap.remote.share === "app") this.st.heals = 0;
    else if (this.st.rxIdle >= 4 && now - this.st.healAt > 5000 && this.st.heals < 6) {
      this.st.healAt = now;
      this.st.heals += 1;
      if (this.st.heals % 2 === 1) this.send({ t: "kf" });
      else this.renegotiate();
      this.sendDiag("rx-stall");
    }
    const cam = this.camTrack;
    const camStuck = Boolean(this.snap.local.cam && document.visibilityState === "visible" && (!cam || cam.readyState === "ended" || cam.muted));
    this.st.camMuted = camStuck ? this.st.camMuted + 1 : 0;
    if (this.st.camMuted >= 3) {
      this.st.camMuted = 0;
      void this.restartCam();
      this.sendDiag("cam-restart");
    } else if (this.st.txIdle >= 4 && now - this.st.txHealAt > 8000 && this.snap.local.share !== "app") {
      this.st.txHealAt = now;
      void this.refreshVideo();
      this.sendDiag("tx-stall");
    }
  }

  private diagSoon(tag: string) {
    const id = this.snap.callId;
    setTimeout(() => {
      if (this.snap.callId === id && this.snap.phase === "active") this.sendDiag(tag);
    }, 6000);
  }

  private sendDiag(tag: string) {
    const id = this.snap.callId;
    if (!id || this.diagCount >= 40) return;
    this.diagCount += 1;
    const body = {
      tag,
      ua: navigator.userAgent.slice(0, 180),
      caller: this.isCaller,
      conn: this.snap.conn,
      ice: this.pc?.iceConnectionState ?? null,
      dc: this.dc?.readyState ?? null,
      local: this.snap.local,
      remote: this.snap.remote,
      rxVideo: this.snap.rxVideo,
      ...this.lastDiag,
    };
    void fetch(`${API}/${id}/diag`, {
      method: "POST",
      credentials: "include",
      keepalive: true,
      headers: { "Content-Type": "application/json", "X-Call-Client": this.cid },
      body: JSON.stringify(body),
    }).catch(() => undefined);
  }

  // ------------------------------------------------------------ WebRTC

  private createPeer(isCaller: boolean) {
    this.isCaller = isCaller;
    const pc = new RTCPeerConnection({ iceServers: this.iceServers, bundlePolicy: "max-bundle" });
    this.pc = pc;
    const remote = new MediaStream();
    pc.onicecandidate = (e) => {
      if (e.candidate) this.signal({ type: "ice", candidate: e.candidate.toJSON() });
    };
    pc.ontrack = (e) => {
      for (const t of remote.getTracks()) if (t.kind === e.track.kind && t.id !== e.track.id) remote.removeTrack(t);
      if (!remote.getTrackById(e.track.id)) remote.addTrack(e.track);
      this.set({ remoteStream: new MediaStream(remote.getTracks()) });
    };
    const onState = () => {
      if (this.pc !== pc) return;
      const s = pc.connectionState || pc.iceConnectionState;
      const ice = pc.iceConnectionState;
      if (s === "connected" || ice === "connected" || ice === "completed") this.onConnected();
      else if (s === "disconnected" || ice === "disconnected") this.onDisconnected(false);
      else if (s === "failed" || ice === "failed") this.onDisconnected(true);
    };
    pc.onconnectionstatechange = onState;
    pc.oniceconnectionstatechange = onState;
    if (isCaller) {
      this.setupDc(pc.createDataChannel("ctl", { ordered: true }));
      this.audioTx = pc.addTransceiver("audio", { direction: "sendrecv" });
      this.videoTx = pc.addTransceiver("video", { direction: "sendrecv" });
      preferCodecs(this.videoTx);
    } else {
      pc.ondatachannel = (e) => this.setupDc(e.channel);
    }
    return pc;
  }

  /** Ko‘tarilgandan keyin ma’lum vaqtda media ulanmasa — osilib qolmasin */
  private armConnectTimer() {
    if (this.failTimer) clearTimeout(this.failTimer);
    this.failTimer = setTimeout(() => {
      this.failTimer = null;
      if (this.snap.conn === "connected" || !this.busyNow()) return;
      const id = this.snap.callId;
      if (id) this.sendEnd(id, "failed");
      this.notify("Ulanib bo‘lmadi — internet aloqasini tekshirib, qayta urinib ko‘ring", "error");
      void this.finish("failed");
    }, CONNECT_TIMEOUT_MS);
  }

  private onConnected() {
    if (this.failTimer) clearTimeout(this.failTimer);
    this.failTimer = null;
    if (this.snap.conn === "connected") return;
    this.set({ conn: "connected", phase: "active", answeredAt: this.snap.answeredAt ?? Date.now() });
    this.startStats();
    void this.tuneSender();
    if (!this.connectedOnce) {
      this.connectedOnce = true;
      snd.playConnected();
      this.diagSoon("connected");
    } else {
      this.notify("Aloqa tiklandi");
    }
  }

  private onDisconnected(failed: boolean) {
    if (this.snap.phase !== "active" && this.snap.phase !== "connecting") return;
    this.set({ conn: "reconnecting" });
    if (failed) {
      if (this.isCaller) void this.restartIce();
      else this.signal({ type: "restart" });
    }
    if (!this.failTimer) {
      this.failTimer = setTimeout(() => {
        this.failTimer = null;
        if (this.snap.conn === "connected") return;
        const id = this.snap.callId;
        if (id) this.sendEnd(id, "failed");
        void this.finish("failed");
      }, RECONNECT_FAIL_MS);
    }
  }

  private restartIce() {
    return this.negotiate(true);
  }

  private async onAccepted(c: PublicCall) {
    if (c.id !== this.snap.callId || this.snap.phase !== "outgoing") return;
    snd.stopSound();
    this.set({ phase: "connecting", conn: "connecting", answeredAt: Date.now() });
    this.armConnectTimer();
    try {
      const pc = this.createPeer(true);
      await this.audioTx!.sender.replaceTrack(this.currentAudioTrack());
      await this.videoTx!.sender.replaceTrack(this.currentVideoTrack());
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this.signal({ type: "offer", sdp: pc.localDescription!.toJSON() });
    } catch {
      this.notify("Ulanishda xatolik", "error");
      void this.hangup();
    }
  }

  private async flushIce() {
    const pc = this.pc;
    if (!pc?.remoteDescription) return;
    const list = this.pendingIce;
    this.pendingIce = [];
    for (const c of list) await pc.addIceCandidate(c).catch(() => undefined);
  }

  private async handleSignal(data: Signal) {
    const pc = this.pc;
    if (!pc) {
      if (data.type === "ice") this.pendingIce.push(data.candidate);
      return;
    }
    try {
      if (data.type === "offer") {
        await pc.setRemoteDescription(boostVideoStart(data.sdp)).catch(() => pc.setRemoteDescription(data.sdp));
        if (!this.audioTx || !this.videoTx) {
          for (const t of pc.getTransceivers()) {
            const kind = t.receiver.track?.kind;
            if (kind === "audio" && !this.audioTx) this.audioTx = t;
            if (kind === "video" && !this.videoTx) this.videoTx = t;
          }
          for (const t of [this.audioTx, this.videoTx]) if (t) t.direction = "sendrecv";
          preferCodecs(this.videoTx);
          await this.audioTx?.sender.replaceTrack(this.currentAudioTrack());
          await this.videoTx?.sender.replaceTrack(this.currentVideoTrack());
        }
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        this.signal({ type: "answer", sdp: pc.localDescription!.toJSON() });
        await this.flushIce();
        void this.tuneSender();
      } else if (data.type === "answer") {
        if (pc.signalingState === "have-local-offer") {
          await pc.setRemoteDescription(boostVideoStart(data.sdp)).catch(() => pc.setRemoteDescription(data.sdp));
        }
        await this.flushIce();
        void this.tuneSender();
      } else if (data.type === "ice") {
        if (pc.remoteDescription) await pc.addIceCandidate(data.candidate).catch(() => undefined);
        else this.pendingIce.push(data.candidate);
      } else if (data.type === "restart") {
        await this.restartIce();
      } else if (data.type === "reneg") {
        await this.negotiate(false);
      }
    } catch {
      /* keyingi signal tuzatadi */
    }
  }
}

export const callEngine = new CallEngine();

export function useCall(): CallSnapshot {
  return useSyncExternalStore(callEngine.subscribe, callEngine.getSnapshot, callEngine.getSnapshot);
}
