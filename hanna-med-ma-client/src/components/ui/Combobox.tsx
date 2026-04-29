import { Command } from "cmdk";
import { Check, ChevronsUpDown, Search, X } from "lucide-react";
import {
	useEffect,
	useId,
	useRef,
	useState,
	type ReactNode,
} from "react";
import { cls } from "../../lib/cls";

interface ComboboxOption<T> {
	value: string;
	label: string;
	description?: string;
	keywords?: string[];
	disabled?: boolean;
	raw: T;
}

export interface ComboboxProps<T> {
	value: string;
	onChange: (value: string, option: T) => void;
	options: ComboboxOption<T>[];
	/** Placeholder shown when nothing is selected. */
	placeholder?: string;
	/** Placeholder for the search input inside the dropdown. */
	searchPlaceholder?: string;
	/** Empty-state copy when search returns nothing. */
	emptyMessage?: string;
	disabled?: boolean;
	/** Optional render override for the trigger label. Receives the
	 *  option that matches `value` (or undefined if none does). */
	renderTriggerLabel?: (selected: ComboboxOption<T> | undefined) => ReactNode;
	/** Allow clearing the selection. Renders an "X" inside the trigger. */
	clearable?: boolean;
	className?: string;
}

/**
 * Accessible combobox with search, built on top of `cmdk`. The
 * dropdown opens below the trigger, supports keyboard navigation
 * (↑↓, Enter, Esc), filters options by typing, and renders each
 * row with an optional description line below the label.
 *
 * Styling is intentionally inline-Tailwind so the component matches
 * the rest of the site's design tokens (n-* and p-*) and the
 * `input-field` look-and-feel without pulling in another CSS file.
 */
export function Combobox<T>({
	value,
	onChange,
	options,
	placeholder = "Select…",
	searchPlaceholder = "Search…",
	emptyMessage = "Nothing found.",
	disabled,
	renderTriggerLabel,
	clearable,
	className,
}: ComboboxProps<T>) {
	const [open, setOpen] = useState(false);
	const [search, setSearch] = useState("");
	const wrapperRef = useRef<HTMLDivElement>(null);
	const inputId = useId();

	const selected = options.find((o) => o.value === value);

	// Close on click-outside.
	useEffect(() => {
		if (!open) return;
		const onDown = (e: MouseEvent) => {
			if (!wrapperRef.current) return;
			if (!wrapperRef.current.contains(e.target as Node)) {
				setOpen(false);
			}
		};
		document.addEventListener("mousedown", onDown);
		return () => document.removeEventListener("mousedown", onDown);
	}, [open]);

	// Reset search when the dropdown closes.
	useEffect(() => {
		if (!open) setSearch("");
	}, [open]);

	const handleSelect = (option: ComboboxOption<T>) => {
		if (option.disabled) return;
		onChange(option.value, option.raw);
		setOpen(false);
	};

	const handleClear = (e: React.MouseEvent) => {
		e.stopPropagation();
		// Use a sentinel — caller decides how to map "" to its model.
		onChange("", undefined as unknown as T);
	};

	return (
		<div
			ref={wrapperRef}
			className={cls("relative", className)}
		>
			<button
				type="button"
				disabled={disabled}
				onClick={() => setOpen((v) => !v)}
				aria-haspopup="listbox"
				aria-expanded={open}
				aria-controls={open ? `${inputId}-listbox` : undefined}
				className={cls(
					"input-field flex items-center justify-between gap-2 text-left cursor-default",
					"hover:border-n-300",
					open && "border-p-500 ring-2 ring-p-500/20",
					disabled && "opacity-50 cursor-not-allowed",
				)}
			>
				<span
					className={cls(
						"flex-1 min-w-0 truncate",
						!selected && "text-n-400",
					)}
				>
					{renderTriggerLabel
						? renderTriggerLabel(selected)
						: selected
							? selected.label
							: placeholder}
				</span>
				<span className="flex items-center gap-1 shrink-0">
					{clearable && selected ? (
						<span
							role="button"
							tabIndex={-1}
							onClick={handleClear}
							className="inline-flex items-center justify-center w-5 h-5 rounded text-n-500 hover:text-n-900 hover:bg-n-100 transition"
							aria-label="Clear selection"
						>
							<X className="w-3 h-3" />
						</span>
					) : null}
					<ChevronsUpDown
						className={cls(
							"w-3.5 h-3.5 shrink-0 transition-colors",
							open ? "text-p-600" : "text-n-400",
						)}
					/>
				</span>
			</button>

			{open ? (
				<div
					className="absolute z-50 mt-1.5 w-full rounded-md border border-n-200 bg-n-0 shadow-deep overflow-hidden"
					role="dialog"
				>
					<Command
						label={placeholder}
						shouldFilter
						className="flex flex-col"
					>
						<div className="flex items-center gap-2 px-3 h-10 border-b border-n-150 bg-n-50">
							<Search className="w-3.5 h-3.5 text-n-500 shrink-0" />
							<Command.Input
								autoFocus
								value={search}
								onValueChange={setSearch}
								placeholder={searchPlaceholder}
								className="flex-1 bg-transparent outline-none text-[13px] text-n-900 placeholder:text-n-400"
							/>
							{search ? (
								<button
									type="button"
									onClick={() => setSearch("")}
									className="inline-flex items-center justify-center w-5 h-5 rounded text-n-500 hover:text-n-900 hover:bg-n-100 transition"
									aria-label="Clear search"
								>
									<X className="w-3 h-3" />
								</button>
							) : null}
						</div>
						<Command.List
							id={`${inputId}-listbox`}
							className="max-h-[280px] overflow-y-auto custom-scrollbar p-1"
						>
							<Command.Empty className="px-3 py-6 text-center text-[12px] text-n-500 font-mono">
								{emptyMessage}
							</Command.Empty>
							{options.map((option) => {
								const isSelected = option.value === value;
								// Build a single search keyword string so cmdk's
								// fuzzy match indexes the description too — letting
								// the doctor type "office" or "11" or "ambulatory"
								// and find POS 24, etc.
								const keywords = [
									option.label,
									...(option.keywords ?? []),
									option.description ?? "",
								];
								return (
									<Command.Item
										key={option.value}
										value={option.value}
										keywords={keywords}
										disabled={option.disabled}
										onSelect={() => handleSelect(option)}
										className={cls(
											"flex items-start gap-2.5 px-2.5 py-2 rounded-md cursor-pointer transition-colors",
											"data-[selected=true]:bg-p-50 data-[selected=true]:text-p-700",
											"aria-selected:bg-p-50 aria-selected:text-p-700",
											"hover:bg-n-100",
											option.disabled && "opacity-40 cursor-not-allowed",
											isSelected && "bg-p-50/60",
										)}
									>
										<div className="flex-1 min-w-0">
											<div className="text-[13px] font-medium text-n-900 truncate">
												{option.label}
											</div>
											{option.description ? (
												<div className="text-[11.5px] text-n-500 leading-snug mt-0.5 line-clamp-2">
													{option.description}
												</div>
											) : null}
										</div>
										<Check
											className={cls(
												"w-3.5 h-3.5 shrink-0 mt-0.5 transition-opacity",
												isSelected
													? "text-p-700 opacity-100"
													: "opacity-0",
											)}
										/>
									</Command.Item>
								);
							})}
						</Command.List>
					</Command>
				</div>
			) : null}
		</div>
	);
}
