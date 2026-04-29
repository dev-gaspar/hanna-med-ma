import { useEffect, useState } from "react";
import { Plus, Pencil, EyeOff, Loader2, MapPin, Eye } from "lucide-react";
import {
	placeOfServiceService,
	type PlaceOfServiceCode,
	type CreatePlaceOfServiceCodeInput,
} from "../services/placeOfServiceService";
import Modal from "../components/Modal";
import { Button } from "../components/ui/Button";
import { Chip } from "../components/ui/Chip";

/**
 * CMS Place-of-Service code catalog. Sourced from the
 * official CMS POS code set (loaded by the seed script). The
 * admin UI lets you add ad-hoc codes, fix typos in name/shortLabel/
 * description, and deactivate retired codes — without rebuilding
 * the project.
 */
export default function PlaceOfService() {
	const [rows, setRows] = useState<PlaceOfServiceCode[]>([]);
	const [loading, setLoading] = useState(true);
	const [showInactive, setShowInactive] = useState(true);
	const [isModalOpen, setIsModalOpen] = useState(false);
	const [editing, setEditing] = useState<PlaceOfServiceCode | null>(null);
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [form, setForm] = useState<CreatePlaceOfServiceCodeInput>({
		code: "",
		name: "",
		shortLabel: "",
		description: "",
		active: true,
	});

	useEffect(() => {
		fetchAll();
	}, [showInactive]);

	const fetchAll = async () => {
		try {
			setLoading(true);
			const data = await placeOfServiceService.getAll({
				includeInactive: showInactive,
			});
			setRows(data);
		} catch (e) {
			console.error("Error fetching POS codes:", e);
		} finally {
			setLoading(false);
		}
	};

	const openCreate = () => {
		setEditing(null);
		setForm({
			code: "",
			name: "",
			shortLabel: "",
			description: "",
			active: true,
		});
		setError(null);
		setIsModalOpen(true);
	};

	const openEdit = (row: PlaceOfServiceCode) => {
		setEditing(row);
		setForm({
			code: row.code,
			name: row.name,
			shortLabel: row.shortLabel,
			description: row.description,
			active: row.active,
		});
		setError(null);
		setIsModalOpen(true);
	};

	const closeModal = () => {
		setIsModalOpen(false);
		setEditing(null);
		setError(null);
	};

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setSubmitting(true);
		setError(null);
		try {
			if (editing) {
				await placeOfServiceService.update(editing.code, {
					name: form.name,
					shortLabel: form.shortLabel,
					description: form.description,
					active: form.active,
				});
			} else {
				await placeOfServiceService.create(form);
			}
			await fetchAll();
			closeModal();
		} catch (e: unknown) {
			const err = e as {
				response?: { data?: { message?: string | string[] } };
			};
			const msg = err.response?.data?.message;
			setError(
				Array.isArray(msg) ? msg.join(", ") : msg || "Failed to save",
			);
		} finally {
			setSubmitting(false);
		}
	};

	const handleDeactivate = async (row: PlaceOfServiceCode) => {
		if (!row.active) return;
		const confirmMsg = `Deactivate POS code ${row.code} (${row.name})? Specialties referencing it must be updated first.`;
		if (!window.confirm(confirmMsg)) return;
		try {
			await placeOfServiceService.deactivate(row.code);
			await fetchAll();
		} catch (e: unknown) {
			const err = e as {
				response?: { data?: { message?: string | string[] } };
			};
			const msg = err.response?.data?.message;
			alert(Array.isArray(msg) ? msg.join(", ") : msg || "Failed to deactivate");
		}
	};

	const handleReactivate = async (row: PlaceOfServiceCode) => {
		if (row.active) return;
		try {
			await placeOfServiceService.update(row.code, { active: true });
			await fetchAll();
		} catch (e) {
			console.error("Error reactivating POS code:", e);
		}
	};

	return (
		<div className="max-w-5xl">
			<div className="flex items-end justify-between gap-4 pb-4 mb-5 border-b border-n-150">
				<div>
					<div className="label-kicker mb-1.5">Administration</div>
					<div className="flex items-center gap-3">
						<h1 className="font-serif text-[24px] text-n-900 leading-tight">
							Place of Service
						</h1>
						<Chip>{rows.length}</Chip>
					</div>
					<p className="text-[12.5px] text-n-500 mt-1.5">
						CMS POS code catalog. Sourced from cms.gov; reload via{" "}
						<code className="font-mono">load-place-of-service-codes.ts</code>{" "}
						when CMS updates the official list. Each Specialty's{" "}
						<code className="font-mono">commonPosCodes</code> picks a subset
						from this catalog to render as quick-pick buttons in the
						encounter modal.
					</p>
				</div>
				<div className="flex gap-2">
					<Button
						tone="ghost"
						size="sm"
						onClick={() => setShowInactive((v) => !v)}
						leading={
							showInactive ? (
								<Eye className="w-3.5 h-3.5" />
							) : (
								<EyeOff className="w-3.5 h-3.5" />
							)
						}
					>
						{showInactive ? "Hide inactive" : "Show all"}
					</Button>
					<Button
						tone="primary"
						size="sm"
						onClick={openCreate}
						leading={<Plus className="w-3.5 h-3.5" />}
					>
						Add code
					</Button>
				</div>
			</div>

			<div className="border border-n-150 rounded-lg bg-n-0 overflow-hidden">
				<div className="grid grid-cols-[80px_1fr_120px_90px_90px] px-4 h-10 border-b border-n-150 bg-n-50 items-center">
					<div className="label-kicker">Code</div>
					<div className="label-kicker">Name</div>
					<div className="label-kicker">Short label</div>
					<div className="label-kicker">Status</div>
					<div className="label-kicker text-right">Actions</div>
				</div>

				{loading ? (
					<div className="flex items-center justify-center gap-2 py-10 text-n-500">
						<Loader2 className="w-4 h-4 animate-spin" />
						<span className="font-mono text-[11px] uppercase tracking-widest">
							Loading
						</span>
					</div>
				) : rows.length === 0 ? (
					<div className="py-10 text-center font-mono text-[11.5px] text-n-500">
						No POS codes yet — run{" "}
						<code>load-place-of-service-codes.ts</code> to seed the catalog.
					</div>
				) : (
					rows.map((row) => (
						<div
							key={row.code}
							className="grid grid-cols-[80px_1fr_120px_90px_90px] px-4 py-3 border-b border-n-150 last:border-0 items-center hover:bg-n-50 transition"
						>
							<div className="flex items-center gap-2">
								<div className="w-7 h-7 rounded-md bg-p-100 text-p-700 dark:text-white grid place-items-center">
									<MapPin className="w-3 h-3" />
								</div>
								<div className="font-mono text-[12px] text-n-900">
									{row.code}
								</div>
							</div>
							<div className="min-w-0">
								<div className="text-[13px] text-n-900 truncate">
									{row.name}
								</div>
								<div className="font-mono text-[10.5px] text-n-500 truncate">
									{row.description.length > 90
										? row.description.slice(0, 90) + "…"
										: row.description}
								</div>
							</div>
							<div className="font-mono text-[11.5px] text-n-700 truncate">
								{row.shortLabel}
							</div>
							<div>
								{row.active ? (
									<Chip tone="ok">active</Chip>
								) : (
									<Chip tone="warn">inactive</Chip>
								)}
							</div>
							<div className="flex justify-end gap-0.5">
								<button
									onClick={() => openEdit(row)}
									className="inline-flex items-center justify-center w-7 h-7 rounded-md text-n-500 hover:text-n-900 hover:bg-n-100 transition"
									title="Edit"
								>
									<Pencil className="w-3.5 h-3.5" />
								</button>
								{row.active ? (
									<button
										onClick={() => handleDeactivate(row)}
										className="inline-flex items-center justify-center w-7 h-7 rounded-md text-n-500 hover:text-[var(--dnr-fg)] hover:bg-[var(--dnr-bg)] transition"
										title="Deactivate"
									>
										<EyeOff className="w-3.5 h-3.5" />
									</button>
								) : (
									<button
										onClick={() => handleReactivate(row)}
										className="inline-flex items-center justify-center w-7 h-7 rounded-md text-n-500 hover:text-p-700 hover:bg-p-50 transition"
										title="Reactivate"
									>
										<Eye className="w-3.5 h-3.5" />
									</button>
								)}
							</div>
						</div>
					))
				)}
			</div>

			<Modal
				isOpen={isModalOpen}
				onClose={closeModal}
				title={editing ? `Edit POS code ${editing.code}` : "Add POS code"}
			>
				<form onSubmit={handleSubmit} className="space-y-4">
					<div className="grid grid-cols-2 gap-3">
						<div>
							<label className="label-kicker block mb-1.5">Code</label>
							<input
								type="text"
								value={form.code}
								onChange={(e) =>
									setForm({ ...form, code: e.target.value })
								}
								placeholder="e.g. 11"
								className="input-field font-mono"
								maxLength={2}
								disabled={!!editing}
								required
							/>
							<div className="font-mono text-[10.5px] text-n-500 mt-1.5">
								Two-digit CMS POS code. Cannot be changed after create.
							</div>
						</div>
						<div>
							<label className="label-kicker block mb-1.5">
								Short label
							</label>
							<input
								type="text"
								value={form.shortLabel}
								onChange={(e) =>
									setForm({ ...form, shortLabel: e.target.value })
								}
								placeholder="Office"
								className="input-field"
								maxLength={20}
								required
							/>
							<div className="font-mono text-[10.5px] text-n-500 mt-1.5">
								Keep ≤14 chars so the modal button stays compact.
							</div>
						</div>
					</div>

					<div>
						<label className="label-kicker block mb-1.5">Name</label>
						<input
							type="text"
							value={form.name}
							onChange={(e) => setForm({ ...form, name: e.target.value })}
							placeholder="Office"
							className="input-field"
							required
						/>
						<div className="font-mono text-[10.5px] text-n-500 mt-1.5">
							Canonical name as published by CMS — used on claims and audit
							trails.
						</div>
					</div>

					<div>
						<label className="label-kicker block mb-1.5">Description</label>
						<textarea
							value={form.description}
							onChange={(e) =>
								setForm({ ...form, description: e.target.value })
							}
							rows={4}
							placeholder="Location, other than a hospital, where the health professional routinely provides…"
							className="input-field text-[12.5px] leading-[1.55]"
							required
						/>
					</div>

					<div className="flex items-center gap-2">
						<input
							type="checkbox"
							id="pos-active"
							checked={form.active ?? true}
							onChange={(e) =>
								setForm({ ...form, active: e.target.checked })
							}
							className="rounded border-n-300"
						/>
						<label
							htmlFor="pos-active"
							className="text-[13px] text-n-700 select-none"
						>
							Active — appears in the encounter modal's "Other…" list and is
							assignable to a specialty.
						</label>
					</div>

					{error && (
						<div className="px-3 py-2 border border-[var(--dnr-fg)]/30 bg-[var(--dnr-bg)]/40 rounded-md text-[12px] text-[var(--dnr-fg)] font-mono">
							{error}
						</div>
					)}

					<div className="flex gap-2 pt-2">
						<Button
							type="button"
							tone="ghost"
							size="md"
							onClick={closeModal}
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
							) : editing ? (
								"Update"
							) : (
								"Create"
							)}
						</Button>
					</div>
				</form>
			</Modal>
		</div>
	);
}
