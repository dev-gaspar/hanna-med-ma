import { useRegisterSW } from "virtual:pwa-register/react";
import { Wifi, X } from "lucide-react";
import { useEffect } from "react";

export default function ReloadPrompt() {
	const {
		offlineReady: [offlineReady, setOfflineReady],
		needRefresh: [needRefresh, setNeedRefresh],
	} = useRegisterSW({
		onRegisteredSW(_swUrl, registration) {
			// Check for updates every 60 minutes
			if (registration) {
				setInterval(
					() => {
						registration.update();
					},
					60 * 60 * 1000,
				);
			}
		},
		onRegisterError(error) {
			console.error("SW registration error", error);
		},
	});

	// Auto-dismiss "offline ready" after 3 seconds
	useEffect(() => {
		if (offlineReady) {
			const timer = setTimeout(() => setOfflineReady(false), 3000);
			return () => clearTimeout(timer);
		}
	}, [offlineReady, setOfflineReady]);

	const close = () => {
		setOfflineReady(false);
		setNeedRefresh(false);
	};

	if (!offlineReady && !needRefresh) return null;

	return (
		<div className="fixed bottom-4 right-4 z-50 p-3 bg-white dark:bg-slate-800 rounded-xl shadow-lg border border-slate-200 dark:border-slate-700 max-w-xs animate-in slide-in-from-bottom-5 fade-in duration-300">
			<div className="flex items-center gap-2">
				<Wifi className="w-4 h-4 text-green-500 flex-shrink-0" />
				<p className="text-xs text-slate-600 dark:text-slate-300 flex-1">
					{offlineReady
						? "App ready for offline use"
						: "New version available — reloading..."}
				</p>
				<button
					onClick={close}
					className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
				>
					<X className="w-3.5 h-3.5" />
				</button>
			</div>
		</div>
	);
}
