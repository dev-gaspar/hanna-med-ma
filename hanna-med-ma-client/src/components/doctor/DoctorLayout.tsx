import { useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { Home, Command, User, Shield } from "lucide-react";
import { doctorAuthService } from "../../services/doctorAuthService";
import { DoctorDataProvider } from "../../contexts/DoctorDataContext";
import { DoctorChatProvider } from "../../contexts/DoctorChatContext";
import ThemeToggle from "../ThemeToggle";
import { cls } from "../../lib/cls";

/**
 * Chrome shared by every doctor-portal screen:
 *   • Top header with brand + doctor name + HIPAA + theme toggle.
 *   • Bottom nav (mobile-first) for Round · Chat · Me.
 *
 * The Chat screen opts out of the top header because it owns its own
 * streaming-aware header; everything else gets this shell.
 */
export default function DoctorLayout({
	hideTopBar = false,
}: {
	hideTopBar?: boolean;
}) {
	// Read doctor once — see TodaysRound for context.
	const [doctor] = useState(() => doctorAuthService.getCurrentDoctor());

	const tabs = [
		{ to: "/doctor/round", label: "Round", icon: Home },
		{ to: "/doctor/chat", label: "Chat", icon: Command },
		{ to: "/doctor/me", label: "Me", icon: User },
	];

	return (
		<DoctorDataProvider>
			<DoctorChatProvider>
			<div className="h-[100dvh] overflow-hidden bg-n-50 flex flex-col pt-[env(safe-area-inset-top)] relative">
				{!hideTopBar && (
					<header className="bg-n-0 border-b border-n-150 shrink-0">
						<div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
							<div className="flex items-center gap-2.5">
								<div className="w-7 h-7 rounded-md bg-p-700 grid place-items-center font-serif text-white text-[13px]">
									H
								</div>
								<div className="flex flex-col">
									<h1 className="font-serif text-[15px] font-medium text-n-900 leading-none">
										Hanna-Med
									</h1>
									<span className="font-mono text-[10px] uppercase tracking-wider text-n-500 mt-0.5">
										Dr. {doctor?.name}
									</span>
								</div>
							</div>
							<div className="flex items-center gap-1">
								<div className="hidden sm:inline-flex items-center gap-1.5 text-[10.5px] font-mono uppercase tracking-wider text-n-500 mr-1">
									<Shield className="w-3 h-3" /> HIPAA
								</div>
								<ThemeToggle />
							</div>
						</div>
					</header>
				)}

				<div className="flex-1 flex flex-col min-h-0 relative">
					<Outlet />
				</div>

				<BottomTabs tabs={tabs} />
			</div>
			</DoctorChatProvider>
		</DoctorDataProvider>
	);
}

function BottomTabs({
	tabs,
}: {
	tabs: { to: string; label: string; icon: React.ComponentType<{ className?: string }> }[];
}) {
	const location = useLocation();
	return (
		<nav
			className="shrink-0 h-[64px] bg-n-0 border-t border-n-150 flex items-stretch pb-[env(safe-area-inset-bottom)]"
			aria-label="Doctor navigation"
		>
			{tabs.map((t) => {
				const Icon = t.icon;
				const active =
					location.pathname === t.to ||
					location.pathname.startsWith(t.to + "/");
				return (
					<NavLink
						key={t.to}
						to={t.to}
						className="flex-1 flex flex-col items-center justify-center gap-1 text-[10px] font-mono uppercase tracking-wider focus:outline-none"
					>
						<Icon
							className={cls(
								"w-[18px] h-[18px] transition",
								active ? "text-n-900" : "text-n-400",
							)}
						/>
						<span
							className={cls(
								"transition",
								active ? "text-n-900" : "text-n-400",
							)}
						>
							{t.label}
						</span>
					</NavLink>
				);
			})}
		</nav>
	);
}
