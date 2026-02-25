import { Navigate } from "react-router-dom";
import { doctorAuthService } from "../../services/doctorAuthService";

interface DoctorProtectedRouteProps {
	children: React.ReactNode;
}

export default function DoctorProtectedRoute({
	children,
}: DoctorProtectedRouteProps) {
	const isAuthenticated = doctorAuthService.isAuthenticated();

	if (!isAuthenticated) {
		return <Navigate to="/doctor/login" replace />;
	}

	return <>{children}</>;
}
