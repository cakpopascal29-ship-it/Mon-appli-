self.addEventListener('install', (event) => {
self.skipWaiting();
});

self.addEventListener('activate', (event) => {
event.waitUntil(
self.clients.claim()
);
});

/* =========================================================
NOTIFICATION PUSH
========================================================= */

self.addEventListener('push', (event) => {

if (!event.data) {
return;
}

const data = event.data.json();

const title = data.title || "AFRIQ'Sender";

const options = {
body: data.body || 'Nouveau message',
icon: data.icon || '/icon-192.png',
badge: data.badge || '/icon-192.png',
vibrate: [200, 100, 200],
tag: 'afriqs-message',
renotify: true,
data: {
url: data.url || '/chat.html'
}
};

event.waitUntil(

self.clients.matchAll({
  type: 'window',
  includeUncontrolled: true
}).then((clients) => {

  const applicationVisible = clients.some(
    client => client.visibilityState === 'visible'
  );

  /*
   * Si AFRIQ'Sender est déjà visible,
   * chat.html gère le message.
   *
   * On évite donc une deuxième notification.
   */

  if (applicationVisible) {
    return;
  }

  return self.registration.showNotification(
    title,
    options
  );
})

);
});

/* =========================================================
CLIC SUR NOTIFICATION
========================================================= */

self.addEventListener('notificationclick', (event) => {

event.notification.close();

const url =
event.notification.data &&
event.notification.data.url
? event.notification.data.url
: '/chat.html';

event.waitUntil(

self.clients.matchAll({
  type: 'window',
  includeUncontrolled: true
}).then((clients) => {

  for (const client of clients) {

    if ('focus' in client) {

      client.focus();

      if ('navigate' in client) {
        return client.navigate(url);
      }

      return client;
    }
  }

  if (self.clients.openWindow) {
    return self.clients.openWindow(url);
  }

})

);
});
