import { useEffect, useState } from "react";
import { rpaService } from "../services/rpaService";
import { doctorService } from "../services/doctorService";
import type { RpaNode, Doctor } from "../types";
import { formatDistanceToNow, isAfter, subMinutes } from "date-fns";
import { es } from "date-fns/locale";
import { Monitor, Link as LinkIcon, Clock } from "lucide-react";
import Modal from "../components/Modal";

export default function RPAs() {
	const [nodes, setNodes] = useState<RpaNode[]>([]);
	const [doctors, setDoctors] = useState<Doctor[]>([]);
	const [loading, setLoading] = useState(true);

	const [isAssignModalOpen, setIsAssignModalOpen] = useState(false);
	const [selectedNode, setSelectedNode] = useState<RpaNode | null>(null);
	const [selectedDoctorId, setSelectedDoctorId] = useState<string>("");
	const [assigning, setAssigning] = useState(false);

	useEffect(() => {
		fetchData();
	}, []);

	const fetchData = async () => {
		try {
			setLoading(true);
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
			alert("Error assigning doctor to node.");
		} finally {
			setAssigning(false);
		}
	};

	if (loading) {
		return (
			<div className="flex items-center justify-center h-64">
				<div className="text-gray-600">Loading...</div>
			</div>
		);
	}

	return (
		<div>
			<div className="flex justify-between items-center mb-4">
				<div>
					<h1 className="text-xl font-bold text-gray-900 dark:text-white">
						RPA Nodes
					</h1>
					<p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
						Manage headless data collector nodes and their doctor assignments
					</p>
				</div>
				<button onClick={fetchData} className="btn-secondary">
					Refresh List
				</button>
			</div>

			<div className="card">
				<div className="overflow-x-auto">
					<table className="w-full">
						<thead>
							<tr className="border-b border-gray-200 dark:border-slate-700">
								<th className="text-left py-2 px-3 text-xs font-semibold text-gray-700 dark:text-gray-300">
									UUID / Hostname
								</th>
								<th className="text-left py-2 px-3 text-xs font-semibold text-gray-700 dark:text-gray-300">
									Status
								</th>
								<th className="text-left py-2 px-3 text-xs font-semibold text-gray-700 dark:text-gray-300">
									Last Seen
								</th>
								<th className="text-left py-2 px-3 text-xs font-semibold text-gray-700 dark:text-gray-300">
									Assigned Doctor
								</th>
								<th className="text-right py-2 px-3 text-xs font-semibold text-gray-700 dark:text-gray-300">
									Actions
								</th>
							</tr>
						</thead>
						<tbody>
							{nodes.map((node) => {
								const isOnline =
									node.lastSeen &&
									isAfter(new Date(node.lastSeen), subMinutes(new Date(), 5));

								return (
									<tr
										key={node.uuid}
										className="border-b border-gray-100 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-700/50"
									>
										<td className="py-2 px-3">
											<div className="flex items-center gap-2">
												<div className="p-1.5 bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-md">
													<Monitor className="w-4 h-4" />
												</div>
												<div>
													<p className="text-sm font-medium dark:text-white">
														{node.hostname || "Unknown Host"}
													</p>
													<p className="text-xs text-gray-500 font-mono mt-0.5">
														{node.uuid}
													</p>
												</div>
											</div>
										</td>
										<td className="py-2 px-3">
											{isOnline ? (
												<div className="flex items-center gap-1.5">
													<span className="relative flex h-2.5 w-2.5">
														<span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
														<span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500"></span>
													</span>
													<span className="text-green-700 dark:text-green-400 font-medium text-xs">
														Online
													</span>
												</div>
											) : (
												<span className="flex items-center gap-1.5 text-gray-400 dark:text-gray-500 text-xs">
													<span className="inline-flex rounded-full h-2.5 w-2.5 bg-gray-300 dark:bg-gray-600"></span>
													Offline
												</span>
											)}
										</td>
										<td className="py-2 px-3 text-xs text-gray-600 dark:text-gray-400">
											{node.lastSeen ? (
												<span
													className="flex items-center gap-1"
													title={new Date(node.lastSeen).toLocaleString(
														"es-ES",
													)}
												>
													<Clock className="w-3 h-3" />
													{formatDistanceToNow(new Date(node.lastSeen), {
														addSuffix: true,
														locale: es,
													})}
												</span>
											) : (
												<span className="text-gray-400">Never</span>
											)}
										</td>
										<td className="py-2 px-3">
											{node.doctor ? (
												<span className="px-2 py-0.5 bg-primary/10 dark:bg-primary/20 text-primary dark:text-primary-200 rounded-full text-xs font-medium">
													{node.doctor.name}
												</span>
											) : (
												<span className="px-2 py-0.5 bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-400 rounded-full text-xs font-medium">
													Pending Assignment
												</span>
											)}
										</td>
										<td className="py-2 px-3">
											<div className="flex justify-end gap-1">
												<button
													onClick={() => handleOpenAssignModal(node)}
													className="flex items-center gap-1.5 px-2 py-1.5 text-xs font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-lg transition-colors"
													title="Assign to Doctor"
												>
													<LinkIcon className="w-3.5 h-3.5" />
													Assign
												</button>
											</div>
										</td>
									</tr>
								);
							})}
						</tbody>
					</table>
					{nodes.length === 0 && (
						<div className="text-center py-8 text-gray-500">
							No RPA nodes found. A node must run at least once to be
							registered.
						</div>
					)}
				</div>
			</div>

			<Modal
				isOpen={isAssignModalOpen}
				onClose={handleCloseAssignModal}
				title="Assign Node to Doctor"
			>
				<form onSubmit={handleAssign} className="space-y-4">
					{selectedNode && (
						<div className="p-3 bg-gray-50 dark:bg-slate-800 rounded-lg text-sm mb-4">
							<p className="text-gray-600 dark:text-gray-400">
								Configuring Node:
							</p>
							<p className="font-mono mt-1 dark:text-white">
								{selectedNode.uuid}
							</p>
							<p className="text-gray-500 mt-1">{selectedNode.hostname}</p>
						</div>
					)}
					<div>
						<label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
							Select Doctor *
						</label>
						<select
							className="input-field"
							value={selectedDoctorId}
							onChange={(e) => setSelectedDoctorId(e.target.value)}
							required
						>
							<option value="" disabled>
								-- Choose a doctor --
							</option>
							{doctors.map((d) => (
								<option key={d.id} value={d.id}>
									{d.name} ({d.username})
								</option>
							))}
						</select>
					</div>

					<div className="flex gap-3 pt-4">
						<button
							type="button"
							onClick={handleCloseAssignModal}
							className="btn-secondary flex-1"
							disabled={assigning}
						>
							Cancel
						</button>
						<button
							type="submit"
							className="btn-primary flex-1"
							disabled={assigning}
						>
							{assigning ? "Assigning..." : "Assign"}
						</button>
					</div>
				</form>
			</Modal>
		</div>
	);
}
