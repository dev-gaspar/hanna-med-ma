// Firebase Messaging Service Worker
// Handles push notifications when the app is closed or in background.
//
// CRITICAL: event.waitUntil() MUST be called for every push event.
// If it isn't, Chrome shows a generic "This site has been updated in the
// background" notification, which is confusing to users.

self.addEventListener("push", (event) => {
	// ALWAYS wrap in event.waitUntil — no early returns before this call
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
		icon: "/favicon.ico",
		badge: "/favicon.ico",
		vibrate: [200, 100, 200],
		requireInteraction: true,
		data,
		tag: "hanna-med-notification",
		actions: [{ action: "open", title: "Ver mensaje" }],
	});
}

// Handle notification click
self.addEventListener("notificationclick", (event) => {
	event.notification.close();

	const link = event.notification.data?.link || "/doctor/chat";

	event.waitUntil(
		clients
			.matchAll({ type: "window", includeUncontrolled: true })
			.then((clientList) => {
				for (const client of clientList) {
					if (client.url.includes(link) && "focus" in client) {
						return client.focus();
					}
				}
				if (clients.openWindow) {
					return clients.openWindow(link);
				}
			}),
	);
});
