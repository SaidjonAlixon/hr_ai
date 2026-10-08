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
  | { type: "restart" };

type DcMsg =
  | ({ t: "state" } & MediaFlags)
  | { t: "req"; what: "screen" | "control" }
  | { t: "res"; what: "screen" | "control"; ok: boolean }
  | { t: "stop"; what: "screen" | "control" }
  | { t: "ctl"; ev: ControlEvent };

const API = "/api/calls";
const RING_CLIENT_MS = 50_000;
const RECONNECT_FAIL_MS = 25_000;

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
};

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
  }

  stop() {
    if (this.snap.callId) void this.finish("ended", { silent: true });
    this.es?.close();
    this.es = null;
    if (this.esRetry) clearTimeout(this.esRetry);
    this.esRetry = null;
    this.userId = null;
    window.removeEventListener("pagehide", this.onPageHide);
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
    on("hello", () => this.set({ online: true }));
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

  private signal(data: Signal) {
    const id = this.snap.callId;
    if (!id) return;
    this.sigChain = this.sigChain
      .then(() => this.api(`/${id}/signal`, { method: "POST", body: JSON.stringify({ cid: this.cid, data }) }))
      .catch(() => undefined);
  }

  // ------------------------------------------------------------ hayot sikli

  private resetCall(patch: Partial<CallSnapshot>) {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    this.cancelled = false;
    this.connectedOnce = false;
    this.pendingIce = [];
    this.set({
      ...patch,
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
        void this.api(`/${out.call.id}/end`, { method: "POST", body: JSON.stringify({ reason: "hangup" }) }).catch(() => undefined);
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
      const out = await this.api<{ iceServers: RTCIceServer[] }>(`/${id}/accept`, {
        method: "POST",
        body: JSON.stringify({ cid: this.cid }),
      });
      if (out.iceServers?.length) this.iceServers = out.iceServers;
      this.set({ answeredAt: Date.now() });
      this.keepAwake();
    } catch (err) {
      this.notify((err as Error).message || "Ulanib bo‘lmadi", "error");
      await this.finish("failed");
    }
  }

  async decline() {
    const id = this.snap.callId;
    if (!id || this.snap.phase !== "incoming") return;
    void this.api(`/${id}/end`, { method: "POST", body: JSON.stringify({ reason: "declined" }) }).catch(() => undefined);
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
    void this.api(`/${id}/end`, { method: "POST", body: JSON.stringify({ reason: "hangup" }) }).catch(() => undefined);
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

  private async syncVideo() {
    try {
      await this.videoTx?.sender.replaceTrack(this.currentVideoTrack());
    } catch {
      /* */
    }
    this.set({ localStream: this.camTrack && this.snap.local.cam ? new MediaStream([this.camTrack]) : null });
    this.sendState();
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
      this.setLocal({ facing: next });
    } catch {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: this.camConstraints(this.snap.local.facing) });
        this.camTrack = s.getVideoTracks()[0] ?? null;
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
        const s = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 15, max: 30 } }, audio: false });
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
      this.appShare = startAppShare(this.snap.controlGranted ? 8 : 6);
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
    dc.onopen = () => this.sendState();
    dc.onmessage = (e) => this.onDcMessage(String(e.data));
    dc.onclose = () => {
      if (this.dc === dc && this.snap.phase === "active") void this.finish("ended");
    };
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
    } else {
      pc.ondatachannel = (e) => this.setupDc(e.channel);
    }
    return pc;
  }

  private onConnected() {
    if (this.failTimer) clearTimeout(this.failTimer);
    this.failTimer = null;
    if (this.snap.conn === "connected") return;
    this.set({ conn: "connected", phase: "active", answeredAt: this.snap.answeredAt ?? Date.now() });
    if (!this.connectedOnce) {
      this.connectedOnce = true;
      snd.playConnected();
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
        if (id) void this.api(`/${id}/end`, { method: "POST", body: JSON.stringify({ reason: "failed" }) }).catch(() => undefined);
        void this.finish("failed");
      }, RECONNECT_FAIL_MS);
    }
  }

  private async restartIce() {
    const pc = this.pc;
    if (!pc || !this.isCaller) return;
    try {
      pc.restartIce?.();
      const offer = await pc.createOffer({ iceRestart: true });
      await pc.setLocalDescription(offer);
      this.signal({ type: "offer", sdp: pc.localDescription!.toJSON() });
    } catch {
      /* */
    }
  }

  private async onAccepted(c: PublicCall) {
    if (c.id !== this.snap.callId || this.snap.phase !== "outgoing") return;
    snd.stopSound();
    this.set({ phase: "connecting", conn: "connecting", answeredAt: Date.now() });
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
        await pc.setRemoteDescription(data.sdp);
        if (!this.audioTx || !this.videoTx) {
          for (const t of pc.getTransceivers()) {
            const kind = t.receiver.track?.kind;
            if (kind === "audio" && !this.audioTx) this.audioTx = t;
            if (kind === "video" && !this.videoTx) this.videoTx = t;
          }
          for (const t of [this.audioTx, this.videoTx]) if (t) t.direction = "sendrecv";
          await this.audioTx?.sender.replaceTrack(this.micTrack);
          await this.videoTx?.sender.replaceTrack(this.currentVideoTrack());
        }
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        this.signal({ type: "answer", sdp: pc.localDescription!.toJSON() });
        await this.flushIce();
      } else if (data.type === "answer") {
        if (pc.signalingState === "have-local-offer") await pc.setRemoteDescription(data.sdp);
        await this.flushIce();
      } else if (data.type === "ice") {
        if (pc.remoteDescription) await pc.addIceCandidate(data.candidate).catch(() => undefined);
        else this.pendingIce.push(data.candidate);
      } else if (data.type === "restart") {
        await this.restartIce();
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
