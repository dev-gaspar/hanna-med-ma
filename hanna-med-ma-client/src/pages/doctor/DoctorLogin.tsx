import { useState, type FormEvent, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { doctorAuthService } from "../../services/doctorAuthService";
import { Stethoscope, Shield, ArrowLeft } from "lucide-react";

export default function DoctorLogin() {
	const [username, setUsername] = useState("");
	const [password, setPassword] = useState("");
	const [error, setError] = useState("");
	const [loading, setLoading] = useState(false);
	const navigate = useNavigate();

	useEffect(() => {
		if (doctorAuthService.getCurrentDoctor()) {
			navigate("/doctor/chat", { replace: true });
		}
	}, [navigate]);

	const handleSubmit = async (e: FormEvent) => {
		e.preventDefault();
		setError("");
		setLoading(true);

		try {
			const response = await doctorAuthService.login({ username, password });
			if (response.access_token) {
				navigate("/doctor/chat", { replace: true });
			} else {
				setError("Login failed. Please try again.");
				setLoading(false);
			}
		} catch (err: unknown) {
			const error = err as { response?: { data?: { message?: string } } };
			setError(error.response?.data?.message || "Invalid credentials");
			setLoading(false);
		}
	};

	return (
		<div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 flex items-center justify-center p-4">
			{/* Background Pattern */}
			<div className="absolute inset-0 opacity-10">
				<div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(255,255,255,0.1),transparent_50%)]" />
			</div>

			<div className="w-full max-w-md relative z-10">
				{/* Back to Home - Absolute to save vertical space */}
				<Link
					to="/"
					className="absolute -top-12 left-0 inline-flex items-center gap-2 text-blue-200 hover:text-white transition-colors text-sm"
				>
					<ArrowLeft className="w-4 h-4" />
					<span>Back</span>
				</Link>

				<div className="bg-white/10 backdrop-blur-xl rounded-2xl shadow-2xl p-6 border border-white/20">
					{/* Logo/Header */}
					{/* Logo/Header */}
					<div className="text-center mb-5">
						<div className="flex justify-center mb-3">
							<div className="bg-blue-500/20 p-2.5 rounded-full backdrop-blur-sm">
								<Stethoscope className="w-10 h-10 text-blue-400" />
							</div>
						</div>

						<h1 className="text-xl font-bold text-white mb-1">Doctor Portal</h1>
						<p className="text-blue-200/80 text-xs">
							Hanna-Med Medical Assistant
						</p>
					</div>

					{/* HIPAA Notice */}
					<div className="bg-blue-500/10 border border-blue-400/20 rounded-lg p-2.5 mb-5 backdrop-blur-sm">
						<div className="flex items-start gap-2.5 text-blue-200">
							<Shield className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
							<p className="text-[11px] leading-relaxed opacity-90">
								HIPAA-compliant secure connection. Session expires after 1 hour.
							</p>
						</div>
					</div>

					{/* Error Message */}
					{error && (
						<div className="mb-4 p-3 bg-red-500/20 border border-red-400/30 rounded-lg">
							<p className="text-sm text-red-200">{error}</p>
						</div>
					)}

					{/* Form */}
					<form onSubmit={handleSubmit} className="space-y-4">
						<div>
							<label
								htmlFor="username"
								className="block text-xs font-medium text-blue-100 mb-1.5"
							>
								Username
							</label>
							<input
								id="username"
								type="text"
								value={username}
								onChange={(e) => setUsername(e.target.value)}
								className="w-full px-3 py-2.5 bg-white/10 border border-white/20 rounded-lg text-white text-sm placeholder-blue-200/50 focus:outline-none focus:ring-2 focus:ring-blue-400/50 focus:border-blue-400 transition-all"
								placeholder="Enter your username"
								required
								disabled={loading}
								autoComplete="off"
							/>
						</div>

						<div>
							<label
								htmlFor="password"
								className="block text-xs font-medium text-blue-100 mb-1.5"
							>
								Password
							</label>
							<input
								id="password"
								type="password"
								value={password}
								onChange={(e) => setPassword(e.target.value)}
								className="w-full px-3 py-2.5 bg-white/10 border border-white/20 rounded-lg text-white text-sm placeholder-blue-200/50 focus:outline-none focus:ring-2 focus:ring-blue-400/50 focus:border-blue-400 transition-all"
								placeholder="Enter your password"
								required
								disabled={loading}
								autoComplete="off"
							/>
						</div>

						<button
							type="submit"
							disabled={loading}
							className="w-full py-2 bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white text-sm font-semibold rounded-lg transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg hover:shadow-blue-500/25 mt-2"
						>
							{loading ? (
								<span className="flex items-center justify-center gap-2">
									<svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
										<circle
											className="opacity-25"
											cx="12"
											cy="12"
											r="10"
											stroke="currentColor"
											strokeWidth="4"
											fill="none"
										/>
										<path
											className="opacity-75"
											fill="currentColor"
											d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
										/>
									</svg>
									Signing in...
								</span>
							) : (
								"Sign In"
							)}
						</button>
					</form>

					{/* Footer */}
					<div className="mt-5 text-center">
						<p className="text-[10px] text-blue-200/40">
							© Hanna-Med Medical Assistant
						</p>
					</div>
				</div>
			</div>
		</div>
	);
}
