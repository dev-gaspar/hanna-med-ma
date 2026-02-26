import { useRegisterSW } from "virtual:pwa-register/react";
import { Wifi, RefreshCw, X } from "lucide-react";
import { useEffect, useRef, useState, useCallback } from "react";

/** sessionStorage key used to detect "just updated → reload" cycles. */
const UPDATE_FLAG = "pwa-update-pending";
/** Maximum ms after an update-reload where we suppress a re-prompt. */
const UPDATE_WINDOW_MS = 15_000;

/**
 * PWA ReloadPrompt — uses "prompt" registerType to avoid uncontrolled reloads.
 *
 * - offlineReady: shown briefly when the app is cached for offline use.
 * - needRefresh: shown when a new SW is waiting; user chooses when to reload.
 *
 * A sessionStorage circuit-breaker prevents the infinite "update → reload →
 * update" loop that can occur when SKIP_WAITING doesn't fully complete
 * before the page unloads.
 */
export default function ReloadPrompt() {
	const updateCheckInterval = useRef<
		ReturnType<typeof setInterval> | undefined
	>(undefined);
	const [isUpdating, setIsUpdating] = useState(false);

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

	// ── Circuit breaker: suppress the prompt if we JUST completed an update ──
	useEffect(() => {
		if (!needRefresh) return;

		const ts = sessionStorage.getItem(UPDATE_FLAG);
		if (ts) {
			const elapsed = Date.now() - Number(ts);
			sessionStorage.removeItem(UPDATE_FLAG);
			if (elapsed < UPDATE_WINDOW_MS) {
				// We literally just reloaded after an update — suppress the re-prompt
				setNeedRefresh(false);
				return;
			}
		}
	}, [needRefresh, setNeedRefresh]);

	// Auto-dismiss "offline ready" after 3 seconds
	useEffect(() => {
		if (offlineReady) {
			const timer = setTimeout(() => setOfflineReady(false), 3000);
			return () => clearTimeout(timer);
		}
	}, [offlineReady, setOfflineReady]);

	// Accept update: try multiple strategies to activate the waiting SW.
	const acceptUpdate = useCallback(async () => {
		setIsUpdating(true);

		// Mark the timestamp BEFORE reload so the next page load can detect the loop
		sessionStorage.setItem(UPDATE_FLAG, Date.now().toString());

		try {
			// Strategy 1: VitePWA built-in (sends SKIP_WAITING via workbox-window)
			await updateServiceWorker(true);
		} catch {
			// ignore — try manual approach below
		}

		// Strategy 2: Manually post SKIP_WAITING and listen for controllerchange
		try {
			const reg = await navigator.serviceWorker.getRegistration("/");
			if (reg?.waiting) {
				const onControllerChange = () => {
					navigator.serviceWorker.removeEventListener(
						"controllerchange",
						onControllerChange,
					);
					window.location.reload();
				};
				navigator.serviceWorker.addEventListener(
					"controllerchange",
					onControllerChange,
				);
				reg.waiting.postMessage({ type: "SKIP_WAITING" });
			}
		} catch {
			// ignore
		}

		// Strategy 3: Last-resort — if nothing triggers a reload within 5 s
		setTimeout(() => window.location.reload(), 5000);
	}, [updateServiceWorker]);

	const close = () => {
		setOfflineReady(false);
		setNeedRefresh(false);
	};

	if (!offlineReady && !needRefresh) return null;

	return (
		<div className="fixed top-4 right-4 z-50 p-3 bg-white dark:bg-slate-800 rounded-xl shadow-lg border border-slate-200 dark:border-slate-700 max-w-xs animate-in slide-in-from-top-5 fade-in duration-300">
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
						<RefreshCw
							className={`w-4 h-4 text-blue-500 flex-shrink-0 ${isUpdating ? "animate-spin" : ""}`}
						/>
						<p className="text-xs text-slate-600 dark:text-slate-300 flex-1">
							{isUpdating ? "Actualizando..." : "Nueva versión disponible"}
						</p>
						{!isUpdating && (
							<>
								<button
									onClick={acceptUpdate}
									className="text-xs font-medium px-2 py-1 rounded-md bg-blue-600 text-white hover:bg-blue-700 active:bg-blue-800 transition-colors"
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
					</>
				)}
			</div>
		</div>
	);
}
