import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";

// Public Pages
import LandingPage from "./pages/LandingPage";

// Admin Pages
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Users from "./pages/Users";
import Doctors from "./pages/Doctors";
import RPAs from "./pages/RPAs";
import Credentials from "./pages/Credentials";

// Admin Components
import DashboardLayout from "./components/DashboardLayout";
import ProtectedRoute from "./components/ProtectedRoute";

// Doctor Pages
import DoctorLogin from "./pages/doctor/DoctorLogin";
import DoctorChat from "./pages/doctor/DoctorChat";

// Doctor Components
import DoctorProtectedRoute from "./components/doctor/DoctorProtectedRoute";
import ReloadPrompt from "./components/ReloadPrompt";

function App() {
	return (
		<BrowserRouter>
			<ReloadPrompt />
			<Routes>
				{/* Public Routes */}
				<Route path="/" element={<LandingPage />} />

				{/* Doctor Portal Routes */}
				<Route path="/doctor/login" element={<DoctorLogin />} />
				<Route
					path="/doctor/chat"
					element={
						<DoctorProtectedRoute>
							<DoctorChat />
						</DoctorProtectedRoute>
					}
				/>
				<Route
					path="/doctor"
					element={<Navigate to="/doctor/chat" replace />}
				/>

				{/* Admin Portal Routes */}
				<Route path="/admin/login" element={<Login />} />
				<Route
					path="/admin/dashboard"
					element={
						<ProtectedRoute>
							<DashboardLayout />
						</ProtectedRoute>
					}
				>
					<Route index element={<Dashboard />} />
					<Route path="users" element={<Users />} />
					<Route path="doctors" element={<Doctors />} />
					<Route path="rpas" element={<RPAs />} />
					<Route path="credentials" element={<Credentials />} />
				</Route>

				{/* Legacy redirects for backwards compatibility */}
				<Route path="/login" element={<Navigate to="/admin/login" replace />} />
				<Route
					path="/dashboard"
					element={<Navigate to="/admin/dashboard" replace />}
				/>
				<Route
					path="/dashboard/*"
					element={<Navigate to="/admin/dashboard" replace />}
				/>

				{/* Catch all */}
				<Route path="*" element={<Navigate to="/" replace />} />
			</Routes>
		</BrowserRouter>
	);
}

export default App;
