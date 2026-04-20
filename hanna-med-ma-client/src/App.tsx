import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "sonner";
import { useTheme } from "./contexts/ThemeContext";

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
import TodaysRound from "./pages/doctor/TodaysRound";
import PatientListPage from "./pages/doctor/PatientListPage";
import PatientDetail from "./pages/doctor/PatientDetail";
import DoctorMe from "./pages/doctor/DoctorMe";

// Doctor Components
import DoctorProtectedRoute from "./components/doctor/DoctorProtectedRoute";
import DoctorLayout from "./components/doctor/DoctorLayout";

function App() {
	const { theme } = useTheme();

	return (
		<BrowserRouter>
			<Toaster
				position="top-center"
				theme={theme}
				richColors
				closeButton
				duration={3000}
			/>
			<Routes>
				{/* Public Routes */}
				<Route path="/" element={<LandingPage />} />

				{/* Doctor Portal */}
				<Route path="/doctor/login" element={<DoctorLogin />} />
				<Route
					path="/doctor"
					element={
						<DoctorProtectedRoute>
							<DoctorLayout />
						</DoctorProtectedRoute>
					}
				>
					<Route index element={<Navigate to="round" replace />} />
					<Route path="round" element={<TodaysRound />} />
					<Route path="hospital/:system" element={<PatientListPage />} />
					<Route path="patient/:id" element={<PatientDetail />} />
					<Route path="chat" element={<DoctorChat />} />
					<Route path="me" element={<DoctorMe />} />
				</Route>

				{/* Admin Portal */}
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

				{/* Legacy redirects */}
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
