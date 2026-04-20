import { useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { Home, Command, User, Shield, LogOut } from "lucide-react";
import { doctorAuthService } from "../../services/doctorAuthService";
import { DoctorDataProvider } from "../../contexts/DoctorDataContext";
import { DoctorChatProvider } from "../../contexts/DoctorChatContext";
import ThemeToggle from "../ThemeToggle";
import { cls } from "../../lib/cls";

/**
 * Chrome shared by every doctor-portal screen.
 *
 * Two layouts sharing the same render tree:
 *   • Mobile (<md): top header with brand + HIPAA + theme toggle, content
 *     fills the middle, and a bottom tab bar (Round / Chat / Me).
 *   • Desktop (>=md): a fixed sidebar on the left carries brand, doctor
 *     name, vertical nav, HIPAA + theme + sign out. No top header, no
 *     bottom tabs. Main content takes the remaining width.
 *
 * Individual screens don't care which layout is active — they just fill
 * the outlet. The mobile top header can be suppressed with
 * `hideTopBar` (currently unused but kept for future full-bleed screens).
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

	const handleLogout = () => {
		doctorAuthService.logout();
		// Hard reload to clear any cached data/sockets.
		window.location.href = "/";
	};

	return (
		<DoctorDataProvider>
			<DoctorChatProvider>
				<div className="h-[100dvh] overflow-hidden bg-n-50 flex flex-col md:flex-row pt-[env(safe-area-inset-top)] relative">
					{/* ─── Desktop sidebar ─── */}
					<aside className="hidden md:flex w-[220px] shrink-0 flex-col bg-n-0 border-r border-n-150">
						<div className="h-14 px-4 border-b border-n-150 flex items-center gap-2.5">
							<div className="w-7 h-7 rounded-md bg-p-700 grid place-items-center font-serif text-white text-[13px] shrink-0">
								H
							</div>
							<div className="flex flex-col min-w-0">
								<h1 className="font-serif text-[14px] font-medium text-n-900 leading-none truncate">
									Hanna-Med
								</h1>
								<span className="font-mono text-[10px] uppercase tracking-wider text-n-500 mt-0.5 truncate">
									Dr. {doctor?.name}
								</span>
							</div>
						</div>

						<nav className="flex-1 p-2.5">
							<ul className="space-y-0.5">
								{tabs.map((t) => {
									const Icon = t.icon;
									return (
										<li key={t.to}>
											<NavLink
												to={t.to}
												className={({ isActive }) =>
													cls(
														"flex items-center gap-2.5 px-2.5 h-9 rounded-md text-[13px] transition",
														isActive
															? "bg-n-100 text-n-900 font-medium"
															: "text-n-600 hover:text-n-900 hover:bg-n-50",
													)
												}
											>
												{({ isActive }) => (
													<>
														<Icon
															className={cls(
																"w-4 h-4",
																isActive ? "text-n-900" : "text-n-500",
															)}
														/>
														<span>{t.label}</span>
													</>
												)}
											</NavLink>
										</li>
									);
								})}
							</ul>
						</nav>

						<div className="p-2.5 border-t border-n-150 space-y-0.5">
							<div className="flex items-center justify-between px-2.5 h-9">
								<span className="font-mono text-[10.5px] uppercase tracking-widest text-n-500 inline-flex items-center gap-1.5">
									<Shield className="w-3 h-3" /> HIPAA
								</span>
								<ThemeToggle />
							</div>
							<button
								onClick={handleLogout}
								className="w-full flex items-center gap-2.5 px-2.5 h-9 text-[13px] text-n-600 hover:text-n-900 hover:bg-n-50 rounded-md transition"
							>
								<LogOut className="w-4 h-4 text-n-500" />
								<span>Sign out</span>
							</button>
						</div>
					</aside>

					{/* ─── Main column ─── */}
					<div className="flex-1 flex flex-col min-h-0 relative">
						{/* Mobile-only top header */}
						{!hideTopBar && (
							<header className="md:hidden bg-n-0 border-b border-n-150 shrink-0">
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

						{/* Mobile-only bottom tabs */}
						<BottomTabs tabs={tabs} />
					</div>
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
			className="md:hidden shrink-0 h-[64px] bg-n-0 border-t border-n-150 flex items-stretch pb-[env(safe-area-inset-bottom)]"
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
