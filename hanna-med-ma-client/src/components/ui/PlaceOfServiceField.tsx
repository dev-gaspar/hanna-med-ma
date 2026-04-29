import { useMemo } from "react";
import { cls } from "../../lib/cls";
import type { PlaceOfServiceCode } from "../../services/placeOfServiceService";
import { Combobox } from "./Combobox";

interface PlaceOfServiceFieldProps {
	/** Currently selected POS code (the row's `code` column). Empty
	 *  string means "no selection yet" — the caller decides whether
	 *  that's allowed. */
	value: string;
	onChange: (code: string) => void;
	/** Full active catalog from `/place-of-service-codes`. */
	catalog: PlaceOfServiceCode[];
	/** Codes to render as quick-pick buttons, in render order.
	 *  Comes from the doctor's specialty config; if empty, no
	 *  shortcuts are shown and the doctor must pick from the
	 *  full select. */
	quickPickCodes: string[];
}

/**
 * "Place of service" field for the encounter modal. Renders the
 * specialty's common POS codes as quick-pick buttons (with a "more"
 * select for everything else in the catalog). Both data sources
 * are dynamic — the catalog comes from the place_of_service_codes
 * table, and which codes count as "common" comes from the
 * Specialty.commonPosCodes column. Nothing about this list is
 * hardcoded in JSX.
 */
export function PlaceOfServiceField({
	value,
	onChange,
	catalog,
	quickPickCodes,
}: PlaceOfServiceFieldProps) {
	const byCode = useMemo(() => {
		const map = new Map<string, PlaceOfServiceCode>();
		for (const row of catalog) map.set(row.code, row);
		return map;
	}, [catalog]);

	const quickPicks = useMemo(
		() =>
			quickPickCodes
				.map((c) => byCode.get(c))
				.filter((row): row is PlaceOfServiceCode => Boolean(row)),
		[quickPickCodes, byCode],
	);

	// Combobox options: the FULL catalog sorted by numeric code,
	// each with a description that gets rendered below the name and
	// indexed for fuzzy search. cmdk lets the doctor type "ER" or
	// "23" or "ambulatory" and find the right row.
	const comboboxOptions = useMemo(
		() =>
			catalog
				.slice()
				.sort((a, b) => Number(a.code) - Number(b.code))
				.map((row) => ({
					value: row.code,
					label: `${row.code} · ${row.name}`,
					description: row.description,
					keywords: [row.shortLabel, row.name, row.code],
					raw: row,
				})),
		[catalog],
	);

	const valueIsQuickPick = quickPickCodes.includes(value);
	const valueRow = byCode.get(value);

	return (
		<div>
			<label className="label-kicker block mb-1.5">Place of service</label>

			{quickPicks.length > 0 ? (
				<div className="grid grid-cols-3 gap-2">
					{quickPicks.map((row) => {
						const selected = value === row.code;
						return (
							<button
								key={row.code}
								type="button"
								onClick={() => onChange(row.code)}
								className={cls(
									"h-12 rounded-md border text-[13px] font-medium transition flex flex-col items-center justify-center leading-tight px-2",
									selected
										? "border-p-500 bg-p-50 text-p-700"
										: "border-n-200 text-n-700 hover:bg-n-100",
								)}
								title={row.name}
							>
								<span className="truncate max-w-full">{row.shortLabel}</span>
								<span className="font-mono text-[10.5px] opacity-70 mt-0.5">
									{row.code}
								</span>
							</button>
						);
					})}
				</div>
			) : null}

			{/*
			 * Searchable full catalog. Always rendered so a code that
			 * isn't a quick-pick is one search away — no "click Other to
			 * reveal" affordance to discover. When the current selection
			 * IS a quick-pick the trigger reads "More options…" so it's
			 * obvious the click expands the list, not changes the value.
			 */}
			{catalog.length > 0 ? (
				<div className="mt-2">
					<Combobox
						value={valueIsQuickPick ? "" : value}
						onChange={(next) => {
							if (next) onChange(next);
						}}
						options={comboboxOptions}
						placeholder={
							valueIsQuickPick
								? "More options… (search by code, name, or description)"
								: valueRow
									? `${valueRow.code} · ${valueRow.name}`
									: "Search all places of service…"
						}
						searchPlaceholder="Search code, name, or description…"
						emptyMessage="No matching place of service."
					/>
				</div>
			) : null}

			<p className="mt-2 text-[10.5px] text-n-500 leading-tight">
				{value
					? valueRow
						? `Selected: ${valueRow.code} — ${valueRow.name}. Change it if the visit happened somewhere different.`
						: `Selected code "${value}" is not in the catalog. Pick another.`
					: "Pick where this visit took place — drives the billing fee schedule."}
			</p>
		</div>
	);
}
