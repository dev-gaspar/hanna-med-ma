import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, Search, Sparkles } from "lucide-react";
import { codingService } from "../../services/codingService";
import type {
	CodingStatus,
	InboxEntry,
	InboxResponse,
} from "../../types/coding";
import { HOSPITALS } from "../../lib/hospitals";
import { cls } from "../../lib/cls";
import { Chip } from "../../components/ui/Chip";
import { CodeChip } from "../../components/ui/CodeChip";

type StatusFilter = CodingStatus | "NEVER_RUN" | "ALL";
type RiskFilter = "ALL" | "LOW" | "REVIEW" | "RISK";

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
	{ value: "ALL", label: "All statuses" },
	{ value: "NEVER_RUN", label: "Never run" },
	{ value: "IN_PROGRESS", label: "Running" },
	{ value: "DRAFT", label: "Draft" },
	{ value: "APPROVED", label: "Approved" },
	{ value: "TRANSFERRED_TO_CARETRACKER", label: "Transferred" },
	{ value: "FAILED", label: "Failed" },
];

const RISK_FILTERS: { value: RiskFilter; label: string }[] = [
	{ value: "ALL", label: "All risk" },
	{ value: "LOW", label: "Low" },
	{ value: "REVIEW", label: "Review" },
	{ value: "RISK", label: "Risk" },
];

const STATUS_LABEL: Record<CodingStatus, string> = {
	IN_PROGRESS: "running",
	DRAFT: "draft",
	UNDER_REVIEW: "reviewing",
	APPROVED: "approved",
	TRANSFERRED_TO_CARETRACKER: "transferred",
	DENIED: "denied",
	FAILED: "failed",
};

const STATUS_TONE: Record<CodingStatus, "info" | "ok" | "warn" | "dnr" | "primary" | "neutral"> = {
	IN_PROGRESS: "info",
	DRAFT: "info",
	UNDER_REVIEW: "warn",
	APPROVED: "ok",
	TRANSFERRED_TO_CARETRACKER: "primary",
	DENIED: "dnr",
	FAILED: "dnr",
};

function RiskCell({ entry }: { entry: InboxEntry }) {
	if (!entry.coding) {
		return <span className="font-mono text-[10.5px] text-n-400">—</span>;
	}
	if (entry.coding.status === "IN_PROGRESS") {
		return (
			<span className="inline-flex items-center gap-1.5 text-[11px] text-n-500">
				<Loader2 className="w-3 h-3 animate-spin" />
				<span className="font-mono uppercase tracking-wider text-[10px]">
					running
				</span>
			</span>
		);
	}
	if (entry.coding.status === "FAILED") {
		return <span className="font-mono text-[10.5px] text-[var(--dnr-fg)]">fail</span>;
	}
	const score = entry.coding.auditRiskScore;
	const band = entry.coding.riskBand;
	if (score === null || band === null) {
		return <span className="font-mono text-[10.5px] text-n-400">—</span>;
	}
	const tone = band === "LOW" ? "ok" : band === "REVIEW" ? "warn" : "dnr";
	return (
		<div className="inline-flex items-center gap-2 font-mono text-[11px] text-n-800">
			<span className="tabular-nums font-medium">{score}</span>
			<Chip tone={tone}>{band.toLowerCase()}</Chip>
		</div>
	);
}

function dayLabel(iso: string): string {
	const d = new Date(iso);
	return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function DoctorInbox() {
	const [data, setData] = useState<InboxResponse | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
	const [riskFilter, setRiskFilter] = useState<RiskFilter>("ALL");
	const [hospitalFilter, setHospitalFilter] = useState<string>("ALL");
	const [searchInput, setSearchInput] = useState("");

	// Debounce the search text so we don't fire a request on every
	// keystroke — 300ms is short enough to feel instant but saves
	// ~10 requests on a typical typed query.
	const [debouncedSearch, setDebouncedSearch] = useState("");
	useEffect(() => {
		const t = setTimeout(() => setDebouncedSearch(searchInput.trim()), 300);
		return () => clearTimeout(t);
	}, [searchInput]);

	useEffect(() => {
		let cancelled = false;
		const load = async () => {
			setLoading(true);
			try {
				const res = await codingService.getInbox({
					status: statusFilter === "ALL" ? undefined : statusFilter,
					riskBand: riskFilter === "ALL" ? undefined : riskFilter,
					emrSystem: hospitalFilter === "ALL" ? undefined : hospitalFilter,
					search: debouncedSearch || undefined,
				});
				if (!cancelled) {
					setData(res);
					setError(null);
				}
			} catch (e) {
				if (!cancelled) {
					setError((e as Error).message || "Failed to load inbox");
				}
			} finally {
				if (!cancelled) setLoading(false);
			}
		};
		void load();
		return () => {
			cancelled = true;
		};
	}, [statusFilter, riskFilter, hospitalFilter, debouncedSearch]);

	const counts = data?.counts;
	const entries = data?.entries ?? [];

	const hospitals = useMemo(
		() => [
			{ value: "ALL", label: "All hospitals" },
			...Object.values(HOSPITALS).map((h) => ({
				value: h.key,
				label: h.label,
			})),
		],
		[],
	);

	return (
		<div className="flex-1 overflow-y-auto pb-6 custom-scrollbar">
			<div className="max-w-5xl mx-auto px-4 pt-5 pb-3">
				<div className="label-kicker mb-1">AI Coder</div>
				<h1 className="font-serif text-[24px] text-n-900 leading-tight">
					Coder inbox
				</h1>
				<p className="text-[12.5px] text-n-600 mt-1 leading-relaxed">
					Every signed encounter you own, ranked by audit risk. Untouched
					encounters float to the top — click any row to review the draft.
				</p>
			</div>

			{/* Filter row */}
			<section className="max-w-5xl mx-auto px-4 mt-4">
				<div className="label-kicker mb-2">Refine</div>
				<div className="flex flex-wrap items-center gap-2">
					<div className="relative flex-1 min-w-[200px] max-w-[320px]">
						<Search className="w-3.5 h-3.5 text-n-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
						<input
							type="text"
							placeholder="Search patient…"
							value={searchInput}
							onChange={(e) => setSearchInput(e.target.value)}
							className="w-full h-8 pl-8 pr-2.5 text-[12.5px] border border-n-200 rounded-md bg-n-0 text-n-900 focus:outline-none focus:border-n-400"
						/>
					</div>
					<select
						value={statusFilter}
						onChange={(e) =>
							setStatusFilter(e.target.value as StatusFilter)
						}
						className="h-8 px-2.5 text-[12px] border border-n-200 rounded-md bg-n-0 text-n-800 focus:outline-none focus:border-n-400"
					>
						{STATUS_FILTERS.map((f) => {
							const count =
								f.value === "ALL"
									? counts?.total
									: (counts?.[f.value as keyof typeof counts] as
											| number
											| undefined);
							const suffix = typeof count === "number" ? ` (${count})` : "";
							return (
								<option key={f.value} value={f.value}>
									{f.label}
									{suffix}
								</option>
							);
						})}
					</select>
					<select
						value={hospitalFilter}
						onChange={(e) => setHospitalFilter(e.target.value)}
						className="h-8 px-2.5 text-[12px] border border-n-200 rounded-md bg-n-0 text-n-800 focus:outline-none focus:border-n-400"
					>
						{hospitals.map((h) => (
							<option key={h.value} value={h.value}>
								{h.label}
							</option>
						))}
					</select>
					<select
						value={riskFilter}
						onChange={(e) => setRiskFilter(e.target.value as RiskFilter)}
						className="h-8 px-2.5 text-[12px] border border-n-200 rounded-md bg-n-0 text-n-800 focus:outline-none focus:border-n-400"
					>
						{RISK_FILTERS.map((r) => (
							<option key={r.value} value={r.value}>
								{r.label}
							</option>
						))}
					</select>
					{counts && counts.riskHigh > 0 && (
						<div className="ml-auto font-mono text-[10.5px] uppercase tracking-widest text-[var(--dnr-fg)] inline-flex items-center gap-1.5">
							<span className="w-1.5 h-1.5 rounded-full bg-[var(--dnr-fg)]" />
							{counts.riskHigh} high-risk
						</div>
					)}
				</div>
			</section>

			{/* Queue */}
			<section className="max-w-5xl mx-auto px-4 mt-5">
				<div className="label-kicker mb-2">Queue</div>
				{error ? (
					<div className="bg-n-0 border border-[var(--dnr-fg)]/30 rounded-md p-4 text-[12.5px] text-n-700">
						{error}
					</div>
				) : loading && !data ? (
					<div className="bg-n-0 border border-n-150 rounded-md p-6 flex items-center justify-center gap-2 text-n-500 text-[12.5px]">
						<Loader2 className="w-4 h-4 animate-spin" /> Loading inbox…
					</div>
				) : entries.length === 0 ? (
					<div className="bg-n-0 border border-dashed border-n-200 rounded-md p-8 text-center">
						<Sparkles className="w-5 h-5 text-n-400 mx-auto mb-2" />
						<div className="text-[13px] text-n-800 font-medium mb-0.5">
							No encounters match these filters
						</div>
						<p className="text-[12px] text-n-600">
							Try clearing the search or choosing a different status.
						</p>
					</div>
				) : (
					<InboxTable entries={entries} />
				)}
			</section>
		</div>
	);
}

function InboxTable({ entries }: { entries: InboxEntry[] }) {
	return (
		<>
			{/* Desktop table */}
			<div className="hidden md:block bg-n-0 border border-n-150 rounded-md overflow-hidden">
				<table className="w-full text-[12.5px]">
					<thead className="bg-n-50">
						<tr className="text-left">
							<th className="px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-n-500 font-normal">
								Patient
							</th>
							<th className="px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-n-500 font-normal">
								Hospital
							</th>
							<th className="px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-n-500 font-normal">
								DoS
							</th>
							<th className="px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-n-500 font-normal">
								Primary CPT
							</th>
							<th className="px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-n-500 font-normal">
								Risk
							</th>
							<th className="px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-n-500 font-normal">
								Status
							</th>
							<th className="px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-n-500 font-normal text-right">
								{" "}
							</th>
						</tr>
					</thead>
					<tbody>
						{entries.map((e) => (
							<tr
								key={e.encounterId}
								className="border-t border-n-150 hover:bg-n-50/60 transition"
							>
								<td className="px-3 py-2.5">
									<Link
										to={`/doctor/patient/${e.patient.id}`}
										className="text-n-900 hover:text-p-700 font-medium"
									>
										{e.patient.name}
									</Link>
									<div className="font-mono text-[10px] uppercase tracking-wider text-n-500 mt-0.5">
										encounter · {e.encounterId} · {e.type.toLowerCase()}
									</div>
								</td>
								<td className="px-3 py-2.5">
									<div className="text-n-800">
										{HOSPITALS[e.patient.emrSystem]?.label ??
											e.patient.emrSystem}
									</div>
									{e.patient.facility && (
										<div className="font-mono text-[10px] text-n-500 mt-0.5">
											{e.patient.facility}
										</div>
									)}
								</td>
								<td className="px-3 py-2.5 font-mono text-[11.5px] text-n-700 whitespace-nowrap">
									{dayLabel(e.dateOfService)}
								</td>
								<td className="px-3 py-2.5">
									{e.coding?.primaryCpt ? (
										<CodeChip code={e.coding.primaryCpt} tone="primary" />
									) : (
										<span className="font-mono text-[10.5px] text-n-400">
											—
										</span>
									)}
								</td>
								<td className="px-3 py-2.5">
									<RiskCell entry={e} />
								</td>
								<td className="px-3 py-2.5">
									{e.coding ? (
										<Chip tone={STATUS_TONE[e.coding.status]}>
											{STATUS_LABEL[e.coding.status]}
										</Chip>
									) : (
										<Chip tone="neutral">never run</Chip>
									)}
								</td>
								<td className="px-3 py-2.5 text-right">
									<Link
										to={`/doctor/patient/${e.patient.id}`}
										className="inline-flex items-center h-7 px-2.5 text-[11.5px] text-n-700 hover:text-n-900 border border-n-200 rounded-md hover:border-n-400 transition"
									>
										Open
									</Link>
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>

			{/* Mobile card list */}
			<div className="md:hidden space-y-2">
				{entries.map((e) => (
					<Link
						key={e.encounterId}
						to={`/doctor/patient/${e.patient.id}`}
						className="block bg-n-0 border border-n-150 rounded-md p-3 active:bg-n-50"
					>
						<div className="flex items-start justify-between gap-2 mb-1.5">
							<div className="min-w-0 flex-1">
								<div className="text-n-900 font-medium truncate">
									{e.patient.name}
								</div>
								<div className="font-mono text-[10px] uppercase tracking-wider text-n-500 mt-0.5 truncate">
									{HOSPITALS[e.patient.emrSystem]?.label ?? e.patient.emrSystem}
									{" · "}
									{dayLabel(e.dateOfService)}
								</div>
							</div>
							{e.coding ? (
								<Chip tone={STATUS_TONE[e.coding.status]}>
									{STATUS_LABEL[e.coding.status]}
								</Chip>
							) : (
								<Chip tone="neutral">never run</Chip>
							)}
						</div>
						<div className="flex items-center justify-between gap-2 text-[11.5px]">
							<div>
								{e.coding?.primaryCpt ? (
									<CodeChip code={e.coding.primaryCpt} tone="primary" />
								) : (
									<span className="font-mono text-[10.5px] text-n-400">
										no coding yet
									</span>
								)}
							</div>
							<RiskCell entry={e} />
						</div>
					</Link>
				))}
			</div>
		</>
	);
}
