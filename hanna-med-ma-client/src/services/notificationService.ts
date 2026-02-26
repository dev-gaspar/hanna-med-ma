import { getFirebaseMessaging, getToken, onMessage } from "../lib/firebase";
import api from "../lib/api";

const VAPID_KEY =
	"BOupYVvw0h5Y2zpIpnLASk7fYOEe_pF6M0LKl_DnK64QF-r2Gwrr4_a817bgfU94HKiKsgThjb0aYmBrhOtlTNk";

export const notificationService = {
	/**
	 * Request permission for push notifications
	 */
	async requestPermission(): Promise<boolean> {
		try {
			if (!("Notification" in window)) {
				console.warn("This browser does not support notifications");
				return false;
			}

			const permission = await Notification.requestPermission();
			return permission === "granted";
		} catch (error) {
			console.error("Error requesting notification permission:", error);
			return false;
		}
	},

	/**
	 * Get FCM token for this device
	 */
	async getToken(): Promise<string | null> {
		try {
			const messaging = await getFirebaseMessaging();
			if (!messaging) return null;

			// Register the Firebase SW with a SPECIFIC scope to avoid conflicting
			// with the VitePWA service worker (which uses scope '/').
			// Without this, both SWs fight for the same scope causing reload loops.
			const registration = await navigator.serviceWorker.register(
				"/firebase-messaging-sw.js",
				{ scope: "/firebase-cloud-messaging-push-scope" },
			);

			const token = await getToken(messaging, {
				vapidKey: VAPID_KEY,
				serviceWorkerRegistration: registration,
			});

			if (token) {
				console.log("FCM Token obtained:", token.substring(0, 20) + "...");
				return token;
			}

			console.warn("No FCM token available");
			return null;
		} catch (error) {
			console.error("Error getting FCM token:", error);
			return null;
		}
	},

	/**
	 * Register token with the server
	 */
	async registerTokenWithServer(token: string): Promise<void> {
		try {
			await api.post("/notifications/register-token", { token });
			console.log("FCM token registered with server");
		} catch (error) {
			console.error("Error registering FCM token with server:", error);
		}
	},

	/**
	 * Handle foreground messages - when app is open
	 * These should NOT show a notification, just refresh the chat
	 */
	onForegroundMessage(callback: (payload: unknown) => void): void {
		getFirebaseMessaging().then((messaging) => {
			if (!messaging) return;

			onMessage(messaging, (payload) => {
				console.log("Foreground message received:", payload);
				// Don't show notification - just call the callback to refresh chat
				callback(payload);
			});
		});
	},

	/**
	 * Unregister token from server (for logout)
	 */
	async unregisterToken(token: string): Promise<void> {
		try {
			await api.delete("/notifications/unregister-token", { data: { token } });
			console.log("FCM token unregistered from server");
		} catch (error) {
			console.error("Error unregistering FCM token:", error);
		}
	},

	/**
	 * Initialize notifications - combines all setup steps
	 */
	async initialize(): Promise<string | null> {
		const permissionGranted = await this.requestPermission();
		if (!permissionGranted) {
			console.log("Notification permission not granted");
			return null;
		}

		const token = await this.getToken();
		if (token) {
			await this.registerTokenWithServer(token);
		}

		return token;
	},
};
