import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2, Bell, Send, Check, Loader2 } from "lucide-react";
import { doctorService } from "../services/doctorService";
import type { Doctor, CreateDoctorDto, UpdateDoctorDto } from "../types";
import Modal from "../components/Modal";
import { Button } from "../components/ui/Button";
import { Chip } from "../components/ui/Chip";
import { cls } from "../lib/cls";

const EMR_META: Record<string, { label: string; hue: string }> = {
	JACKSON: { label: "Jackson", hue: "#c06a1f" },
	STEWARD: { label: "Stewart", hue: "#6d4f8f" },
	BAPTIST: { label: "Baptist", hue: "#2a6f84" },
};

const ALL_EMR_SYSTEMS = Object.keys(EMR_META) as Array<keyof typeof EMR_META>;

function EmrPill({ system }: { system: string }) {
	const meta = EMR_META[system] ?? { label: system, hue: "#5e5e5e" };
	return (
		<span className="inline-flex items-center gap-1.5 px-2 py-[3px] rounded border border-n-200 text-n-700 text-[10.5px] font-mono uppercase tracking-wider">
			<span
				className="w-1.5 h-1.5 rounded-full"
				style={{ background: meta.hue }}
			/>
			{meta.label}
		</span>
	);
}

export default function Doctors() {
	const [doctors, setDoctors] = useState<Doctor[]>([]);
	const [loading, setLoading] = useState(true);
	const [isModalOpen, setIsModalOpen] = useState(false);
	const [editingDoctor, setEditingDoctor] = useState<Doctor | null>(null);
	const [submitting, setSubmitting] = useState(false);
	const [formData, setFormData] = useState<CreateDoctorDto>({
		name: "",
		username: "",
		password: "",
		specialty: "",
		emrSystems: [],
	});

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
		setSubmitting(true);
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
				await doctorService.create(formData as CreateDoctorDto);
			}
			await fetchDoctors();
			handleCloseModal();
		} catch (error) {
			console.error("Error saving doctor:", error);
		} finally {
			setSubmitting(false);
		}
	};

	const handleDelete = async (id: number) => {
		if (!window.confirm("Delete this doctor?")) return;
		try {
			await doctorService.delete(id);
			await fetchDoctors();
		} catch (error) {
			console.error("Error deleting doctor:", error);
		}
	};

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
			setTimeout(() => {
				setIsNotifyModalOpen(false);
				setSelectedDoctorIds(new Set());
			}, 1800);
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

	return (
		<div className="max-w-6xl">
			<div className="flex items-end justify-between gap-4 pb-4 mb-5 border-b border-n-150">
				<div>
					<div className="label-kicker mb-1.5">Administration</div>
					<div className="flex items-center gap-3">
						<h1 className="font-serif text-[24px] text-n-900 leading-tight">
							Doctors
						</h1>
						<Chip>{doctors.length}</Chip>
					</div>
					<p className="text-[12.5px] text-n-500 mt-1.5">
						Providers with portal access and EMR assignments.
					</p>
				</div>
				<div className="flex items-center gap-2">
					<Button
						tone="ghost"
						size="sm"
						onClick={openNotifyModal}
						leading={<Bell className="w-3.5 h-3.5" />}
					>
						{selectedDoctorIds.size > 0
							? `Notify · ${selectedDoctorIds.size}`
							: "Notify all"}
					</Button>
					<Button
						tone="primary"
						size="sm"
						onClick={() => handleOpenModal()}
						leading={<Plus className="w-3.5 h-3.5" />}
					>
						Add doctor
					</Button>
				</div>
			</div>

			<div className="border border-n-150 rounded-lg bg-n-0 overflow-hidden">
				<div className="grid grid-cols-[30px_1.4fr_1fr_1.5fr_1fr_80px] px-4 h-10 border-b border-n-150 bg-n-50 items-center">
					<div>
						<input
							type="checkbox"
							checked={
								doctors.length > 0 &&
								selectedDoctorIds.size === doctors.length
							}
							onChange={toggleSelectAll}
							className="w-3.5 h-3.5 accent-p-600 cursor-pointer"
						/>
					</div>
					<div className="label-kicker">Name</div>
					<div className="label-kicker">Specialty</div>
					<div className="label-kicker">EMR systems</div>
					<div className="label-kicker">Username</div>
					<div className="label-kicker text-right">Actions</div>
				</div>

				{loading ? (
					<div className="flex items-center justify-center gap-2 py-10 text-n-500">
						<Loader2 className="w-4 h-4 animate-spin" />
						<span className="font-mono text-[11px] uppercase tracking-widest">
							Loading
						</span>
					</div>
				) : doctors.length === 0 ? (
					<div className="py-10 text-center font-mono text-[11.5px] text-n-500">
						No doctors yet.
					</div>
				) : (
					doctors.map((doctor) => (
						<div
							key={doctor.id}
							className="grid grid-cols-[30px_1.4fr_1fr_1.5fr_1fr_80px] px-4 py-3 border-b border-n-150 last:border-0 items-center hover:bg-n-50 transition"
						>
							<div>
								<input
									type="checkbox"
									checked={selectedDoctorIds.has(doctor.id)}
									onChange={() => toggleSelectDoctor(doctor.id)}
									className="w-3.5 h-3.5 accent-p-600 cursor-pointer"
								/>
							</div>
							<div className="min-w-0">
								<div className="text-[13.5px] font-medium text-n-900 truncate">
									{doctor.name}
								</div>
								<div className="font-mono text-[10.5px] text-n-500 truncate">
									id {doctor.id}
								</div>
							</div>
							<div className="text-[13px] text-n-700">
								{doctor.specialty || (
									<span className="text-n-400">—</span>
								)}
							</div>
							<div className="flex items-center gap-1 flex-wrap">
								{(doctor.emrSystems || []).length > 0 ? (
									doctor.emrSystems.map((sys) => (
										<EmrPill key={sys} system={sys} />
									))
								) : (
									<span className="text-n-400 text-[11.5px]">—</span>
								)}
							</div>
							<div className="font-mono text-[11.5px] text-n-600 truncate">
								{doctor.username}
							</div>
							<div className="flex justify-end gap-0.5">
								<button
									onClick={() => handleOpenModal(doctor)}
									className="inline-flex items-center justify-center w-7 h-7 rounded-md text-n-500 hover:text-n-900 hover:bg-n-100 transition"
									title="Edit"
								>
									<Pencil className="w-3.5 h-3.5" />
								</button>
								<button
									onClick={() => handleDelete(doctor.id)}
									className="inline-flex items-center justify-center w-7 h-7 rounded-md text-n-500 hover:text-[var(--dnr-fg)] hover:bg-[var(--dnr-bg)] transition"
									title="Delete"
								>
									<Trash2 className="w-3.5 h-3.5" />
								</button>
							</div>
						</div>
					))
				)}
			</div>

			<Modal
				isOpen={isModalOpen}
				onClose={handleCloseModal}
				title={editingDoctor ? "Edit doctor" : "Add doctor"}
			>
				<form onSubmit={handleSubmit} className="space-y-4">
					<div>
						<label className="label-kicker block mb-1.5">Name *</label>
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
						<label className="label-kicker block mb-1.5">Username *</label>
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
						<label className="label-kicker block mb-1.5">
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
					</div>
					<div>
						<label className="label-kicker block mb-1.5">Specialty</label>
						<input
							type="text"
							value={formData.specialty}
							onChange={(e) =>
								setFormData({ ...formData, specialty: e.target.value })
							}
							className="input-field"
							placeholder="Podiatry, vascular, internal medicine…"
						/>
					</div>

					<div>
						<label className="label-kicker block mb-2">
							EMR systems access
						</label>
						<div className="grid grid-cols-1 gap-1.5">
							{ALL_EMR_SYSTEMS.map((system) => {
								const isSelected = (formData.emrSystems || []).includes(
									system,
								);
								const meta = EMR_META[system];
								return (
									<button
										key={system}
										type="button"
										onClick={() => toggleEmrSystem(system)}
										className={cls(
											"flex items-center gap-3 px-3 h-11 rounded-md border transition",
											isSelected
												? "border-p-500 bg-p-50"
												: "border-n-200 hover:bg-n-50",
										)}
									>
										<span
											className="w-2 h-2 rounded-full shrink-0"
											style={{ background: meta.hue }}
										/>
										<span className="flex-1 text-left text-[13px] font-medium text-n-900">
											{meta.label}
										</span>
										<span
											className={cls(
												"w-4 h-4 rounded-sm border flex items-center justify-center transition",
												isSelected
													? "bg-p-600 border-p-600"
													: "border-n-300",
											)}
										>
											{isSelected && (
												<Check className="w-2.5 h-2.5 text-white" />
											)}
										</span>
									</button>
								);
							})}
						</div>
						<p className="text-[10.5px] font-mono text-n-500 mt-2 leading-relaxed">
							Credentials are configured separately for systems that require
							them.
						</p>
					</div>

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
							) : editingDoctor ? (
								"Update"
							) : (
								"Create"
							)}
						</Button>
					</div>
				</form>
			</Modal>

			<Modal
				isOpen={isNotifyModalOpen}
				onClose={() => setIsNotifyModalOpen(false)}
				title={
					selectedDoctorIds.size > 0
						? `Send notification · ${selectedDoctorIds.size}`
						: "Send notification to all"
				}
			>
				<form onSubmit={handleSendNotification} className="space-y-4">
					{selectedDoctorIds.size > 0 ? (
						<div className="border border-n-150 rounded-md p-3 bg-n-50">
							<div className="label-kicker mb-2">Recipients</div>
							<div className="flex flex-wrap gap-1.5">
								{doctors
									.filter((d) => selectedDoctorIds.has(d.id))
									.map((d) => (
										<Chip key={d.id} tone="primary">
											{d.name}
										</Chip>
									))}
							</div>
						</div>
					) : (
						<div className="border border-n-150 rounded-md p-3 bg-[var(--warn-bg)]/30">
							<p className="text-[12.5px] text-[var(--warn-fg)]">
								No doctors selected — this will send to{" "}
								<strong>all doctors</strong> with active push tokens.
							</p>
						</div>
					)}

					<div>
						<label className="label-kicker block mb-1.5">Title *</label>
						<input
							type="text"
							value={notifyTitle}
							onChange={(e) => setNotifyTitle(e.target.value)}
							className="input-field"
							placeholder="e.g. System update"
							required
							maxLength={100}
						/>
					</div>
					<div>
						<label className="label-kicker block mb-1.5">Message *</label>
						<textarea
							value={notifyBody}
							onChange={(e) => setNotifyBody(e.target.value)}
							className="input-field min-h-[80px] py-2 resize-y"
							placeholder="A new version of the app is available. Please update."
							required
							maxLength={500}
							rows={3}
						/>
						<p className="text-[10.5px] font-mono text-n-500 mt-1 text-right">
							{notifyBody.length}/500
						</p>
					</div>

					{notifyResult && (
						<div
							className={cls(
								"flex items-center gap-2 px-3 py-2.5 rounded-md text-[12.5px] font-medium",
								notifyResult.success
									? "bg-[var(--ok-bg)] text-[var(--ok-fg)]"
									: "bg-[var(--dnr-bg)] text-[var(--dnr-fg)]",
							)}
						>
							{notifyResult.success && <Check className="w-4 h-4 shrink-0" />}
							<span>{notifyResult.message}</span>
						</div>
					)}

					<div className="flex gap-2 pt-2">
						<Button
							type="button"
							tone="ghost"
							size="md"
							onClick={() => setIsNotifyModalOpen(false)}
							className="flex-1"
						>
							Cancel
						</Button>
						<Button
							type="submit"
							tone="primary"
							size="md"
							disabled={isSendingNotification || notifyResult?.success === true}
							className="flex-1"
						>
							{isSendingNotification ? (
								<>
									<Loader2 className="w-4 h-4 animate-spin" />
									<span>Sending…</span>
								</>
							) : (
								<>
									<Send className="w-4 h-4" />
									<span>Send</span>
								</>
							)}
						</Button>
					</div>
				</form>
			</Modal>
		</div>
	);
}
