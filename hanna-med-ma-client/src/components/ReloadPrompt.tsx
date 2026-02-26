import { useRegisterSW } from "virtual:pwa-register/react";
import { Wifi, RefreshCw, X } from "lucide-react";
import { useEffect, useRef, useCallback } from "react";

/**
 * PWA ReloadPrompt — uses "prompt" registerType to avoid uncontrolled reloads.
 *
 * - offlineReady: shown briefly when the app is cached for offline use.
 * - needRefresh: shown when a new SW is waiting; user chooses when to reload.
 *
 * This prevents the reload-loop caused by autoUpdate + multiple service
 * workers (VitePWA + Firebase Messaging) competing for the same scope.
 */
export default function ReloadPrompt() {
	const updateCheckInterval = useRef<
		ReturnType<typeof setInterval> | undefined
	>(undefined);

	const {
		offlineReady: [offlineReady, setOfflineReady],
		needRefresh: [needRefresh, setNeedRefresh],
		updateServiceWorker,
	} = useRegisterSW({
		onRegisteredSW(_swUrl, registration) {
			if (registration) {
				// Check for updates every 60 minutes (safe interval, no reload triggered)
				updateCheckInterval.current = setInterval(
					() => registration.update(),
					60 * 60 * 1000,
				);
			}
		},
		onRegisterError(error) {
			console.error("SW registration error", error);
		},
	});

	// Cleanup interval on unmount
	useEffect(() => {
		return () => {
			if (updateCheckInterval.current) {
				clearInterval(updateCheckInterval.current);
			}
		};
	}, []);

	// Auto-dismiss "offline ready" after 3 seconds
	useEffect(() => {
		if (offlineReady) {
			const timer = setTimeout(() => setOfflineReady(false), 3000);
			return () => clearTimeout(timer);
		}
	}, [offlineReady, setOfflineReady]);

	// Accept update: activates the waiting SW and performs a single controlled reload
	const acceptUpdate = useCallback(() => {
		updateServiceWorker(true);
	}, [updateServiceWorker]);

	const close = () => {
		setOfflineReady(false);
		setNeedRefresh(false);
	};

	if (!offlineReady && !needRefresh) return null;

	return (
		<div className="fixed bottom-4 right-4 z-50 p-3 bg-white dark:bg-slate-800 rounded-xl shadow-lg border border-slate-200 dark:border-slate-700 max-w-xs animate-in slide-in-from-bottom-5 fade-in duration-300">
			<div className="flex items-center gap-2">
				{offlineReady ? (
					<>
						<Wifi className="w-4 h-4 text-green-500 flex-shrink-0" />
						<p className="text-xs text-slate-600 dark:text-slate-300 flex-1">
							App lista para uso offline
						</p>
						<button
							onClick={close}
							className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
						>
							<X className="w-3.5 h-3.5" />
						</button>
					</>
				) : (
					<>
						<RefreshCw className="w-4 h-4 text-blue-500 flex-shrink-0" />
						<p className="text-xs text-slate-600 dark:text-slate-300 flex-1">
							Nueva versión disponible
						</p>
						<button
							onClick={acceptUpdate}
							className="text-xs font-medium px-2 py-1 rounded-md bg-blue-600 text-white hover:bg-blue-700 transition-colors"
						>
							Actualizar
						</button>
						<button
							onClick={close}
							className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
						>
							<X className="w-3.5 h-3.5" />
						</button>
					</>
				)}
			</div>
		</div>
	);
}
