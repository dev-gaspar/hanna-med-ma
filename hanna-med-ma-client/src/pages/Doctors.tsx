import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2, Building2 } from "lucide-react";
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
				<button
					onClick={() => handleOpenModal()}
					className="btn-primary flex items-center gap-2"
				>
					<Plus className="w-4 h-4" />
					Add Doctor
				</button>
			</div>

			<div className="card">
				<div className="overflow-x-auto">
					<table className="w-full">
						<thead>
							<tr className="border-b border-gray-200 dark:border-slate-700">
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
		</div>
	);
}
