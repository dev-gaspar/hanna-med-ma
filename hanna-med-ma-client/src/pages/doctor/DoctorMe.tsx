import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { LogOut, Lock } from "lucide-react";
import { doctorAuthService } from "../../services/doctorAuthService";
import { HOSPITALS } from "../../lib/hospitals";
import type { EmrSystem } from "../../types";
import { Button } from "../../components/ui/Button";

export default function DoctorMe() {
	const navigate = useNavigate();
	// Read doctor once. See TodaysRound for context on why this matters.
	const [doctor] = useState(() => doctorAuthService.getCurrentDoctor());
	const emrSystems = ((doctor?.emrSystems as EmrSystem[]) || []).filter(
		(s) => HOSPITALS[s],
	);

	const handleLogout = () => {
		doctorAuthService.logout();
		navigate("/");
	};

	return (
		<div className="flex-1 overflow-y-auto pb-6 custom-scrollbar">
			<div className="max-w-5xl mx-auto px-4 pt-5 pb-3">
				<div className="label-kicker mb-1">Profile</div>
				<h1 className="font-serif text-[24px] text-n-900 leading-tight">
					{doctor?.name || "Doctor"}
				</h1>
				{doctor?.specialty && (
					<p className="text-[13px] text-n-500 mt-1">{doctor.specialty}</p>
				)}
			</div>

			<section className="max-w-5xl mx-auto px-4 mt-4">
				<div className="label-kicker mb-2">Account</div>
				<div className="bg-n-0 rounded-lg border border-n-150 divide-y divide-n-150">
					<Row label="Username" value={doctor?.username || "—"} />
					<Row label="Provider ID" value={doctor?.id?.toString() || "—"} />
				</div>
			</section>

			{emrSystems.length > 0 && (
				<section className="max-w-5xl mx-auto px-4 mt-5">
					<div className="label-kicker mb-2">Hospitals</div>
					<div className="bg-n-0 rounded-lg border border-n-150">
						{emrSystems.map((s, i) => {
							const meta = HOSPITALS[s];
							return (
								<div
									key={s}
									className={`flex items-center gap-3 px-4 py-3 ${i > 0 ? "border-t border-n-150" : ""}`}
								>
									<span
										className="w-1.5 h-1.5 rounded-full shrink-0"
										style={{ background: meta.hue }}
									/>
									<div className="flex-1 min-w-0">
										<div className="text-[13px] text-n-900 truncate">
											{meta.label}
										</div>
									</div>
									<span className="font-mono text-[10.5px] uppercase tracking-wider text-n-500">
										{meta.short}
									</span>
								</div>
							);
						})}
					</div>
				</section>
			)}

			<section className="max-w-5xl mx-auto px-4 mt-5">
				<div className="label-kicker mb-2">Security</div>
				<div className="bg-n-0 rounded-lg border border-n-150 px-4 py-3 flex items-center gap-3">
					<Lock className="w-4 h-4 text-n-500 shrink-0" />
					<div className="flex-1 min-w-0">
						<div className="text-[13px] text-n-900">HIPAA compliant session</div>
						<div className="font-mono text-[10.5px] text-n-500 mt-0.5">
							encrypted · audited
						</div>
					</div>
				</div>
			</section>

			<section className="max-w-5xl mx-auto px-4 mt-6">
				<Button
					tone="ghost"
					size="lg"
					onClick={handleLogout}
					leading={<LogOut className="w-4 h-4" />}
					className="w-full justify-center"
				>
					Sign out
				</Button>
			</section>
		</div>
	);
}

function Row({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex items-center gap-3 px-4 py-3">
			<div className="label-kicker w-[96px] shrink-0">{label}</div>
			<div className="font-mono text-[12.5px] text-n-800 truncate">
				{value}
			</div>
		</div>
	);
}
