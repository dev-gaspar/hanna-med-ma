import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2, Key, Building2 } from "lucide-react";
import { credentialService } from "../services/credentialService";
import { doctorService } from "../services/doctorService";
import type {
	DoctorCredential,
	EMRSystem,
	Doctor,
	CreateCredentialDto,
} from "../types";
import Modal from "../components/Modal";

// EMR System logos
const systemLogos: Record<string, React.ReactNode> = {
	JACKSON: (
		<div className="w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
			<Building2 className="w-6 h-6 text-blue-600 dark:text-blue-400" />
		</div>
	),
	STEWARD: (
		<div className="w-10 h-10 rounded-lg bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
			<Building2 className="w-6 h-6 text-green-600 dark:text-green-400" />
		</div>
	),
	BAPTIST: (
		<div className="w-10 h-10 rounded-lg bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
			<Building2 className="w-6 h-6 text-purple-600 dark:text-purple-400" />
		</div>
	),
};

export default function Credentials() {
	const [doctors, setDoctors] = useState<Doctor[]>([]);
	const [selectedDoctor, setSelectedDoctor] = useState<Doctor | null>(null);
	const [credentials, setCredentials] = useState<DoctorCredential[]>([]);
	const [systems, setSystems] = useState<EMRSystem[]>([]);
	const [loading, setLoading] = useState(true);
	const [isModalOpen, setIsModalOpen] = useState(false);
	const [editingCredential, setEditingCredential] =
		useState<DoctorCredential | null>(null);
	const [selectedSystem, setSelectedSystem] = useState<EMRSystem | null>(null);
	const [formFields, setFormFields] = useState<Record<string, string>>({});

	useEffect(() => {
		fetchInitialData();
	}, []);

	useEffect(() => {
		if (selectedDoctor) {
			fetchCredentials(selectedDoctor.id);
		}
	}, [selectedDoctor]);

	const fetchInitialData = async () => {
		try {
			const [doctorsData, systemsData] = await Promise.all([
				doctorService.getAll(),
				credentialService.getSystems(),
			]);
			setDoctors(doctorsData);
			setSystems(systemsData);
			if (doctorsData.length > 0) {
				setSelectedDoctor(doctorsData[0]);
			}
		} catch (error) {
			console.error("Error fetching data:", error);
		} finally {
			setLoading(false);
		}
	};

	const fetchCredentials = async (doctorId: number) => {
		try {
			const data = await credentialService.getByDoctor(doctorId);
			setCredentials(data);
		} catch (error) {
			console.error("Error fetching credentials:", error);
			setCredentials([]);
		}
	};

	const handleOpenModal = (credential?: DoctorCredential) => {
		if (credential) {
			setEditingCredential(credential);
			const system = systems.find((s) => s.key === credential.systemKey);
			setSelectedSystem(system || null);
			setFormFields(credential.fields);
		} else {
			setEditingCredential(null);
			setSelectedSystem(null);
			setFormFields({});
		}
		setIsModalOpen(true);
	};

	const handleCloseModal = () => {
		setIsModalOpen(false);
		setEditingCredential(null);
		setSelectedSystem(null);
		setFormFields({});
	};

	const handleSystemChange = (systemKey: string) => {
		const system = systems.find((s) => s.key === systemKey);
		setSelectedSystem(system || null);
		// Initialize form fields for the selected system
		const initialFields: Record<string, string> = {};
		system?.fields.forEach((field) => {
			initialFields[field.key] = "";
		});
		setFormFields(initialFields);
	};

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!selectedDoctor || !selectedSystem) return;

		try {
			if (editingCredential) {
				await credentialService.update(editingCredential.id, {
					fields: formFields,
				});
			} else {
				const createData: CreateCredentialDto = {
					doctorId: selectedDoctor.id,
					systemKey: selectedSystem.key,
					fields: formFields,
				};
				await credentialService.create(createData);
			}
			await fetchCredentials(selectedDoctor.id);
			handleCloseModal();
		} catch (error) {
			console.error("Error saving credential:", error);
			alert("Error saving credential");
		}
	};

	const handleDelete = async (id: number) => {
		if (window.confirm("Are you sure you want to delete this credential?")) {
			try {
				await credentialService.delete(id);
				if (selectedDoctor) {
					await fetchCredentials(selectedDoctor.id);
				}
			} catch (error) {
				console.error("Error deleting credential:", error);
				alert("Error deleting credential");
			}
		}
	};

	// Only show systems that actually need credentials (have fields)
	// and that the doctor doesn't already have a credential for
	const systemsWithFields = systems.filter((s) => s.fields.length > 0);
	const availableSystems = systemsWithFields.filter(
		(s) => !credentials.some((c) => c.systemKey === s.key),
	);

	// Systems that don't need credentials (like Baptist)
	const noCredentialSystems = systems.filter((s) => s.fields.length === 0);

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
						EMR Credentials
					</h1>
					<p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
						Manage doctor credentials for EMR systems that require login
					</p>
				</div>
			</div>

			{/* Doctor Selector */}
			<div className="card mb-4">
				<label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">
					Select Doctor
				</label>
				<select
					value={selectedDoctor?.id || ""}
					onChange={(e) => {
						const doctor = doctors.find((d) => d.id === Number(e.target.value));
						setSelectedDoctor(doctor || null);
					}}
					className="input-field max-w-md"
				>
					{doctors.map((doctor) => (
						<option key={doctor.id} value={doctor.id}>
							{doctor.name}
						</option>
					))}
				</select>
			</div>

			{selectedDoctor && (
				<>
					{/* Info about systems that don't need credentials */}
					{noCredentialSystems.length > 0 && (
						<div className="mb-4 p-3 bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-lg">
							<p className="text-xs text-purple-700 dark:text-purple-300">
								<strong>
									{noCredentialSystems.map((s) => s.name).join(", ")}
								</strong>{" "}
								{noCredentialSystems.length === 1 ? "uses" : "use"} saved
								browser credentials and {noCredentialSystems.length === 1 ? "doesn't" : "don't"}{" "}
								need manual configuration. Enable access in{" "}
								<strong>Doctors Management</strong>.
							</p>
						</div>
					)}

					{/* Credentials List */}
					<div className="card">
						<div className="flex justify-between items-center mb-3">
							<h2 className="text-sm font-semibold text-gray-800 dark:text-white">
								Credentials for {selectedDoctor.name}
							</h2>
							{availableSystems.length > 0 && (
								<button
									onClick={() => handleOpenModal()}
									className="btn-primary flex items-center gap-2"
								>
									<Plus className="w-4 h-4" />
									Add Credential
								</button>
							)}
						</div>

						{credentials.length === 0 ? (
							<div className="text-center py-8 text-gray-500">
								<Key className="w-12 h-12 mx-auto mb-3 opacity-50" />
								<p>No credentials configured for this doctor</p>
								{availableSystems.length > 0 && (
									<button
										onClick={() => handleOpenModal()}
										className="mt-4 text-primary hover:underline"
									>
										Add first credential
									</button>
								)}
							</div>
						) : (
							<div className="grid gap-4">
								{credentials.map((credential) => (
									<div
										key={credential.id}
										className="flex items-center justify-between p-3 bg-gray-50 dark:bg-slate-700/50 rounded-lg"
									>
										<div className="flex items-center gap-3">
											{systemLogos[credential.systemKey] || (
												<div className="w-8 h-8 rounded-lg bg-gray-200 dark:bg-slate-600 flex items-center justify-center">
													<Key className="w-4 h-4 text-gray-500 dark:text-gray-400" />
												</div>
											)}
											<div>
												<h3 className="text-sm font-medium text-gray-900 dark:text-white">
													{credential.systemInfo?.name || credential.systemKey}
												</h3>
												<p className="text-xs text-gray-500 dark:text-gray-400">
													{Object.keys(credential.fields).length} fields
													configured
												</p>
											</div>
										</div>
										<div className="flex gap-1">
											<button
												onClick={() => handleOpenModal(credential)}
												className="p-1.5 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-lg transition-colors"
												title="Edit"
											>
												<Pencil className="w-3.5 h-3.5" />
											</button>
											<button
												onClick={() => handleDelete(credential.id)}
												className="p-1.5 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg transition-colors"
												title="Delete"
											>
												<Trash2 className="w-3.5 h-3.5" />
											</button>
										</div>
									</div>
								))}
							</div>
						)}
					</div>
				</>
			)}

			{/* Modal */}
			<Modal
				isOpen={isModalOpen}
				onClose={handleCloseModal}
				title={editingCredential ? "Edit Credential" : "Add New Credential"}
			>
				<form onSubmit={handleSubmit} className="space-y-4">
					{/* System Selector (only for new credentials) */}
					{!editingCredential && (
						<div>
							<label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
								EMR System *
							</label>
							<select
								value={selectedSystem?.key || ""}
								onChange={(e) => handleSystemChange(e.target.value)}
								className="input-field"
								required
							>
								<option value="">Select a system...</option>
								{availableSystems.map((system) => (
									<option key={system.key} value={system.key}>
										{system.name}
									</option>
								))}
							</select>
						</div>
					)}

					{/* Dynamic Fields */}
					{selectedSystem &&
						selectedSystem.fields.map((field) => (
							<div key={field.key}>
								<label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
									{field.label} {field.required && "*"}
								</label>
								<input
									type={field.type}
									value={formFields[field.key] || ""}
									onChange={(e) =>
										setFormFields({
											...formFields,
											[field.key]: e.target.value,
										})
									}
									className="input-field"
									placeholder={`Enter ${field.label.toLowerCase()}`}
									required={field.required}
								/>
							</div>
						))}

					{selectedSystem && (
						<div className="flex gap-3 pt-4">
							<button
								type="button"
								onClick={handleCloseModal}
								className="btn-secondary flex-1"
							>
								Cancel
							</button>
							<button type="submit" className="btn-primary flex-1">
								{editingCredential ? "Update" : "Create"}
							</button>
						</div>
					)}
				</form>
			</Modal>
		</div>
	);
}
