import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// https://vite.dev/config/
export default defineConfig({
	plugins: [
		react(),
		VitePWA({
			registerType: "prompt",
			includeAssets: ["favicon.ico", "apple-touch-icon.png", "mask-icon.svg"],
			manifest: {
				name: "Hanna-Med Medical Assistant",
				short_name: "Hanna-Med",
				description: "AI-Powered Medical Assistant for Physicians",
				theme_color: "#53489E",
				background_color: "#ffffff",
				display: "standalone",
				orientation: "portrait",
				scope: "/",
				start_url: "/doctor/login",
				icons: [
					{
						src: "/pwa-192x192.png",
						sizes: "192x192",
						type: "image/png",
					},
					{
						src: "/pwa-512x512.png",
						sizes: "512x512",
						type: "image/png",
					},
					{
						src: "/pwa-512x512.png",
						sizes: "512x512",
						type: "image/png",
						purpose: "any maskable",
					},
				],
			},
			workbox: {
				// HIPAA-Safe Caching: Only cache static assets, NEVER cache API responses
				globPatterns: ["**/*.{js,css,html,ico,png,svg,woff,woff2}"],
				// Exclude Firebase messaging SW from precache — it's a separate SW
				// that handles push notifications independently. Including it causes
				// false "new version available" prompts on every build.
				globIgnores: ["**/firebase-messaging-sw.js"],
				// Explicitly exclude API routes from caching (HIPAA compliance)
				navigateFallbackDenylist: [/^\/api/, /^\/auth/],
				runtimeCaching: [
					{
						// Cache Google Fonts
						urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
						handler: "CacheFirst",
						options: {
							cacheName: "google-fonts-cache",
							expiration: {
								maxEntries: 10,
								maxAgeSeconds: 60 * 60 * 24 * 365, // 1 year
							},
							cacheableResponse: {
								statuses: [0, 200],
							},
						},
					},
					{
						// Cache font files
						urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
						handler: "CacheFirst",
						options: {
							cacheName: "gstatic-fonts-cache",
							expiration: {
								maxEntries: 10,
								maxAgeSeconds: 60 * 60 * 24 * 365, // 1 year
							},
							cacheableResponse: {
								statuses: [0, 200],
							},
						},
					},
					// DO NOT cache API responses - HIPAA compliance
					// All API calls go to network only
				],
			},
			devOptions: {
				enabled: false,
			},
		}),
	],
});
