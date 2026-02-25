import { Outlet } from "react-router-dom";
import { useState } from "react";
import Sidebar from "./Sidebar";
import { Menu } from "lucide-react";

export default function DashboardLayout() {
	const [sidebarOpen, setSidebarOpen] = useState(false);

	return (
		<div className="flex min-h-screen bg-background-secondary dark:bg-slate-900 transition-colors duration-300">
			{/* Mobile overlay */}
			{sidebarOpen && (
				<div
					className="fixed inset-0 z-30 bg-black/40 lg:hidden"
					onClick={() => setSidebarOpen(false)}
				/>
			)}

			{/* Sidebar */}
			<Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

			{/* Main content */}
			<div className="flex-1 flex flex-col min-w-0">
				{/* Mobile header */}
				<div className="lg:hidden flex items-center h-12 px-3 bg-white dark:bg-slate-800 border-b border-gray-200 dark:border-slate-700 shrink-0">
					<button
						onClick={() => setSidebarOpen(true)}
						className="p-1.5 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
					>
						<Menu className="w-5 h-5" />
					</button>
					<span className="ml-2 text-sm font-semibold text-gray-800 dark:text-white">
						Hanna-Med MA
					</span>
				</div>

				<main className="flex-1 p-3 lg:p-5">
					<Outlet />
				</main>
			</div>
		</div>
	);
}
