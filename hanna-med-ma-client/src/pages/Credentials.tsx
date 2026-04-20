import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2, Key, Lock, Loader2 } from "lucide-react";
import { credentialService } from "../services/credentialService";
import { doctorService } from "../services/doctorService";
import type {
	DoctorCredential,
	EMRSystem,
	Doctor,
	CreateCredentialDto,
} from "../types";
import Modal from "../components/Modal";
import { Button } from "../components/ui/Button";
import { Chip } from "../components/ui/Chip";
import { EmptyState } from "../components/ui/EmptyState";

const SYSTEM_HUE: Record<string, string> = {
	JACKSON: "#c06a1f",
	STEWARD: "#6d4f8f",
	BAPTIST: "#2a6f84",
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
	const [submitting, setSubmitting] = useState(false);

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
		const initialFields: Record<string, string> = {};
		system?.fields.forEach((field) => {
			initialFields[field.key] = "";
		});
		setFormFields(initialFields);
	};

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!selectedDoctor || !selectedSystem) return;
		setSubmitting(true);
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
		} finally {
			setSubmitting(false);
		}
	};

	const handleDelete = async (id: number) => {
		if (!window.confirm("Delete this credential?")) return;
		try {
			await credentialService.delete(id);
			if (selectedDoctor) {
				await fetchCredentials(selectedDoctor.id);
			}
		} catch (error) {
			console.error("Error deleting credential:", error);
		}
	};

	const systemsWithFields = systems.filter((s) => s.fields.length > 0);
	const availableSystems = systemsWithFields.filter(
		(s) => !credentials.some((c) => c.systemKey === s.key),
	);
	const noCredentialSystems = systems.filter((s) => s.fields.length === 0);

	return (
		<div className="max-w-5xl">
			<div className="flex items-end justify-between gap-4 pb-4 mb-5 border-b border-n-150">
				<div>
					<div className="label-kicker mb-1.5">Administration</div>
					<h1 className="font-serif text-[24px] text-n-900 leading-tight">
						EMR Credentials
					</h1>
					<p className="text-[12.5px] text-n-500 mt-1.5 max-w-2xl leading-relaxed">
						Encrypted at rest. RPA nodes pull these on heartbeat via{" "}
						<span className="font-mono text-n-800">GET /rpa/:uuid/config</span>.
					</p>
				</div>
			</div>

			{loading ? (
				<div className="flex items-center justify-center gap-2 py-12 text-n-500">
					<Loader2 className="w-4 h-4 animate-spin" />
					<span className="font-mono text-[11px] uppercase tracking-widest">
						Loading
					</span>
				</div>
			) : (
				<>
					<div className="mb-5">
						<label className="label-kicker block mb-1.5">Doctor</label>
						<select
							value={selectedDoctor?.id || ""}
							onChange={(e) => {
								const doctor = doctors.find(
									(d) => d.id === Number(e.target.value),
								);
								setSelectedDoctor(doctor || null);
							}}
							className="input-field max-w-sm"
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
							{noCredentialSystems.length > 0 && (
								<div className="mb-5 px-3 py-2.5 border border-n-150 rounded-md bg-n-50">
									<p className="text-[12.5px] text-n-700 leading-relaxed">
										<span className="font-semibold">
											{noCredentialSystems.map((s) => s.name).join(", ")}
										</span>{" "}
										{noCredentialSystems.length === 1 ? "uses" : "use"} saved
										browser credentials and{" "}
										{noCredentialSystems.length === 1 ? "doesn't" : "don't"}{" "}
										need manual configuration. Enable access in{" "}
										<span className="font-semibold">Doctors</span>.
									</p>
								</div>
							)}

							<div className="flex items-center justify-between mb-3">
								<div className="flex items-center gap-2">
									<h2 className="font-serif text-[16px] text-n-900">
										Credentials for {selectedDoctor.name}
									</h2>
									<Chip>{credentials.length}</Chip>
								</div>
								{availableSystems.length > 0 && (
									<Button
										tone="primary"
										size="sm"
										onClick={() => handleOpenModal()}
										leading={<Plus className="w-3.5 h-3.5" />}
									>
										Add credential
									</Button>
								)}
							</div>

							{credentials.length === 0 ? (
								<EmptyState
									title="No credentials configured"
									body={
										availableSystems.length > 0
											? "Add credentials for the EMR systems assigned to this doctor."
											: "All assigned EMR systems already have credentials or don't require them."
									}
									action={
										availableSystems.length > 0 && (
											<Button
												tone="primary"
												size="sm"
												onClick={() => handleOpenModal()}
												leading={<Plus className="w-3.5 h-3.5" />}
											>
												Add first credential
											</Button>
										)
									}
								/>
							) : (
								<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
									{credentials.map((credential) => (
										<div
											key={credential.id}
											className="border border-n-150 rounded-lg bg-n-0 p-4"
										>
											<div className="flex items-start gap-3">
												<div
													className="w-9 h-9 rounded-md grid place-items-center shrink-0"
													style={{
														background: `${SYSTEM_HUE[credential.systemKey] || "#5e5e5e"}1a`,
													}}
												>
													<Lock
														className="w-4 h-4"
														style={{
															color:
																SYSTEM_HUE[credential.systemKey] ||
																"#5e5e5e",
														}}
													/>
												</div>
												<div className="flex-1 min-w-0">
													<div className="flex items-center gap-2">
														<div className="font-semibold text-[13.5px] text-n-900 truncate">
															{credential.systemInfo?.name ||
																credential.systemKey}
														</div>
														<Chip tone="ok">configured</Chip>
													</div>
													<div className="font-mono text-[10.5px] text-n-500 mt-0.5">
														{Object.keys(credential.fields).length} field
														{Object.keys(credential.fields).length === 1
															? ""
															: "s"}{" "}
														configured
													</div>
												</div>
												<div className="flex gap-0.5">
													<button
														onClick={() => handleOpenModal(credential)}
														className="inline-flex items-center justify-center w-7 h-7 rounded-md text-n-500 hover:text-n-900 hover:bg-n-100 transition"
														title="Edit"
													>
														<Pencil className="w-3.5 h-3.5" />
													</button>
													<button
														onClick={() => handleDelete(credential.id)}
														className="inline-flex items-center justify-center w-7 h-7 rounded-md text-n-500 hover:text-[var(--dnr-fg)] hover:bg-[var(--dnr-bg)] transition"
														title="Delete"
													>
														<Trash2 className="w-3.5 h-3.5" />
													</button>
												</div>
											</div>
										</div>
									))}
								</div>
							)}
						</>
					)}
				</>
			)}

			<Modal
				isOpen={isModalOpen}
				onClose={handleCloseModal}
				title={editingCredential ? "Edit credential" : "Add credential"}
			>
				<form onSubmit={handleSubmit} className="space-y-4">
					{!editingCredential && (
						<div>
							<label className="label-kicker block mb-1.5">EMR system *</label>
							<select
								value={selectedSystem?.key || ""}
								onChange={(e) => handleSystemChange(e.target.value)}
								className="input-field"
								required
							>
								<option value="">Select a system…</option>
								{availableSystems.map((system) => (
									<option key={system.key} value={system.key}>
										{system.name}
									</option>
								))}
							</select>
						</div>
					)}

					{selectedSystem &&
						selectedSystem.fields.map((field) => (
							<div key={field.key}>
								<label className="label-kicker block mb-1.5">
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
									placeholder={field.label}
									required={field.required}
								/>
							</div>
						))}

					{selectedSystem && (
						<div className="flex gap-2 pt-2">
							<Button
								type="button"
								tone="ghost"
								size="md"
								onClick={handleCloseModal}
								className="flex-1"
							>
								Cancel
							</Button>
							<Button
								type="submit"
								tone="primary"
								size="md"
								disabled={submitting}
								className="flex-1"
							>
								{submitting ? (
									<>
										<Loader2 className="w-4 h-4 animate-spin" />
										<span>Saving…</span>
									</>
								) : editingCredential ? (
									"Update"
								) : (
									"Create"
								)}
							</Button>
						</div>
					)}

					{!selectedSystem && !editingCredential && (
						<div className="flex items-center gap-2 pt-2 text-[12px] text-n-500">
							<Key className="w-3.5 h-3.5" />
							<span>Select an EMR system to see its required fields.</span>
						</div>
					)}
				</form>
			</Modal>
		</div>
	);
}
