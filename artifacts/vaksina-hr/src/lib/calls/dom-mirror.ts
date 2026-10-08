import { record } from "rrweb";
import { canZip, gzip, TEXT_CHUNK as CHUNK, ZIP_CHUNK, zipFrame } from "./mirror-wire";
import { setMirrorNodeResolver } from "./remote-control";

/**
 * «Ilova ko‘rinishi»ning jonli nusxasi: kadr o‘rniga sahifa tuzilmasi va uning o‘zgarishlari yuboriladi.
 * Telefon rasm chizmaydi — faqat DOM o‘zgarishlarini uzatadi, shu sabab sekin qurilmada ham qotmaydi;
 * admin tomonda xuddi shu sahifa tiniq qayta quriladi. Kanal formati — mirror-wire.ts.
 */
export type MirrorRecorder = { stop: () => void; full: () => void; sentBytes: () => number };

const HIGH_WATER = 8 * 1024 * 1024;

export function startMirror(dc: RTCDataChannel, opts: { zip: boolean }): MirrorRecorder | null {
  if (dc.readyState !== "open") return null;
  const zip = opts.zip && canZip;
  let overflow = false;
  let seq = 0;
  let sent = 0;
  let stopped = false;
  // Siqish asinxron — undan keyingi kichik voqealar ham navbatda kutadi, tartib buzilmasin
  let queue: Promise<void> = Promise.resolve();
  let queued = 0;

  const open = () => dc.readyState === "open";

  const sendText = (s: string) => {
    if (!open()) return;
    dc.send(s);
    sent += s.length;
  };

  const sendChunked = (json: string) => {
    seq = (seq + 1) % 1_000_000;
    const parts: string[] = [];
    for (let i = 0; i < json.length; ) {
      let end = Math.min(json.length, i + CHUNK);
      const code = json.charCodeAt(end - 1);
      if (end < json.length && code >= 0xd800 && code <= 0xdbff) end -= 1;
      parts.push(json.slice(i, end));
      i = end;
    }
    parts.forEach((p, i) => sendText(`c${seq}|${i}|${parts.length}|${p}`));
  };

  const sendZipped = (bytes: Uint8Array) => {
    seq = (seq + 1) % 0xffffffff;
    const total = Math.max(1, Math.ceil(bytes.length / ZIP_CHUNK));
    for (let i = 0; i < total; i++) {
      if (!open()) return;
      const frame = zipFrame(seq, i, total, bytes.subarray(i * ZIP_CHUNK, (i + 1) * ZIP_CHUNK));
      dc.send(frame.buffer as ArrayBuffer);
      sent += frame.length;
    }
  };

  const enqueue = (job: () => void | Promise<void>) => {
    queued += 1;
    queue = queue
      .then(job)
      .catch(() => undefined)
      .finally(() => {
        queued -= 1;
      });
  };

  const push = (json: string) => {
    if (stopped || overflow || !open()) return;
    // Tarmoq ulgurmasa navbat cheksiz o‘smasin: tashlab yuboriladi, bo‘shagach to‘liq nusxa qayta olinadi
    if (dc.bufferedAmount > HIGH_WATER) {
      overflow = true;
      return;
    }
    const small = json.length <= CHUNK;
    if (small && !queued) {
      sendText(`e${json}`);
      return;
    }
    enqueue(async () => {
      if (small) sendText(`e${json}`);
      else if (zip) sendZipped(await gzip(json));
      else sendChunked(json);
    });
  };

  const full = () => {
    try {
      record.takeFullSnapshot(true);
    } catch {
      /* yozuv to‘xtagan */
    }
  };

  dc.bufferedAmountLowThreshold = 512 * 1024;
  const onLow = () => {
    if (!overflow || stopped) return;
    overflow = false;
    full();
  };
  dc.addEventListener("bufferedamountlow", onLow);

  sendText("S");
  let stopRecord: (() => void) | undefined;
  try {
    stopRecord = record({
      emit: (ev) => push(JSON.stringify(ev)),
      blockSelector: "[data-call-ui]",
      maskInputOptions: { password: true },
      slimDOMOptions: "all",
      sampling: { mousemove: false, mouseInteraction: false, scroll: 100, media: 800, input: "last" },
      recordCanvas: false,
      collectFonts: false,
      inlineImages: false,
      inlineStylesheet: true,
      recordCrossOriginIframes: false,
    });
  } catch {
    stopRecord = undefined;
  }
  if (!stopRecord) {
    dc.removeEventListener("bufferedamountlow", onLow);
    sendText("X");
    return null;
  }
  setMirrorNodeResolver((id) => record.mirror.getNode(id));

  return {
    full,
    sentBytes: () => sent,
    stop: () => {
      if (stopped) return;
      stopped = true;
      setMirrorNodeResolver(null);
      try {
        stopRecord?.();
      } catch {
        /* */
      }
      dc.removeEventListener("bufferedamountlow", onLow);
      enqueue(() => sendText("X"));
    },
  };
}
