import { Outlet } from "react-router-dom";

export default function DoctorLayout() {
	return (
		<div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50">
			<Outlet />
		</div>
	);
}
