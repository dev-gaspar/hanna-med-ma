import { Outlet } from "react-router-dom";
import { useState } from "react";
import Sidebar from "./Sidebar";
import { Menu } from "lucide-react";
import { IconButton } from "./ui/IconButton";

export default function DashboardLayout() {
	const [sidebarOpen, setSidebarOpen] = useState(false);

	return (
		<div className="flex min-h-screen bg-n-50">
			{sidebarOpen && (
				<div
					className="fixed inset-0 z-30 bg-n-900/40 backdrop-blur-[2px] lg:hidden"
					onClick={() => setSidebarOpen(false)}
				/>
			)}

			<Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

			<div className="flex-1 flex flex-col min-w-0">
				<div className="lg:hidden flex items-center h-12 px-3 bg-n-0 border-b border-n-150 shrink-0">
					<IconButton
						onClick={() => setSidebarOpen(true)}
						aria-label="Open menu"
					>
						<Menu className="w-4 h-4" />
					</IconButton>
					<div className="ml-2 flex items-center gap-2">
						<div className="w-5 h-5 rounded bg-p-700 grid place-items-center font-serif text-white text-[10px]">
							H
						</div>
						<span className="font-serif text-[13px] text-n-900">
							Hanna-Med · Admin
						</span>
					</div>
				</div>

				<main className="flex-1 p-4 lg:p-6 overflow-x-hidden">
					<Outlet />
				</main>
			</div>
		</div>
	);
}
