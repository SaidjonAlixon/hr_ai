/* VAKSINA HR — Web Push service worker (Chrome / Safari PWA) */
self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
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

  event.waitUntil(
    self.registration.showNotification(data.title || "VAKSINA HR", {
      body: data.body || "",
      icon: "/faviconni.png",
      badge: "/faviconni.png",
      tag: data.tag || "vaksina-hr",
      renotify: true,
      requireInteraction: true,
      data: { url: data.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
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
