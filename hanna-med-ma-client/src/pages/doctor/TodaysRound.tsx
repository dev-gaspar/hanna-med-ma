import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronRight, Loader2 } from "lucide-react";
import { doctorAuthService } from "../../services/doctorAuthService";
import { useDoctorData } from "../../contexts/DoctorDataContext";
import { HOSPITALS } from "../../lib/hospitals";
import { isAdmittedRecently } from "../../lib/patientFlags";
import type { EmrSystem } from "../../types";
import { Chip } from "../../components/ui/Chip";

interface HospitalStats {
	key: EmrSystem;
	label: string;
	short: string;
	hue: string;
	total: number;
	unseen: number;
}

export default function TodaysRound() {
	// Read doctor once — see TodaysRound (this file's history) for rationale.
	const [doctor] = useState(() => doctorAuthService.getCurrentDoctor());
	const emrSystems = useMemo<EmrSystem[]>(
		() => ((doctor?.emrSystems as EmrSystem[]) || []),
		[doctor],
	);

	const { patientsBySystem, seenIds, loading } = useDoctorData();

	const stats: HospitalStats[] = emrSystems.map((key) => {
		const meta = HOSPITALS[key];
		const list = patientsBySystem[key] || [];
		const unseen = list.filter((p) => !seenIds.has(p.id)).length;
		return {
			key,
			label: meta?.label || key,
			short: meta?.short || key.slice(0, 3),
			hue: meta?.hue || "#5e5e5e",
			total: list.length,
			unseen,
		};
	});

	const totalCensus = stats.reduce((a, s) => a + s.total, 0);
	const totalUnseen = stats.reduce((a, s) => a + s.unseen, 0);

	const today = new Date();
	const formattedDate = today.toLocaleDateString("en-US", {
		weekday: "long",
		month: "short",
		day: "numeric",
	});

	return (
		<div className="flex-1 overflow-y-auto pb-4 custom-scrollbar">
			<div className="max-w-5xl mx-auto px-4 pt-5 pb-3">
				<div className="label-kicker mb-1">{formattedDate}</div>
				<h1 className="font-serif text-[24px] text-n-900 leading-tight">
					Today&rsquo;s round
				</h1>
			</div>

			{/* Hero census card */}
			<div className="max-w-5xl mx-auto px-4">
				<div className="rounded-xl bg-p-700 text-white p-5">
					<div className="font-mono text-[10px] uppercase tracking-widest text-white/70">
						Census today
					</div>
					{loading ? (
						<div className="mt-3 flex items-center gap-2 text-white/70">
							<Loader2 className="w-4 h-4 animate-spin" />
							<span className="font-mono text-[11px] uppercase tracking-widest">
								Loading
							</span>
						</div>
					) : (
						<>
							<div className="font-serif text-[44px] leading-none mt-2 mb-3 tabular-nums">
								{totalCensus}
							</div>
							<div className="text-[12.5px] text-white/85 leading-relaxed">
								{emrSystems.length > 0 ? (
									<>
										Across{" "}
										<span className="tabular-nums">{emrSystems.length}</span>{" "}
										hospital{emrSystems.length === 1 ? "" : "s"}.{" "}
										<span className="tabular-nums">{totalUnseen}</span> still
										unseen.
									</>
								) : (
									<>No hospitals assigned yet — contact your admin.</>
								)}
							</div>
						</>
					)}
				</div>
			</div>

			{/* Hospitals list */}
			{emrSystems.length > 0 && (
				<section className="max-w-5xl mx-auto px-4 mt-6">
					<div className="flex items-end justify-between mb-3">
						<div className="label-kicker">Hospitals</div>
					</div>
					<div className="grid grid-cols-1 md:grid-cols-2 gap-2">
						{stats.map((h) => (
							<Link
								key={h.key}
								to={`/doctor/hospital/${h.key.toLowerCase()}`}
								className="group flex items-center gap-4 px-4 py-3.5 bg-n-0 rounded-lg border border-n-150 hover:border-n-200 hover:bg-n-50 transition"
							>
								<div className="flex-1 min-w-0">
									<div className="flex items-center gap-2">
										<span
											className="w-1.5 h-1.5 rounded-full"
											style={{ background: h.hue }}
										/>
										<div className="font-semibold text-[14px] text-n-900 truncate">
											{h.label}
										</div>
									</div>
									<div className="flex items-center gap-2 mt-1.5 flex-wrap">
										<span className="font-mono text-[11px] uppercase tracking-wider text-n-500">
											{h.short}
										</span>
										<span className="text-n-300">·</span>
										<span className="font-mono text-[11px] text-n-600 tabular-nums">
											{h.total} total
										</span>
										{h.unseen > 0 && (
											<>
												<span className="text-n-300">·</span>
												<Chip tone="warn">
													<span className="tabular-nums">{h.unseen}</span>{" "}
													unseen
												</Chip>
											</>
										)}
									</div>
								</div>
								<div className="text-right shrink-0">
									<div className="font-serif text-[24px] text-n-900 leading-none tabular-nums">
										{h.unseen}
									</div>
									<div className="font-mono text-[9.5px] uppercase tracking-wider text-n-500 mt-1">
										unseen
									</div>
								</div>
								<ChevronRight className="w-4 h-4 text-n-400 group-hover:text-n-700 transition shrink-0" />
							</Link>
						))}
					</div>
				</section>
			)}

			{/* Recent census — flatten + sort by updatedAt */}
			{!loading && totalCensus > 0 && (
				<section className="max-w-5xl mx-auto px-4 mt-6">
					<div className="label-kicker mb-3">Recent</div>
					<div className="space-y-1">
						{Object.values(patientsBySystem)
							.flat()
							.sort(
								(a, b) =>
									new Date(b.updatedAt).getTime() -
									new Date(a.updatedAt).getTime(),
							)
							.slice(0, 5)
							.map((p) => {
								const meta = HOSPITALS[p.emrSystem];
								return (
									<div
										key={p.id}
										className="flex items-center gap-3 py-2 text-[13px]"
									>
										<div className="w-8 h-8 rounded-full bg-n-100 grid place-items-center font-mono text-[10.5px] text-n-700 shrink-0">
											{p.name
												.split(/[\s,]+/)
												.map((x) => x[0])
												.filter(Boolean)
												.slice(0, 2)
												.join("")
												.toUpperCase()}
										</div>
										<div className="flex-1 min-w-0">
											<div className="flex items-center gap-1.5 min-w-0">
												<span className="truncate text-n-900">{p.name}</span>
												{isAdmittedRecently(p.admittedDate) && (
													<Chip tone="warn">new</Chip>
												)}
											</div>
											<div className="font-mono text-[10.5px] text-n-500 truncate">
												{p.location || "—"}
												{p.reason ? ` · ${p.reason}` : ""}
											</div>
										</div>
										<span className="font-mono text-[10px] uppercase tracking-wider text-n-500">
											{meta?.short || p.emrSystem.slice(0, 3)}
										</span>
									</div>
								);
							})}
					</div>
				</section>
			)}
		</div>
	);
}
