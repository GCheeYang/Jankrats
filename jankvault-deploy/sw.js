/* Jank Vault service worker — exists solely to receive Web Push events and
   show a notification. No offline caching (that's a separate concern this
   app doesn't need yet). */

self.addEventListener("push", function (event) {
  var data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) {
    data = { title: "Jank Vault", body: event.data ? event.data.text() : "" };
  }
  var title = data.title || "Jank Vault";
  var options = {
    body: data.body || "",
    icon: data.icon || undefined,
    badge: data.badge || undefined,
    data: { url: data.url || "./" }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  var url = (event.notification.data && event.notification.data.url) || "./";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        if ("focus" in list[i]) return list[i].focus();
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
