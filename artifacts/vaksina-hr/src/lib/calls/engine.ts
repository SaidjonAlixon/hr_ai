import { useSyncExternalStore } from "react";
import { applyControl, type ControlEvent } from "./remote-control";
import { canShareScreen, startAppShare, type AppShare } from "./app-share";
import * as snd from "./sounds";

export type CallPeer = { id: number; fullName: string; role: string };
export type CallPhase = "idle" | "outgoing" | "incoming" | "connecting" | "active" | "ended";
export type ShareMode = "none" | "screen" | "app";
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
  | { t: "ctl"; ev: ControlEvent };

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
  lost: number;
  recv: number;
};

const statsInit = (): StatsAcc => ({ dec: -1, enc: -1, rxIdle: 0, txIdle: 0, heals: 0, healAt: 0, txHealAt: 0, lost: 0, recv: 0 });

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
  private screenTrack: MediaStreamTrack | null = null;
  private appShare: AppShare | null = null;
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
    this.openStream();
    window.addEventListener("pagehide", this.onPageHide);
    document.addEventListener("visibilitychange", this.onVisible);
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
    if (document.visibilityState !== "visible" || this.snap.phase !== "active") return;
    void (async () => {
      if (this.micTrack?.readyState === "ended") {
        try {
          const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
          const enabled = this.snap.local.mic;
          this.micTrack = s.getAudioTracks()[0] ?? null;
          if (this.micTrack) this.micTrack.enabled = enabled;
          await this.audioTx?.sender.replaceTrack(this.micTrack).catch(() => undefined);
        } catch {
          /* */
        }
      }
      if (this.snap.local.cam && this.snap.local.share === "none" && this.camTrack?.readyState === "ended") {
        try {
          const s = await navigator.mediaDevices.getUserMedia({ video: this.camConstraints(this.snap.local.facing) });
          this.camTrack = s.getVideoTracks()[0] ?? null;
          this.watchCam(this.camTrack);
          await this.syncVideo();
          return;
        } catch {
          this.camTrack = null;
          this.setLocal({ cam: false });
          await this.syncVideo();
          return;
        }
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
    if (document.visibilityState === "hidden" && "Notification" in window && Notification.permission === "granted") {
      void navigator.serviceWorker?.ready
        .then((reg) =>
          reg.showNotification(c.video ? "📹 Video qo‘ng‘iroq" : "📞 Qo‘ng‘iroq", {
            body: `${c.caller.fullName} sizga qo‘ng‘iroq qilmoqda`,
            tag: `call-${c.id}`,
            data: { url: `/qongiroq?call=${c.id}` },
            requireInteraction: true,
          } as NotificationOptions),
        )
        .catch(() => undefined);
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
    if (this.connectedOnce) this.sendDiag(`end:${reason}`);
    this.stopStats();
    try {
      this.dc?.close();
    } catch {
      /* */
    }
    try {
      this.pc?.close();
    } catch {
      /* */
    }
    this.dc = null;
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
    this.micTrack = this.camTrack = this.screenTrack = null;
    this.appShare = null;
  }

  private currentVideoTrack(): MediaStreamTrack | null {
    const s = this.snap.local.share;
    if (s === "screen") return this.screenTrack;
    if (s === "app") return this.appShare?.track ?? null;
    return this.snap.local.cam ? this.camTrack : null;
  }

  /** Kamera tizim tomonidan to‘xtatilsa (boshqa ilova, iOS uzilishi) — holat yangilanadi */
  private watchCam(track: MediaStreamTrack | null) {
    if (!track) return;
    track.contentHint = "motion";
    track.onended = () => {
      if (this.camTrack !== track || !this.snap.local.cam || document.visibilityState !== "visible") return;
      this.camTrack = null;
      this.setLocal({ cam: false });
      this.notify("Kamera to‘xtadi — qayta yoqing", "warn");
      void this.syncVideo();
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
    enc.maxBitrate = share === "screen" ? 2_500_000 : share === "app" ? 1_500_000 : 1_800_000;
    enc.maxFramerate = share === "none" ? 30 : share === "screen" ? 20 : 10;
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
    this.micTrack.enabled = !this.micTrack.enabled;
    this.setLocal({ mic: this.micTrack.enabled });
    this.sendState();
  }

  async toggleCam() {
    if (this.snap.local.cam && this.camTrack) {
      this.camTrack.stop();
      this.camTrack = null;
      this.setLocal({ cam: false });
    } else {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: this.camConstraints(this.snap.local.facing) });
        this.camTrack = s.getVideoTracks()[0] ?? null;
        this.watchCam(this.camTrack);
        this.setLocal({ cam: Boolean(this.camTrack) });
        void this.detectFlip();
      } catch (err) {
        this.notify(this.mediaErrorText(err, "Kamera"), "error");
        return;
      }
    }
    await this.syncVideo();
  }

  async flipCamera() {
    if (!this.snap.local.cam) return;
    const next: Facing = this.snap.local.facing === "user" ? "environment" : "user";
    const old = this.camTrack;
    old?.stop();
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: this.camConstraints(next) });
      this.camTrack = s.getVideoTracks()[0] ?? null;
      this.watchCam(this.camTrack);
      this.setLocal({ facing: next });
    } catch {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: this.camConstraints(this.snap.local.facing) });
        this.camTrack = s.getVideoTracks()[0] ?? null;
        this.watchCam(this.camTrack);
      } catch {
        this.camTrack = null;
        this.setLocal({ cam: false });
      }
      this.notify("Kamerani almashtirib bo‘lmadi", "warn");
    }
    await this.syncVideo();
  }

  async startShare(mode?: "screen" | "app"): Promise<boolean> {
    const m = mode ?? (canShareScreen() ? "screen" : "app");
    this.stopShareTracks();
    if (m === "screen") {
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
      this.appShare = startAppShare(this.snap.controlGranted ? 8 : 6, () =>
        this.notify("Ekran tasviri olinmayapti — sahifani yangilab, qayta ulashing", "warn"),
      );
      this.set({ minimized: true });
    }
    this.setLocal({ share: m });
    await this.syncVideo();
    return true;
  }

  private stopShareTracks() {
    this.screenTrack?.stop();
    this.screenTrack = null;
    this.appShare?.stop();
    this.appShare = null;
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
      const done = this.snap.local.share === "app" ? true : await this.startShare("app");
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
        if (remote.share !== "app" && this.snap.controlGranted && !this.iGranted) patch.controlGranted = false;
        if (remote.share !== "none" && this.snap.waiting.screen) patch.waiting = { ...this.snap.waiting, screen: false };
        this.set(patch);
        break;
      }
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
        if (this.iGranted && this.snap.controlGranted) applyControl(msg.ev);
        break;
    }
  }

  private setupDc(dc: RTCDataChannel) {
    this.dc = dc;
    dc.onopen = () => {
      this.set({ dcOpen: true });
      this.sendState();
    };
    dc.onmessage = (e) => this.onDcMessage(String(e.data));
    dc.onclose = () => {
      if (this.dc !== dc) return;
      this.set({ dcOpen: false });
      if (this.snap.phase === "active") void this.finish("ended");
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
      rxIdle: this.st.rxIdle,
      txIdle: this.st.txIdle,
    };

    if (rxVideo !== this.snap.rxVideo || quality !== this.snap.quality) this.set({ rxVideo, quality });

    const now = Date.now();
    const wantsVideo = this.snap.remote.cam || this.snap.remote.share !== "none";
    if (flowing || !wantsVideo) this.st.heals = 0;
    else if (this.st.rxIdle >= 4 && now - this.st.healAt > 5000 && this.st.heals < 6) {
      this.st.healAt = now;
      this.st.heals += 1;
      if (this.st.heals % 2 === 1) this.send({ t: "kf" });
      else this.renegotiate();
      this.sendDiag("rx-stall");
    }
    if (this.st.txIdle >= 4 && now - this.st.txHealAt > 8000) {
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
      await this.audioTx!.sender.replaceTrack(this.micTrack);
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
          await this.audioTx?.sender.replaceTrack(this.micTrack);
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
