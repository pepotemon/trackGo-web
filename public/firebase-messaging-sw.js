importScripts("https://www.gstatic.com/firebasejs/10.13.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.13.2/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyDudxzz7lU7qUFhxrYkXacIZeppwAqSsK4",
  authDomain: "trackgo-f2461.firebaseapp.com",
  projectId: "trackgo-f2461",
  storageBucket: "trackgo-f2461.firebasestorage.app",
  messagingSenderId: "31593558566",
  appId: "1:31593558566:web:7571b92670d4e38b132ce7",
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const title = payload.notification?.title || payload.data?.title || "TrackGo";
  const body = payload.notification?.body || payload.data?.body || "";
  const url = payload.fcmOptions?.link || payload.data?.link || "/user/leads";

  self.registration.showNotification(title, {
    body,
    icon: "/icons/icon-192.png",
    badge: "/icons/favicon-32.png",
    tag: payload.data?.clientId ? `client_${payload.data.clientId}` : "trackgo_client",
    renotify: true,
    data: { url },
  });
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification?.data?.url || "/user/leads";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      return clients.openWindow(url);
    })
  );
});
