import { Link, useLocation, useNavigate } from "react-router-dom";
import {
	LayoutDashboard,
	Users,
	Stethoscope,
	Sparkles,
	Key,
	Monitor,
	LogOut,
	X,
} from "lucide-react";
import { authService } from "../services/authService";
import ThemeToggle from "./ThemeToggle";
import { IconButton } from "./ui/IconButton";
import { cls } from "../lib/cls";

interface SidebarProps {
	isOpen: boolean;
	onClose: () => void;
}

export default function Sidebar({ isOpen, onClose }: SidebarProps) {
	const location = useLocation();
	const navigate = useNavigate();
	const user = authService.getCurrentUser();

	const handleLogout = () => {
		authService.logout();
		navigate("/admin/login");
	};

	const menuItems = [
		{ path: "/admin/dashboard", icon: LayoutDashboard, label: "Dashboard" },
		{ path: "/admin/dashboard/users", icon: Users, label: "Users" },
		{ path: "/admin/dashboard/doctors", icon: Stethoscope, label: "Doctors" },
		{
			path: "/admin/dashboard/specialties",
			icon: Sparkles,
			label: "Specialties",
		},
		{ path: "/admin/dashboard/rpas", icon: Monitor, label: "RPA Nodes" },
		{ path: "/admin/dashboard/credentials", icon: Key, label: "Credentials" },
	];

	return (
		<aside
			className={cls(
				"fixed inset-y-0 left-0 z-40 w-[220px] bg-n-0 border-r border-n-150 flex flex-col transition-transform duration-200",
				"lg:static lg:translate-x-0",
				isOpen ? "translate-x-0" : "-translate-x-full",
			)}
		>
			<div className="h-14 px-4 border-b border-n-150 flex items-center justify-between">
				<div className="flex items-center gap-2 min-w-0">
					<div className="w-6 h-6 rounded bg-p-700 grid place-items-center font-serif text-white text-[11px] shrink-0">
						H
					</div>
					<div className="min-w-0">
						<div className="font-serif text-[13px] text-n-900 leading-none truncate">
							Hanna-Med
						</div>
						<div className="font-mono text-[9.5px] uppercase tracking-widest text-n-500 mt-0.5 truncate">
							{user?.name || "Admin"}
						</div>
					</div>
				</div>
				<IconButton
					onClick={onClose}
					aria-label="Close menu"
					className="lg:hidden"
				>
					<X className="w-4 h-4" />
				</IconButton>
			</div>

			<nav className="flex-1 p-2.5">
				<ul className="space-y-0.5">
					{menuItems.map((item) => {
						const Icon = item.icon;
						const isActive =
							location.pathname === item.path ||
							(item.path === "/admin/dashboard" &&
								location.pathname === "/admin/dashboard/");
						return (
							<li key={item.path}>
								<Link
									to={item.path}
									onClick={onClose}
									className={cls(
										"flex items-center gap-2.5 px-2.5 h-9 rounded-md text-[13px] transition",
										isActive
											? "bg-n-100 text-n-900 font-medium"
											: "text-n-600 hover:text-n-900 hover:bg-n-50",
									)}
								>
									<Icon
										className={cls(
											"w-4 h-4",
											isActive ? "text-n-900" : "text-n-500",
										)}
									/>
									<span>{item.label}</span>
								</Link>
							</li>
						);
					})}
				</ul>
			</nav>

			<div className="p-2.5 border-t border-n-150 space-y-0.5">
				<div className="flex items-center justify-between px-2.5 h-9">
					<span className="font-mono text-[10.5px] uppercase tracking-widest text-n-500">
						Theme
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
	);
}
