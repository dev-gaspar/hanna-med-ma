// Firebase Messaging Service Worker
// This runs in the background to receive push notifications when app is closed

importScripts(
	"https://www.gstatic.com/firebasejs/10.7.0/firebase-app-compat.js",
);
importScripts(
	"https://www.gstatic.com/firebasejs/10.7.0/firebase-messaging-compat.js",
);

// Firebase configuration - must match the app config
firebase.initializeApp({
	apiKey: "AIzaSyBxOWLfjLm8abnPTU5o9sT-gcgoaphi_sU",
	authDomain: "hanna-med-ma-b2639.firebaseapp.com",
	projectId: "hanna-med-ma-b2639",
	storageBucket: "hanna-med-ma-b2639.firebasestorage.app",
	messagingSenderId: "784950868961",
	appId: "1:784950868961:web:83b3b4cb20e77afdeff0a0",
});

const messaging = firebase.messaging();

// Handle background messages (data-only payloads)
messaging.onBackgroundMessage((payload) => {
	console.log(
		"[firebase-messaging-sw.js] Received background message:",
		payload,
	);

	// Data-only payload: title/body come from payload.data
	const notificationTitle = payload.data?.title || "Hanna-Med";
	const notificationOptions = {
		body: payload.data?.body || "Tienes un nuevo mensaje",
		icon: "/pwa-192x192.png",
		badge: "/pwa-192x192.png",
		vibrate: [200, 100, 200],
		requireInteraction: true,
		data: payload.data,
		tag: "hanna-med-notification", // Prevents stacking duplicate notifications
		actions: [
			{
				action: "open",
				title: "Ver mensaje",
			},
		],
	};

	self.registration.showNotification(notificationTitle, notificationOptions);
});

// Handle notification click
self.addEventListener("notificationclick", (event) => {
	console.log("[firebase-messaging-sw.js] Notification click:", event);

	event.notification.close();

	// Navigate to chat page when notification is clicked
	event.waitUntil(
		clients
			.matchAll({ type: "window", includeUncontrolled: true })
			.then((clientList) => {
				// If a window is already open, focus it
				for (const client of clientList) {
					if (client.url.includes("/doctor/chat") && "focus" in client) {
						return client.focus();
					}
				}
				// Otherwise, open a new window
				if (clients.openWindow) {
					return clients.openWindow("/doctor/chat");
				}
			}),
	);
});
