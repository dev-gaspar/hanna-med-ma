// Push notification handler — imported by the VitePWA service worker
// via workbox.importScripts. Handles push events that arrive on the
// main SW (e.g. from old FCM subscriptions that were registered at
// scope "/"). Without this, Chrome shows a generic "This site has been
// updated in the background" notification for each unhandled push.

/* eslint-disable no-restricted-globals */

self.addEventListener("push", (event) => {
	// ALWAYS call event.waitUntil — Chrome requires every push event to
	// result in a notification, otherwise it shows a default one.
	event.waitUntil(handlePush(event));
});

async function handlePush(event) {
	let title = "Hanna-Med";
	let body = "Tienes un nuevo mensaje";
	let data = {};

	try {
		if (event.data) {
			let payload;
			try {
				payload = event.data.json();
			} catch {
				// Not JSON — use as plain text body
				try {
					body = event.data.text() || body;
				} catch {
					// ignore
				}
				payload = null;
			}

			if (payload) {
				// Handle all FCM payload shapes:
				//  - data-only:     { data: { title, body, ... } }
				//  - notification:  { notification: { title, body }, data: { ... } }
				//  - flat:          { title, body, ... }
				const d = payload.data || payload.notification || payload;
				title = d.title || title;
				body = d.body || body;
				data = d;
			}
		}
	} catch {
		// Swallow unexpected errors — still show a fallback notification
	}

	return self.registration.showNotification(title, {
		body,
		icon: "/pwa-192x192.png",
		badge: "/pwa-192x192.png",
		vibrate: [200, 100, 200],
		requireInteraction: true,
		data,
		tag: "hanna-med-notification",
		actions: [{ action: "open", title: "Ver mensaje" }],
	});
}

self.addEventListener("notificationclick", (event) => {
	event.notification.close();

	const link = event.notification.data?.link || "/doctor/chat";

	event.waitUntil(
		self.clients
			.matchAll({ type: "window", includeUncontrolled: true })
			.then((clientList) => {
				for (const client of clientList) {
					if (client.url.includes(link) && "focus" in client) {
						return client.focus();
					}
				}
				if (self.clients.openWindow) {
					return self.clients.openWindow(link);
				}
			}),
	);
});
