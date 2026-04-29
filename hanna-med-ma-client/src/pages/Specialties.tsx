import { useEffect, useMemo, useState } from "react";
import { Plus, Pencil, Trash2, Loader2, Sparkles, Star } from "lucide-react";
import {
	specialtyService,
	type CreateSpecialtyDto,
	type Specialty,
} from "../services/specialtyService";
import {
	placeOfServiceService,
	type PlaceOfServiceCode,
} from "../services/placeOfServiceService";
import Modal from "../components/Modal";
import { Button } from "../components/ui/Button";
import { Chip } from "../components/ui/Chip";
import { cls } from "../lib/cls";

/**
 * Specialty catalog admin. One row per specialty + a Markdown textarea
 * for the prompt delta. The CoderAgent appends this delta to the base
 * coder prompt whenever a doctor on this specialty generates a coding
 * proposal. Empty delta is fine — the agent falls back to the base
 * prompt only.
 */
export default function Specialties() {
	const [rows, setRows] = useState<Specialty[]>([]);
	const [loading, setLoading] = useState(true);
	const [isModalOpen, setIsModalOpen] = useState(false);
	const [editing, setEditing] = useState<Specialty | null>(null);
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [form, setForm] = useState<CreateSpecialtyDto>({
		name: "",
		systemPrompt: "",
		commonPosCodes: [],
		defaultPosCode: null,
	});
	const [posCatalog, setPosCatalog] = useState<PlaceOfServiceCode[]>([]);

	useEffect(() => {
		fetchAll();
		fetchPosCatalog();
	}, []);

	const fetchAll = async () => {
		try {
			const data = await specialtyService.getAll();
			setRows(data);
		} catch (e) {
			console.error("Error fetching specialties:", e);
		} finally {
			setLoading(false);
		}
	};

	const fetchPosCatalog = async () => {
		try {
			// Show ALL codes (active + inactive) so admin can see why an
			// inactive code disappeared from a specialty's quick-picks.
			const data = await placeOfServiceService.getAll({
				includeInactive: true,
			});
			setPosCatalog(data);
		} catch (e) {
			console.error("Error fetching POS catalog:", e);
		}
	};

	const openCreate = () => {
		setEditing(null);
		setForm({
			name: "",
			systemPrompt: "",
			commonPosCodes: [],
			defaultPosCode: null,
		});
		setError(null);
		setIsModalOpen(true);
	};

	const openEdit = (row: Specialty) => {
		setEditing(row);
		setForm({
			name: row.name,
			systemPrompt: row.systemPrompt,
			commonPosCodes: row.commonPosCodes,
			defaultPosCode: row.defaultPosCode,
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
				await specialtyService.update(editing.id, form);
			} else {
				await specialtyService.create(form);
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

	const handleDelete = async (row: Specialty) => {
		const linked = row._count?.doctors ?? 0;
		const warn =
			linked > 0
				? `Delete "${row.name}"? ${linked} doctor(s) will lose their specialty link.`
				: `Delete "${row.name}"?`;
		if (!window.confirm(warn)) return;
		try {
			await specialtyService.delete(row.id);
			await fetchAll();
		} catch (e) {
			console.error("Error deleting specialty:", e);
		}
	};

	return (
		<div className="max-w-5xl">
			<div className="flex items-end justify-between gap-4 pb-4 mb-5 border-b border-n-150">
				<div>
					<div className="label-kicker mb-1.5">Administration</div>
					<div className="flex items-center gap-3">
						<h1 className="font-serif text-[24px] text-n-900 leading-tight">
							Specialties
						</h1>
						<Chip>{rows.length}</Chip>
					</div>
					<p className="text-[12.5px] text-n-500 mt-1.5">
						Each specialty carries a prompt delta the AI Coder appends
						after its base prompt for doctors in that specialty.
					</p>
				</div>
				<Button
					tone="primary"
					size="sm"
					onClick={openCreate}
					leading={<Plus className="w-3.5 h-3.5" />}
				>
					Add specialty
				</Button>
			</div>

			<div className="border border-n-150 rounded-lg bg-n-0 overflow-hidden">
				<div className="grid grid-cols-[1fr_110px_90px_110px_80px] px-4 h-10 border-b border-n-150 bg-n-50 items-center">
					<div className="label-kicker">Specialty</div>
					<div className="label-kicker">Prompt</div>
					<div className="label-kicker">Doctors</div>
					<div className="label-kicker">Updated</div>
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
						No specialties yet.
					</div>
				) : (
					rows.map((row) => {
						const chars = row.systemPrompt?.length ?? 0;
						return (
							<div
								key={row.id}
								className="grid grid-cols-[1fr_110px_90px_110px_80px] px-4 py-3 border-b border-n-150 last:border-0 items-center hover:bg-n-50 transition"
							>
								<div className="flex items-center gap-3 min-w-0">
									<div className="w-8 h-8 rounded-md bg-p-100 text-p-700 dark:text-white grid place-items-center">
										<Sparkles className="w-3.5 h-3.5" />
									</div>
									<div className="min-w-0">
										<div className="text-[13.5px] font-medium text-n-900 truncate">
											{row.name}
										</div>
										<div className="font-mono text-[10.5px] text-n-500 truncate">
											#{row.id}
										</div>
									</div>
								</div>
								<div>
									{chars > 0 ? (
										<Chip tone="ok">{chars} chars</Chip>
									) : (
										<Chip tone="warn">empty</Chip>
									)}
								</div>
								<div className="font-mono text-[11.5px] text-n-600">
									{row._count?.doctors ?? 0}
								</div>
								<div className="font-mono text-[10.5px] text-n-500">
									{new Date(row.updatedAt).toLocaleDateString()}
								</div>
								<div className="flex justify-end gap-0.5">
									<button
										onClick={() => openEdit(row)}
										className="inline-flex items-center justify-center w-7 h-7 rounded-md text-n-500 hover:text-n-900 hover:bg-n-100 transition"
										title="Edit"
									>
										<Pencil className="w-3.5 h-3.5" />
									</button>
									<button
										onClick={() => handleDelete(row)}
										className="inline-flex items-center justify-center w-7 h-7 rounded-md text-n-500 hover:text-[var(--dnr-fg)] hover:bg-[var(--dnr-bg)] transition"
										title="Delete"
									>
										<Trash2 className="w-3.5 h-3.5" />
									</button>
								</div>
							</div>
						);
					})
				)}
			</div>

			<Modal
				isOpen={isModalOpen}
				onClose={closeModal}
				title={editing ? "Edit specialty" : "Add specialty"}
				size="lg"
			>
				<form onSubmit={handleSubmit} className="space-y-4">
					<div>
						<label className="label-kicker block mb-1.5">Name</label>
						<input
							type="text"
							value={form.name}
							onChange={(e) => setForm({ ...form, name: e.target.value })}
							placeholder="e.g. Podiatry"
							className="input-field"
							required
						/>
						{editing && (
							<div className="font-mono text-[10.5px] text-n-500 mt-1.5">
								Renaming will also update the legacy{" "}
								<code>doctor.specialty</code> string of every linked doctor.
							</div>
						)}
					</div>

					<div>
						<label className="label-kicker block mb-1.5">
							Prompt delta{" "}
							<span className="normal-case tracking-normal font-sans text-n-400">
								· Markdown, appended after the base coder prompt
							</span>
						</label>
						<textarea
							value={form.systemPrompt}
							onChange={(e) =>
								setForm({ ...form, systemPrompt: e.target.value })
							}
							rows={16}
							placeholder={`Specialty delta — PODIATRY\n\nExam scope: ...\n\nCode preferences the note often justifies:\n  ...`}
							className="input-field font-mono text-[12px] leading-[1.55]"
						/>
						<div className="font-mono text-[10.5px] text-n-500 mt-1.5">
							{form.systemPrompt?.length ?? 0} chars
						</div>
					</div>

					<SpecialtyPosConfig
						posCatalog={posCatalog}
						commonPosCodes={form.commonPosCodes ?? []}
						defaultPosCode={form.defaultPosCode ?? null}
						onChangeCommon={(codes) =>
							setForm((f) => ({
								...f,
								commonPosCodes: codes,
								// If the current default is no longer in the list,
								// drop it — backend would reject the save anyway.
								defaultPosCode:
									f.defaultPosCode && codes.includes(f.defaultPosCode)
										? f.defaultPosCode
										: null,
							}))
						}
						onChangeDefault={(code) =>
							setForm((f) => ({ ...f, defaultPosCode: code }))
						}
					/>

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

/**
 * Per-specialty POS config — checkboxes pick which POS codes appear
 * as quick-pick buttons in the encounter modal, and a radio inside
 * the same list selects which one is pre-filled. Both fields write
 * straight into the parent form state via callbacks.
 */
function SpecialtyPosConfig({
	posCatalog,
	commonPosCodes,
	defaultPosCode,
	onChangeCommon,
	onChangeDefault,
}: {
	posCatalog: PlaceOfServiceCode[];
	commonPosCodes: string[];
	defaultPosCode: string | null;
	onChangeCommon: (codes: string[]) => void;
	onChangeDefault: (code: string | null) => void;
}) {
	// Sort active first, then by numeric code, so the admin sees the
	// usable codes at the top.
	const sorted = useMemo(
		() =>
			posCatalog
				.slice()
				.sort((a, b) => {
					if (a.active !== b.active) return a.active ? -1 : 1;
					return Number(a.code) - Number(b.code);
				}),
		[posCatalog],
	);

	const selected = new Set(commonPosCodes);

	const toggle = (code: string) => {
		if (selected.has(code)) {
			onChangeCommon(commonPosCodes.filter((c) => c !== code));
		} else {
			onChangeCommon([...commonPosCodes, code]);
		}
	};

	return (
		<div>
			<label className="label-kicker block mb-1.5">
				Place of service config{" "}
				<span className="normal-case tracking-normal font-sans text-n-400">
					· Quick-picks shown to doctors of this specialty
				</span>
			</label>
			<div className="border border-n-150 rounded-md max-h-[260px] overflow-y-auto custom-scrollbar">
				{sorted.length === 0 ? (
					<div className="p-4 text-[12px] text-n-500 font-mono">
						POS catalog is empty. Run{" "}
						<code>load-place-of-service-codes.ts</code> first.
					</div>
				) : (
					sorted.map((row) => {
						const checked = selected.has(row.code);
						const isDefault = defaultPosCode === row.code;
						return (
							<div
								key={row.code}
								className={cls(
									"flex items-center gap-2 px-3 py-2 border-b border-n-150 last:border-0 transition",
									!row.active && "opacity-50",
									checked && "bg-p-50/40",
								)}
							>
								<input
									type="checkbox"
									checked={checked}
									onChange={() => toggle(row.code)}
									disabled={!row.active}
									className="rounded border-n-300"
								/>
								<div className="flex-1 min-w-0">
									<div className="text-[12.5px] text-n-900 truncate">
										<span className="font-mono text-n-600">
											{row.code}
										</span>{" "}
										· {row.name}
									</div>
									{!row.active && (
										<div className="font-mono text-[10px] text-[var(--dnr-fg)]">
											inactive
										</div>
									)}
								</div>
								<button
									type="button"
									onClick={() =>
										onChangeDefault(isDefault ? null : row.code)
									}
									disabled={!checked}
									className={cls(
										"inline-flex items-center justify-center w-7 h-7 rounded-md transition",
										!checked && "opacity-30 cursor-not-allowed",
										isDefault
											? "text-p-700 bg-p-100"
											: "text-n-400 hover:text-n-700 hover:bg-n-100",
									)}
									title={
										isDefault
											? "Pre-filled when modal opens — click again to clear"
											: "Mark as default (pre-filled when modal opens)"
									}
								>
									<Star
										className={cls(
											"w-3.5 h-3.5",
											isDefault && "fill-current",
										)}
									/>
								</button>
							</div>
						);
					})
				)}
			</div>
			<div className="font-mono text-[10.5px] text-n-500 mt-1.5">
				{commonPosCodes.length} quick-picks
				{defaultPosCode
					? ` · default: ${defaultPosCode}`
					: " · no default (doctor must pick)"}
			</div>
		</div>
	);
}
