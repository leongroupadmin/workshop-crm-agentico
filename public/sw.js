/* Service worker mínimo para derivaciones. Se mantiene sin bundler para que
   viva exactamente en /sw.js y pueda controlar todo el CRM. */
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }

  event.waitUntil(
    self.registration.showNotification(data.title || "Nueva derivación", {
      body: data.body || "Hay un chat esperando atención.",
      icon: "/logo.png",
      tag: data.tag || "derivacion",
      renotify: true,
      data: { url: data.url || "/?vista=conversaciones" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const destination = new URL(event.notification.data?.url || "/", self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (clients) => {
      for (const client of clients) {
        if ("navigate" in client) await client.navigate(destination);
        if ("focus" in client) return client.focus();
      }
      return self.clients.openWindow ? self.clients.openWindow(destination) : undefined;
    }),
  );
});
