import { useState, type FormEvent, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { doctorAuthService } from "../../services/doctorAuthService";
import { ArrowLeft, Eye, EyeOff, Loader2, Lock } from "lucide-react";
import { Button } from "../../components/ui/Button";

export default function DoctorLogin() {
	const [username, setUsername] = useState("");
	const [password, setPassword] = useState("");
	const [showPassword, setShowPassword] = useState(false);
	const [error, setError] = useState("");
	const [loading, setLoading] = useState(false);
	const navigate = useNavigate();

	useEffect(() => {
		if (doctorAuthService.getCurrentDoctor()) {
			navigate("/doctor/round", { replace: true });
		}
	}, [navigate]);

	const handleSubmit = async (e: FormEvent) => {
		e.preventDefault();
		setError("");
		setLoading(true);

		try {
			const response = await doctorAuthService.login({ username, password });
			if (response.access_token) {
				navigate("/doctor/round", { replace: true });
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
		<div className="min-h-screen bg-n-50 flex flex-col">
			<div className="px-6 h-14 flex items-center justify-between border-b border-n-150 bg-n-0">
				<Link
					to="/"
					className="inline-flex items-center gap-2 text-n-600 hover:text-n-900 text-[13px] transition"
				>
					<ArrowLeft className="w-4 h-4" />
					<span>Back</span>
				</Link>
				<div className="flex items-center gap-2">
					<div className="w-6 h-6 rounded bg-p-700 grid place-items-center font-serif text-white text-[12px]">
						H
					</div>
					<span className="font-serif text-[13px] text-n-900">Hanna-Med</span>
				</div>
			</div>

			<div className="flex-1 flex items-center justify-center px-4 py-10">
				<div className="w-full max-w-[400px]">
					<div className="mb-8">
						<h1 className="font-serif text-[32px] leading-[1.1] text-n-900 mb-1.5">
							Sign in.
						</h1>
						<p className="text-[13px] text-n-500">
							Access is restricted to credentialed providers.
						</p>
					</div>

					{error && (
						<div className="mb-4 px-3 py-2.5 bg-[var(--dnr-bg)] rounded-md border border-[var(--dnr-fg)]/20">
							<p className="text-[12.5px] text-[var(--dnr-fg)]">{error}</p>
						</div>
					)}

					<form onSubmit={handleSubmit} className="space-y-4">
						<div>
							<label
								htmlFor="username"
								className="label-kicker block mb-1.5"
							>
								Provider ID
							</label>
							<input
								id="username"
								type="text"
								value={username}
								onChange={(e) => setUsername(e.target.value)}
								className="input-field h-11 text-[14px]"
								placeholder="phanna_md"
								required
								disabled={loading}
								autoComplete="off"
							/>
						</div>

						<div>
							<label
								htmlFor="password"
								className="label-kicker block mb-1.5"
							>
								Password
							</label>
							<div className="relative">
								<input
									id="password"
									type={showPassword ? "text" : "password"}
									value={password}
									onChange={(e) => setPassword(e.target.value)}
									className="input-field h-11 text-[14px] pr-10"
									placeholder="••••••••••"
									required
									disabled={loading}
									autoComplete="off"
								/>
								<button
									type="button"
									onClick={() => setShowPassword((s) => !s)}
									className="absolute right-2.5 top-1/2 -translate-y-1/2 w-7 h-7 inline-flex items-center justify-center text-n-400 hover:text-n-700 rounded"
									tabIndex={-1}
									aria-label={showPassword ? "Hide password" : "Show password"}
								>
									{showPassword ? (
										<EyeOff className="w-4 h-4" />
									) : (
										<Eye className="w-4 h-4" />
									)}
								</button>
							</div>
						</div>

						<Button
							type="submit"
							tone="primary"
							size="lg"
							disabled={loading}
							className="w-full mt-2"
						>
							{loading ? (
								<>
									<Loader2 className="w-4 h-4 animate-spin" />
									<span>Signing in…</span>
								</>
							) : (
								"Continue"
							)}
						</Button>
					</form>

					<div className="mt-10 flex items-center gap-2 text-[10.5px] font-mono uppercase tracking-widest text-n-500">
						<Lock className="w-3 h-3" />
						<span>encrypted · audited · HIPAA</span>
					</div>
				</div>
			</div>
		</div>
	);
}
