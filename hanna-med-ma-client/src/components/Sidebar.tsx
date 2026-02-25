import { Link, useLocation, useNavigate } from "react-router-dom";
import {
	LayoutDashboard,
	Users,
	Stethoscope,
	Key,
	Monitor,
	LogOut,
	X,
} from "lucide-react";
import { authService } from "../services/authService";
import ThemeToggle from "./ThemeToggle";

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
		{ path: "/admin/dashboard/rpas", icon: Monitor, label: "RPA Nodes" },
		{ path: "/admin/dashboard/credentials", icon: Key, label: "Credentials" },
	];

	return (
		<div
			className={`fixed inset-y-0 left-0 z-40 w-56 bg-primary dark:bg-slate-800 flex flex-col transition-all duration-300
				lg:static lg:translate-x-0
				${isOpen ? "translate-x-0" : "-translate-x-full"}`}
		>
			{/* Logo */}
			<div className="p-4 border-b border-primary-400 dark:border-slate-700 flex items-center justify-between">
				<div>
					<h1 className="text-white text-lg font-bold">Hanna-Med MA</h1>
					<p className="text-primary-100 dark:text-slate-400 text-xs mt-0.5">
						{user?.name || "Admin"}
					</p>
				</div>
				<button
					onClick={onClose}
					className="lg:hidden p-1 text-white/70 hover:text-white rounded transition-colors"
				>
					<X className="w-4 h-4" />
				</button>
			</div>

			{/* Menu */}
			<nav className="flex-1 p-3">
				<ul className="space-y-1">
					{menuItems.map((item) => {
						const Icon = item.icon;
						const isActive = location.pathname === item.path;

						return (
							<li key={item.path}>
								<Link
									to={item.path}
									onClick={onClose}
									className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
										isActive
											? "bg-white dark:bg-slate-700 text-primary dark:text-white font-semibold"
											: "text-white hover:bg-primary-400 dark:hover:bg-slate-700"
									}`}
								>
									<Icon className="w-4 h-4" />
									<span>{item.label}</span>
								</Link>
							</li>
						);
					})}
				</ul>
			</nav>

			{/* Theme Toggle & Logout */}
			<div className="p-3 border-t border-primary-400 dark:border-slate-700 space-y-1">
				<div className="flex items-center justify-between px-3 py-1.5">
					<span className="text-white text-xs font-medium">Theme</span>
					<ThemeToggle />
				</div>
				<button
					onClick={handleLogout}
					className="w-full flex items-center gap-2 px-3 py-2 text-sm text-white hover:bg-primary-400 dark:hover:bg-slate-700 rounded-lg transition-colors"
				>
					<LogOut className="w-4 h-4" />
					<span>Logout</span>
				</button>
			</div>
		</div>
	);
}
