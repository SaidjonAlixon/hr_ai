/* VAKSINA HR — Web Push + GPS keepalive service worker */
self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

/** Mijozlarni uyg‘otish — GPS qayta yuborilsin */
function nudgeClients() {
  return self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    for (const client of list) {
      try {
        client.postMessage({ type: "vaksina-gps-nudge" });
      } catch (_) {}
    }
  });
}

// ---------------------------------------------------------------- qo‘ng‘iroqlar

/** Javob berilgan / tugagan qo‘ng‘iroqlar — jiringlash takrorlanmasin */
const stoppedCalls = new Set();
const ringingCalls = new Set();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const callTag = (id) => `call-${id}`;

/** Faqat jiringlayotgan bildirishnoma yopiladi («Javobsiz qo‘ng‘iroq» qoladi) */
function closeCallNotifications(id) {
  return self.registration
    .getNotifications({ tag: callTag(id) })
    .then((list) => list.forEach((n) => n.data && n.data.kind === "call" && n.close()))
    .catch(() => undefined);
}

function showCallNotification(d) {
  return self.registration.showNotification(d.title || "📞 Qo‘ng‘iroq", {
    body: d.body || "Sizga qo‘ng‘iroq qilishmoqda",
    icon: "/faviconni.png",
    badge: "/faviconni.png",
    tag: callTag(d.callId),
    renotify: true,
    requireInteraction: true,
    silent: false,
    vibrate: [700, 300, 700, 300, 700, 300, 700],
    actions: [
      { action: "answer", title: "🟢 Ko‘tarish" },
      { action: "decline", title: "🔴 Rad etish" },
    ],
    data: { kind: "call", callId: d.callId, url: `/qongiroq?call=${d.callId}` },
  });
}

/** Bildirishnoma har 5 soniyada qayta chiqadi — telefon ovozi va tebranishi jiringlashdek takrorlanadi */
async function ringLoop(d) {
  const id = d.callId;
  if (!id || ringingCalls.has(id) || stoppedCalls.has(id)) return;
  ringingCalls.add(id);
  try {
    const until = Date.now() + Math.min(Number(d.ringMs) || 45000, 55000);
    await showCallNotification(d);
    while (Date.now() < until) {
      await sleep(5000);
      if (stoppedCalls.has(id)) return;
      const open = await self.registration.getNotifications({ tag: callTag(id) });
      if (!open.length || !open.some((n) => n.data && n.data.kind === "call")) return;
      await showCallNotification(d);
    }
    await closeCallNotifications(id);
  } finally {
    ringingCalls.delete(id);
  }
}

function hasFocusedClient() {
  return self.clients
    .matchAll({ type: "window", includeUncontrolled: true })
    .then((list) => list.some((c) => c.focused && c.visibilityState === "visible"));
}

function postToClients(msg) {
  return self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    for (const c of list) {
      try {
        c.postMessage(msg);
      } catch (_) {}
    }
    return list;
  });
}

async function handleCallPush(d) {
  if (d.kind === "call-end") {
    stoppedCalls.add(d.callId);
    await closeCallNotifications(d.callId);
    if (d.missed && !(await hasFocusedClient())) {
      await self.registration.showNotification(d.title || "📵 Javobsiz qo‘ng‘iroq", {
        body: d.body || "",
        icon: "/faviconni.png",
        badge: "/faviconni.png",
        tag: callTag(d.callId),
        data: { kind: "missed", url: "/qongiroq" },
      });
    }
    return;
  }
  // Ilova ochiq va ko‘z oldida — ekranning o‘zida jiringlaydi
  if (await hasFocusedClient()) {
    await nudgeClients();
    return;
  }
  await Promise.all([ringLoop(d), nudgeClients()]);
}

async function openForCall(id, answer) {
  const list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  if (list.length) {
    const target = list.find((c) => c.focused) || list.find((c) => c.visibilityState === "visible") || list[0];
    target.postMessage({ type: "vaksina-call", op: answer ? "answer" : "show", id });
    try {
      await target.focus();
    } catch (_) {}
    return;
  }
  if (self.clients.openWindow) await self.clients.openWindow(`/qongiroq?call=${id}${answer ? "&answer=1" : ""}`);
}

self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data && data.type === "vaksina-gps-ping") {
    event.waitUntil(nudgeClients());
  } else if (data && data.type === "vaksina-call-ring" && data.callId) {
    event.waitUntil(ringLoop(data));
  } else if (data && data.type === "vaksina-call-stop" && data.callId) {
    stoppedCalls.add(data.callId);
    event.waitUntil(closeCallNotifications(data.callId));
  }
});

self.addEventListener("push", (event) => {
  let data = { title: "VAKSINA HR", body: "Yangi bildirishnoma", url: "/", tag: "vaksina-hr" };
  try {
    if (event.data) {
      const parsed = event.data.json();
      data = { ...data, ...parsed };
    }
  } catch (_) {
    try {
      const text = event.data && event.data.text();
      if (text) data.body = text;
    } catch (_) {}
  }

  if (data.kind === "call" || data.kind === "call-end") {
    event.waitUntil(handleCallPush(data));
    return;
  }

  event.waitUntil(
    Promise.all([
      self.registration.showNotification(data.title || "VAKSINA HR", {
        body: data.body || "",
        icon: "/faviconni.png",
        badge: "/faviconni.png",
        tag: data.tag || "vaksina-hr",
        renotify: true,
        requireInteraction: true,
        data: { url: data.url || "/" },
      }),
      nudgeClients(),
    ]),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const nd = event.notification.data || {};
  if (nd.kind === "call" && nd.callId) {
    const id = nd.callId;
    stoppedCalls.add(id);
    if (event.action === "decline") {
      event.waitUntil(
        Promise.all([
          fetch(`/api/calls/${encodeURIComponent(id)}/end`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ reason: "declined" }),
          }).catch(() => undefined),
          postToClients({ type: "vaksina-call", op: "declined", id }),
        ]),
      );
      return;
    }
    event.waitUntil(openForCall(id, event.action === "answer"));
    return;
  }
  const url = nd.url || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    }),
  );
});
