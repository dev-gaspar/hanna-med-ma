import { useEffect, useState } from "react";
import { rpaService } from "../services/rpaService";
import { doctorService } from "../services/doctorService";
import type { RpaNode, Doctor } from "../types";
import { formatDistanceToNow, isAfter, subMinutes } from "date-fns";
import { Loader2, Link as LinkIcon, RefreshCw } from "lucide-react";
import Modal from "../components/Modal";
import { Button } from "../components/ui/Button";
import { Chip } from "../components/ui/Chip";
import { cls } from "../lib/cls";

export default function RPAs() {
	const [nodes, setNodes] = useState<RpaNode[]>([]);
	const [doctors, setDoctors] = useState<Doctor[]>([]);
	const [loading, setLoading] = useState(true);
	const [refreshing, setRefreshing] = useState(false);

	const [isAssignModalOpen, setIsAssignModalOpen] = useState(false);
	const [selectedNode, setSelectedNode] = useState<RpaNode | null>(null);
	const [selectedDoctorId, setSelectedDoctorId] = useState<string>("");
	const [assigning, setAssigning] = useState(false);

	useEffect(() => {
		fetchData(true);
	}, []);

	const fetchData = async (initial = false) => {
		try {
			if (!initial) setRefreshing(true);
			const [rpasData, doctorsData] = await Promise.all([
				rpaService.getAll(),
				doctorService.getAll(),
			]);
			setNodes(rpasData);
			setDoctors(doctorsData);
		} catch (error) {
			console.error("Error fetching RPAs data:", error);
		} finally {
			setLoading(false);
			setRefreshing(false);
		}
	};

	const handleOpenAssignModal = (node: RpaNode) => {
		setSelectedNode(node);
		setSelectedDoctorId(node.doctorId ? node.doctorId.toString() : "");
		setIsAssignModalOpen(true);
	};

	const handleCloseAssignModal = () => {
		setIsAssignModalOpen(false);
		setSelectedNode(null);
		setSelectedDoctorId("");
	};

	const handleAssign = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!selectedNode || !selectedDoctorId) return;

		try {
			setAssigning(true);
			await rpaService.assignToDoctor(
				selectedNode.uuid,
				parseInt(selectedDoctorId),
			);
			await fetchData();
			handleCloseAssignModal();
		} catch (error) {
			console.error("Error assigning doctor:", error);
		} finally {
			setAssigning(false);
		}
	};

	return (
		<div className="max-w-6xl">
			<div className="flex items-end justify-between gap-4 pb-4 mb-5 border-b border-n-150">
				<div>
					<div className="label-kicker mb-1.5">Operations</div>
					<div className="flex items-center gap-3">
						<h1 className="font-serif text-[24px] text-n-900 leading-tight">
							RPA Nodes
						</h1>
						<Chip>{nodes.length}</Chip>
					</div>
					<p className="text-[12.5px] text-n-500 mt-1.5 max-w-2xl leading-relaxed">
						Each node is a Windows worker running HannamedRPA. Heartbeats every
						30s. Nodes pull credentials on start and poll for billing-note
						tasks between extraction cycles.
					</p>
				</div>
				<Button
					tone="ghost"
					size="sm"
					onClick={() => fetchData()}
					disabled={refreshing}
					leading={
						refreshing ? (
							<Loader2 className="w-3.5 h-3.5 animate-spin" />
						) : (
							<RefreshCw className="w-3.5 h-3.5" />
						)
					}
				>
					Refresh
				</Button>
			</div>

			<div className="border border-n-150 rounded-lg bg-n-0 overflow-hidden">
				<div className="grid grid-cols-[1.8fr_1fr_1fr_1fr_100px] px-4 h-10 border-b border-n-150 bg-n-50 items-center">
					<div className="label-kicker">Node</div>
					<div className="label-kicker">Status</div>
					<div className="label-kicker">Last seen</div>
					<div className="label-kicker">Doctor</div>
					<div className="label-kicker text-right">Actions</div>
				</div>

				{loading ? (
					<div className="flex items-center justify-center gap-2 py-10 text-n-500">
						<Loader2 className="w-4 h-4 animate-spin" />
						<span className="font-mono text-[11px] uppercase tracking-widest">
							Loading
						</span>
					</div>
				) : nodes.length === 0 ? (
					<div className="py-10 px-4 text-center font-mono text-[11.5px] text-n-500">
						No RPA nodes registered yet. A node must run at least once to appear
						here.
					</div>
				) : (
					nodes.map((node) => {
						const isOnline =
							node.lastSeen &&
							isAfter(new Date(node.lastSeen), subMinutes(new Date(), 5));
						return (
							<div
								key={node.uuid}
								className="grid grid-cols-[1.8fr_1fr_1fr_1fr_100px] px-4 py-3 border-b border-n-150 last:border-0 items-center hover:bg-n-50 transition"
							>
								<div className="min-w-0">
									<div className="flex items-center gap-2">
										<span
											className={cls(
												"w-1.5 h-1.5 rounded-full shrink-0",
												isOnline
													? "bg-[var(--ok-fg)]"
													: "bg-n-300",
											)}
										/>
										<div className="text-[13.5px] font-medium text-n-900 truncate">
											{node.hostname || "Unknown host"}
										</div>
									</div>
									<div className="font-mono text-[10.5px] text-n-500 truncate mt-0.5">
										{node.uuid}
									</div>
								</div>
								<div>
									{isOnline ? (
										<Chip tone="ok">online</Chip>
									) : (
										<Chip>offline</Chip>
									)}
								</div>
								<div className="font-mono text-[11.5px] text-n-600">
									{node.lastSeen ? (
										<span
											title={new Date(node.lastSeen).toLocaleString("en-US")}
										>
											{formatDistanceToNow(new Date(node.lastSeen), {
												addSuffix: true,
											})}
										</span>
									) : (
										<span className="text-n-400">never</span>
									)}
								</div>
								<div>
									{node.doctor ? (
										<span className="text-[13px] text-n-800 truncate">
											{node.doctor.name}
										</span>
									) : (
										<Chip tone="warn">pending</Chip>
									)}
								</div>
								<div className="flex justify-end">
									<button
										onClick={() => handleOpenAssignModal(node)}
										className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-n-200 text-n-700 text-[11.5px] hover:bg-n-100 transition"
										title="Assign to Doctor"
									>
										<LinkIcon className="w-3.5 h-3.5" />
										<span>Assign</span>
									</button>
								</div>
							</div>
						);
					})
				)}
			</div>

			<Modal
				isOpen={isAssignModalOpen}
				onClose={handleCloseAssignModal}
				title="Assign node to doctor"
			>
				<form onSubmit={handleAssign} className="space-y-4">
					{selectedNode && (
						<div className="p-3 border border-n-150 rounded-md bg-n-50">
							<div className="label-kicker mb-1">Node</div>
							<div className="font-mono text-[12px] text-n-900">
								{selectedNode.uuid}
							</div>
							<div className="font-mono text-[11px] text-n-500 mt-0.5">
								{selectedNode.hostname}
							</div>
						</div>
					)}
					<div>
						<label className="label-kicker block mb-1.5">
							Select doctor *
						</label>
						<select
							className="input-field"
							value={selectedDoctorId}
							onChange={(e) => setSelectedDoctorId(e.target.value)}
							required
						>
							<option value="" disabled>
								— Choose a doctor —
							</option>
							{doctors.map((d) => (
								<option key={d.id} value={d.id}>
									{d.name} ({d.username})
								</option>
							))}
						</select>
					</div>

					<div className="flex gap-2 pt-2">
						<Button
							type="button"
							tone="ghost"
							size="md"
							onClick={handleCloseAssignModal}
							disabled={assigning}
							className="flex-1"
						>
							Cancel
						</Button>
						<Button
							type="submit"
							tone="primary"
							size="md"
							disabled={assigning}
							className="flex-1"
						>
							{assigning ? (
								<>
									<Loader2 className="w-4 h-4 animate-spin" />
									<span>Assigning…</span>
								</>
							) : (
								"Assign"
							)}
						</Button>
					</div>
				</form>
			</Modal>
		</div>
	);
}
