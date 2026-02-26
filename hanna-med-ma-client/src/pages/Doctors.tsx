import { useEffect, useState } from "react";
import {
	Plus,
	Pencil,
	Trash2,
	Building2,
	Bell,
	Send,
	Check,
} from "lucide-react";
import { doctorService } from "../services/doctorService";
import type { Doctor, CreateDoctorDto, UpdateDoctorDto } from "../types";
import Modal from "../components/Modal";

// All available EMR systems with display metadata
const ALL_EMR_SYSTEMS = [
	{ key: "JACKSON", label: "Jackson Health", color: "blue" },
	{ key: "STEWARD", label: "Steward Health", color: "green" },
	{ key: "BAPTIST", label: "Baptist Health", color: "purple" },
] as const;

const EMR_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
	JACKSON: {
		bg: "bg-blue-100 dark:bg-blue-900/30",
		text: "text-blue-700 dark:text-blue-300",
		dot: "bg-blue-500",
	},
	STEWARD: {
		bg: "bg-green-100 dark:bg-green-900/30",
		text: "text-green-700 dark:text-green-300",
		dot: "bg-green-500",
	},
	BAPTIST: {
		bg: "bg-purple-100 dark:bg-purple-900/30",
		text: "text-purple-700 dark:text-purple-300",
		dot: "bg-purple-500",
	},
};

export default function Doctors() {
	const [doctors, setDoctors] = useState<Doctor[]>([]);
	const [loading, setLoading] = useState(true);
	const [isModalOpen, setIsModalOpen] = useState(false);
	const [editingDoctor, setEditingDoctor] = useState<Doctor | null>(null);
	const [formData, setFormData] = useState<CreateDoctorDto>({
		name: "",
		username: "",
		password: "",
		specialty: "",
		emrSystems: [],
	});

	// Notification state
	const [selectedDoctorIds, setSelectedDoctorIds] = useState<Set<number>>(
		new Set(),
	);
	const [isNotifyModalOpen, setIsNotifyModalOpen] = useState(false);
	const [notifyTitle, setNotifyTitle] = useState("");
	const [notifyBody, setNotifyBody] = useState("");
	const [isSendingNotification, setIsSendingNotification] = useState(false);
	const [notifyResult, setNotifyResult] = useState<{
		success: boolean;
		message: string;
	} | null>(null);

	useEffect(() => {
		fetchDoctors();
	}, []);

	const fetchDoctors = async () => {
		try {
			const data = await doctorService.getAll();
			setDoctors(data);
		} catch (error) {
			console.error("Error fetching doctors:", error);
		} finally {
			setLoading(false);
		}
	};

	const handleOpenModal = (doctor?: Doctor) => {
		if (doctor) {
			setEditingDoctor(doctor);
			setFormData({
				name: doctor.name,
				username: doctor.username,
				password: "",
				specialty: doctor.specialty || "",
				emrSystems: doctor.emrSystems || [],
			});
		} else {
			setEditingDoctor(null);
			setFormData({
				name: "",
				username: "",
				password: "",
				specialty: "",
				emrSystems: [],
			});
		}
		setIsModalOpen(true);
	};

	const handleCloseModal = () => {
		setIsModalOpen(false);
		setEditingDoctor(null);
		setFormData({
			name: "",
			username: "",
			password: "",
			specialty: "",
			emrSystems: [],
		});
	};

	const toggleEmrSystem = (systemKey: string) => {
		const current = formData.emrSystems || [];
		const updated = current.includes(systemKey)
			? current.filter((s) => s !== systemKey)
			: [...current, systemKey];
		setFormData({ ...formData, emrSystems: updated });
	};

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		try {
			if (editingDoctor) {
				const updateData: UpdateDoctorDto = {
					name: formData.name,
					username: formData.username,
					password: formData.password || undefined,
					specialty: formData.specialty || undefined,
					emrSystems: formData.emrSystems,
				};
				await doctorService.update(editingDoctor.id, updateData);
			} else {
				const createData: CreateDoctorDto = {
					name: formData.name,
					username: formData.username,
					password: formData.password,
					specialty: formData.specialty,
					emrSystems: formData.emrSystems,
				};
				await doctorService.create(createData);
			}
			await fetchDoctors();
			handleCloseModal();
		} catch (error) {
			console.error("Error saving doctor:", error);
			alert("Error saving doctor");
		}
	};

	const handleDelete = async (id: number) => {
		if (window.confirm("Are you sure you want to delete this doctor?")) {
			try {
				await doctorService.delete(id);
				await fetchDoctors();
			} catch (error) {
				console.error("Error deleting doctor:", error);
				alert("Error deleting doctor");
			}
		}
	};

	// --- Selection helpers ---
	const toggleSelectDoctor = (id: number) => {
		setSelectedDoctorIds((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	};

	const toggleSelectAll = () => {
		if (selectedDoctorIds.size === doctors.length) {
			setSelectedDoctorIds(new Set());
		} else {
			setSelectedDoctorIds(new Set(doctors.map((d) => d.id)));
		}
	};

	// --- Notification modal ---
	const openNotifyModal = () => {
		setNotifyTitle("");
		setNotifyBody("");
		setNotifyResult(null);
		setIsNotifyModalOpen(true);
	};

	const handleSendNotification = async (e: React.FormEvent) => {
		e.preventDefault();
		setIsSendingNotification(true);
		setNotifyResult(null);

		try {
			const ids =
				selectedDoctorIds.size > 0 ? Array.from(selectedDoctorIds) : undefined;

			const result = await doctorService.sendNotification(
				notifyTitle,
				notifyBody,
				ids,
			);

			setNotifyResult({
				success: result.success,
				message: result.message,
			});

			// Auto-close after success
			setTimeout(() => {
				setIsNotifyModalOpen(false);
				setSelectedDoctorIds(new Set());
			}, 2000);
		} catch (error) {
			console.error("Error sending notification:", error);
			setNotifyResult({
				success: false,
				message: "Error sending notification. Check console for details.",
			});
		} finally {
			setIsSendingNotification(false);
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
						Doctors Management
					</h1>
					<p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
						Manage doctors and their EMR system access
					</p>
				</div>
				<div className="flex items-center gap-2">
					<button
						onClick={openNotifyModal}
						className="flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors"
					>
						<Bell className="w-4 h-4" />
						{selectedDoctorIds.size > 0
							? `Notify (${selectedDoctorIds.size})`
							: "Notify All"}
					</button>
					<button
						onClick={() => handleOpenModal()}
						className="btn-primary flex items-center gap-2"
					>
						<Plus className="w-4 h-4" />
						Add Doctor
					</button>
				</div>
			</div>

			<div className="card">
				<div className="overflow-x-auto">
					<table className="w-full">
						<thead>
							<tr className="border-b border-gray-200 dark:border-slate-700">
								<th className="py-2 px-3 w-10">
									<input
										type="checkbox"
										checked={
											doctors.length > 0 &&
											selectedDoctorIds.size === doctors.length
										}
										onChange={toggleSelectAll}
										className="w-4 h-4 rounded border-gray-300 dark:border-slate-600 text-violet-600 focus:ring-violet-500 cursor-pointer"
									/>
								</th>
								<th className="text-left py-2 px-3 text-xs font-semibold text-gray-700 dark:text-gray-300">
									Name
								</th>
								<th className="text-left py-2 px-3 text-xs font-semibold text-gray-700 dark:text-gray-300">
									Specialty
								</th>
								<th className="text-left py-2 px-3 text-xs font-semibold text-gray-700 dark:text-gray-300">
									EMR Systems
								</th>
								<th className="text-left py-2 px-3 text-xs font-semibold text-gray-700 dark:text-gray-300">
									Username
								</th>
								<th className="text-right py-2 px-3 text-xs font-semibold text-gray-700 dark:text-gray-300">
									Actions
								</th>
							</tr>
						</thead>
						<tbody>
							{doctors.map((doctor) => (
								<tr
									key={doctor.id}
									className="border-b border-gray-100 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-700/50"
								>
									<td className="py-2 px-3">
										<input
											type="checkbox"
											checked={selectedDoctorIds.has(doctor.id)}
											onChange={() => toggleSelectDoctor(doctor.id)}
											className="w-4 h-4 rounded border-gray-300 dark:border-slate-600 text-violet-600 focus:ring-violet-500 cursor-pointer"
										/>
									</td>
									<td className="py-2 px-3 text-sm font-medium dark:text-white">
										{doctor.name}
									</td>
									<td className="py-2 px-3 text-xs text-gray-600 dark:text-gray-400">
										{doctor.specialty || "-"}
									</td>
									<td className="py-2 px-3">
										<div className="flex flex-wrap gap-1">
											{(doctor.emrSystems || []).length > 0 ? (
												doctor.emrSystems.map((sys) => {
													const colors = EMR_COLORS[sys] || {
														bg: "bg-gray-100 dark:bg-gray-700",
														text: "text-gray-700 dark:text-gray-300",
														dot: "bg-gray-500",
													};
													return (
														<span
															key={sys}
															className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${colors.bg} ${colors.text}`}
														>
															<span
																className={`w-1.5 h-1.5 rounded-full ${colors.dot}`}
															/>
															{sys}
														</span>
													);
												})
											) : (
												<span className="text-xs text-gray-400">
													No systems
												</span>
											)}
										</div>
									</td>
									<td className="py-2 px-3 text-xs text-gray-600 dark:text-gray-400">
										{doctor.username}
									</td>
									<td className="py-2 px-3">
										<div className="flex justify-end gap-1">
											<button
												onClick={() => handleOpenModal(doctor)}
												className="p-1.5 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-lg transition-colors"
												title="Edit"
											>
												<Pencil className="w-3.5 h-3.5" />
											</button>
											<button
												onClick={() => handleDelete(doctor.id)}
												className="p-1.5 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg transition-colors"
												title="Delete"
											>
												<Trash2 className="w-3.5 h-3.5" />
											</button>
										</div>
									</td>
								</tr>
							))}
						</tbody>
					</table>
					{doctors.length === 0 && (
						<div className="text-center py-8 text-gray-500">
							No doctors found
						</div>
					)}
				</div>
			</div>

			<Modal
				isOpen={isModalOpen}
				onClose={handleCloseModal}
				title={editingDoctor ? "Edit Doctor" : "Add New Doctor"}
			>
				<form onSubmit={handleSubmit} className="space-y-4">
					<div>
						<label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
							Name *
						</label>
						<input
							type="text"
							value={formData.name}
							onChange={(e) =>
								setFormData({ ...formData, name: e.target.value })
							}
							className="input-field"
							placeholder="Dr. John Doe"
							required
						/>
					</div>

					<div>
						<label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
							Username *
						</label>
						<input
							type="text"
							value={formData.username}
							onChange={(e) =>
								setFormData({ ...formData, username: e.target.value })
							}
							className="input-field"
							placeholder="dr.john"
							required={!editingDoctor}
							disabled={!!editingDoctor}
						/>
					</div>

					<div>
						<label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
							Password {!editingDoctor && "*"}
						</label>
						<input
							type="password"
							value={formData.password}
							onChange={(e) =>
								setFormData({ ...formData, password: e.target.value })
							}
							className="input-field"
							placeholder={
								editingDoctor ? "Leave blank to keep current" : "Enter password"
							}
							required={!editingDoctor}
						/>
						{editingDoctor && (
							<p className="text-xs text-gray-500 mt-1">
								Leave blank to keep the current password
							</p>
						)}
					</div>

					<div>
						<label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
							Specialty
						</label>
						<input
							type="text"
							value={formData.specialty}
							onChange={(e) =>
								setFormData({ ...formData, specialty: e.target.value })
							}
							className="input-field"
							placeholder="Cardiology, Neurology, etc."
						/>
					</div>

					{/* EMR Systems Access */}
					<div>
						<label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">
							EMR Systems Access
						</label>
						<div className="grid grid-cols-1 gap-2">
							{ALL_EMR_SYSTEMS.map((system) => {
								const isSelected = (formData.emrSystems || []).includes(
									system.key,
								);
								const colors = EMR_COLORS[system.key];
								return (
									<button
										key={system.key}
										type="button"
										onClick={() => toggleEmrSystem(system.key)}
										className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border-2 transition-all ${
											isSelected
												? `${colors.bg} border-current ${colors.text}`
												: "border-gray-200 dark:border-slate-600 text-gray-500 dark:text-gray-400 hover:border-gray-300 dark:hover:border-slate-500"
										}`}
									>
										<div
											className={`w-8 h-8 rounded-lg flex items-center justify-center ${
												isSelected
													? `${colors.bg}`
													: "bg-gray-100 dark:bg-slate-700"
											}`}
										>
											<Building2
												className={`w-4 h-4 ${
													isSelected
														? colors.text
														: "text-gray-400 dark:text-gray-500"
												}`}
											/>
										</div>
										<div className="flex-1 text-left">
											<span className="text-sm font-medium">
												{system.label}
											</span>
										</div>
										<div
											className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all ${
												isSelected
													? `${colors.dot} border-transparent`
													: "border-gray-300 dark:border-slate-500"
											}`}
										>
											{isSelected && (
												<svg
													className="w-3 h-3 text-white"
													fill="none"
													viewBox="0 0 24 24"
													stroke="currentColor"
													strokeWidth={3}
												>
													<path
														strokeLinecap="round"
														strokeLinejoin="round"
														d="M5 13l4 4L19 7"
													/>
												</svg>
											)}
										</div>
									</button>
								);
							})}
						</div>
						<p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1.5">
							Select which EMR systems this doctor has access to. Credentials
							are configured separately for systems that require them.
						</p>
					</div>

					<div className="flex gap-3 pt-4">
						<button
							type="button"
							onClick={handleCloseModal}
							className="btn-secondary flex-1"
						>
							Cancel
						</button>
						<button type="submit" className="btn-primary flex-1">
							{editingDoctor ? "Update" : "Create"}
						</button>
					</div>
				</form>
			</Modal>

			{/* Notification Modal */}
			<Modal
				isOpen={isNotifyModalOpen}
				onClose={() => setIsNotifyModalOpen(false)}
				title={
					selectedDoctorIds.size > 0
						? `Send Notification (${selectedDoctorIds.size} doctor${selectedDoctorIds.size > 1 ? "s" : ""})`
						: "Send Notification to All Doctors"
				}
			>
				<form onSubmit={handleSendNotification} className="space-y-4">
					{/* Selected doctors preview */}
					{selectedDoctorIds.size > 0 && (
						<div className="bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-800 rounded-lg p-3">
							<p className="text-xs font-medium text-violet-700 dark:text-violet-300 mb-1.5">
								Recipients:
							</p>
							<div className="flex flex-wrap gap-1">
								{doctors
									.filter((d) => selectedDoctorIds.has(d.id))
									.map((d) => (
										<span
											key={d.id}
											className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-violet-100 dark:bg-violet-800/40 text-violet-700 dark:text-violet-300"
										>
											{d.name}
										</span>
									))}
							</div>
						</div>
					)}

					{selectedDoctorIds.size === 0 && (
						<div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
							<p className="text-xs text-amber-700 dark:text-amber-300">
								No doctors selected — this will send to{" "}
								<strong>all doctors</strong> with active push tokens.
							</p>
						</div>
					)}

					<div>
						<label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
							Title *
						</label>
						<input
							type="text"
							value={notifyTitle}
							onChange={(e) => setNotifyTitle(e.target.value)}
							className="input-field"
							placeholder="e.g. System Update"
							required
							maxLength={100}
						/>
					</div>

					<div>
						<label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
							Message *
						</label>
						<textarea
							value={notifyBody}
							onChange={(e) => setNotifyBody(e.target.value)}
							className="input-field min-h-[80px] resize-y"
							placeholder="e.g. A new version of the app is available. Please update."
							required
							maxLength={500}
							rows={3}
						/>
						<p className="text-[10px] text-gray-400 mt-1 text-right">
							{notifyBody.length}/500
						</p>
					</div>

					{/* Result feedback */}
					{notifyResult && (
						<div
							className={`flex items-center gap-2 p-3 rounded-lg text-xs font-medium ${
								notifyResult.success
									? "bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 border border-green-200 dark:border-green-800"
									: "bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800"
							}`}
						>
							{notifyResult.success ? (
								<Check className="w-4 h-4 flex-shrink-0" />
							) : null}
							{notifyResult.message}
						</div>
					)}

					<div className="flex gap-3 pt-4">
						<button
							type="button"
							onClick={() => setIsNotifyModalOpen(false)}
							className="btn-secondary flex-1"
						>
							Cancel
						</button>
						<button
							type="submit"
							disabled={isSendingNotification || notifyResult?.success === true}
							className="btn-primary flex-1 flex items-center justify-center gap-2 disabled:opacity-50"
						>
							{isSendingNotification ? (
								<>
									<svg
										className="w-4 h-4 animate-spin"
										viewBox="0 0 24 24"
										fill="none"
									>
										<circle
											className="opacity-25"
											cx="12"
											cy="12"
											r="10"
											stroke="currentColor"
											strokeWidth="4"
										/>
										<path
											className="opacity-75"
											fill="currentColor"
											d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
										/>
									</svg>
									Sending...
								</>
							) : (
								<>
									<Send className="w-4 h-4" />
									Send Notification
								</>
							)}
						</button>
					</div>
				</form>
			</Modal>
		</div>
	);
}
