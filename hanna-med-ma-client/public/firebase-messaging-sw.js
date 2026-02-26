// Firebase Messaging Service Worker
// Handles push notifications when the app is closed or in background.
//
// This SW does NOT need the Firebase JS SDK — push events are standard
// Web Push delivered by FCM. The client-side Firebase SDK handles token
// registration; this SW only needs to display the notification.
//
// Keeping this SW lightweight avoids conflicts with the VitePWA service
// worker and prevents the browser's default "site updated in background"
// notification that appears when a push handler takes too long.

self.addEventListener("push", (event) => {
	if (!event.data) return;

	let payload;
	try {
		payload = event.data.json();
	} catch {
		// Not JSON — ignore
		return;
	}

	// FCM data-only payloads put everything under "data"
	const data = payload.data || payload;
	const title = data.title || "Hanna-Med";
	const body = data.body || "Tienes un nuevo mensaje";

	const options = {
		body,
		icon: "/pwa-192x192.png",
		badge: "/pwa-192x192.png",
		vibrate: [200, 100, 200],
		requireInteraction: true,
		data,
		tag: "hanna-med-notification",
		actions: [{ action: "open", title: "Ver mensaje" }],
	};

	// event.waitUntil ensures the notification is shown before the SW sleeps
	event.waitUntil(self.registration.showNotification(title, options));
});

// Handle notification click
self.addEventListener("notificationclick", (event) => {
	event.notification.close();

	const link = event.notification.data?.link || "/doctor/chat";

	event.waitUntil(
		clients
			.matchAll({ type: "window", includeUncontrolled: true })
			.then((clientList) => {
				// Focus an existing window if open
				for (const client of clientList) {
					if (client.url.includes(link) && "focus" in client) {
						return client.focus();
					}
				}
				// Otherwise open a new tab
				if (clients.openWindow) {
					return clients.openWindow(link);
				}
			}),
	);
});
