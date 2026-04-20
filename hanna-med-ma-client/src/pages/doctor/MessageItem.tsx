import type { Message } from "../../types/chat";
import { Copy, Check, RotateCcw, Pencil } from "lucide-react";
import { memo, useMemo, useRef, useCallback, useState } from "react";
import { PatientListMessage, formatFullListText } from "./PatientListMessage";
import { parseWhatsAppFormat } from "../../lib/chatUtils";
import { cls } from "../../lib/cls";
import type { SelectedItem } from "./DoctorChat";

interface MessageItemProps {
	message: Message;
	selectedId?: string | number;
	onSelect: (item: SelectedItem | null) => void;
	onAction?: (
		action: "summary" | "insurance" | "lab",
		patientName: string,
	) => void;
	onMarkSeen?: (patientId: number) => void;
	markingLoading?: Set<number>;
	isLastAssistant?: boolean;
	onRegenerate?: () => void;
	isLastUser?: boolean;
	onEditUser?: (id: number, content: string) => void;
}

export const MessageItem = memo(
	({
		message,
		selectedId,
		onSelect,
		onAction,
		onMarkSeen,
		markingLoading,
		isLastAssistant,
		onRegenerate,
		isLastUser,
		onEditUser,
	}: MessageItemProps) => {
		const isAssistant = message.role === "ASSISTANT";
		const isSelected = selectedId === message.id;
		const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

		const formattedContent = useMemo(() => {
			if (message.type === "PATIENT_LIST" && isAssistant) {
				return (
					<PatientListMessage
						content={message.content}
						selection={{ selectedId, onSelect }}
						onAction={onAction}
						onMarkSeen={onMarkSeen}
						markingLoading={markingLoading}
					/>
				);
			}
			return parseWhatsAppFormat(message.content);
		}, [
			message.content,
			message.type,
			isAssistant,
			selectedId,
			onSelect,
			onAction,
			onMarkSeen,
			markingLoading,
		]);

		const startLongPress = useCallback(
			(e: React.TouchEvent) => {
				e.stopPropagation();
				if (longPressTimer.current) clearTimeout(longPressTimer.current);
				longPressTimer.current = setTimeout(() => {
					onSelect({
						type: "message",
						id: message.id,
						content: message.content,
					});
					if ("vibrate" in navigator) navigator.vibrate(50);
				}, 600);
			},
			[message.id, message.content, onSelect],
		);

		const stopLongPress = useCallback(() => {
			if (longPressTimer.current) {
				clearTimeout(longPressTimer.current);
				longPressTimer.current = null;
			}
		}, []);

		const [isCopied, setIsCopied] = useState(false);

		const handleCopy = useCallback(
			(e: React.MouseEvent) => {
				e.stopPropagation();
				let text = message.content;
				if (
					message.type === "PATIENT_LIST" &&
					text.trimStart().startsWith("{")
				) {
					try {
						const parsed = JSON.parse(text.trim());
						if (parsed.sections) {
							text = formatFullListText(parsed);
						}
					} catch {
						/* fallback */
					}
				}
				const fallback = () => {
					const ta = document.createElement("textarea");
					ta.value = text;
					ta.style.cssText = "position:fixed;opacity:0;left:-9999px";
					document.body.appendChild(ta);
					ta.focus();
					ta.select();
					document.execCommand("copy");
					document.body.removeChild(ta);
				};
				if (navigator.clipboard?.writeText) {
					navigator.clipboard.writeText(text).catch(fallback);
				} else {
					fallback();
				}
				setIsCopied(true);
				setTimeout(() => setIsCopied(false), 1500);
			},
			[message.content, message.type],
		);

		const iconBtn =
			"inline-flex items-center justify-center w-6 h-6 rounded-md text-n-500 hover:text-n-900 hover:bg-n-100 transition";

		if (!isAssistant) {
			const canEdit = isLastUser && !!onEditUser;

			return (
				<div className="flex justify-end items-start gap-1.5 group/user">
					{canEdit && (
						<button
							onClick={(e) => {
								e.stopPropagation();
								onEditUser?.(message.id, message.content);
							}}
							className={cls(
								"mt-1.5",
								iconBtn,
								"opacity-100 md:opacity-0 md:group-hover/user:opacity-100",
							)}
							aria-label="Edit message"
						>
							<Pencil className="w-3.5 h-3.5" />
						</button>
					)}

					<div
						onTouchStart={startLongPress}
						onTouchEnd={stopLongPress}
						onTouchMove={stopLongPress}
						className={cls(
							"max-w-[82%] sm:max-w-[72%] bg-p-50 border border-p-200 text-n-900 rounded-lg rounded-tr-[4px] px-3.5 py-2.5 select-none md:select-text transition",
							isSelected && "ring-2 ring-p-500 ring-offset-2 ring-offset-n-0",
						)}
					>
						<div className="text-[13px] leading-relaxed">
							{formattedContent}
						</div>
					</div>
				</div>
			);
		}

		return (
			<div className="relative group/msg max-w-[92%]">
				<div className="font-mono text-[10px] uppercase tracking-widest text-n-500 mb-1.5">
					assistant
				</div>
				<div
					onTouchStart={startLongPress}
					onTouchEnd={stopLongPress}
					onTouchMove={stopLongPress}
					className={cls(
						"rounded-lg border border-n-150 bg-n-0 px-3.5 py-3 text-n-800 select-none md:select-text transition",
						isSelected && "ring-2 ring-p-500 ring-offset-2 ring-offset-n-0",
					)}
				>
					<div className="text-[13px] leading-[1.6]">{formattedContent}</div>
				</div>

				<div
					className={cls(
						"flex items-center gap-1 mt-1.5 transition-opacity",
						isLastAssistant
							? "opacity-100 md:opacity-50 md:group-hover/msg:opacity-100"
							: "opacity-100 md:opacity-0 md:group-hover/msg:opacity-100",
					)}
				>
					{isLastAssistant && onRegenerate && (
						<button
							onClick={(e) => {
								e.stopPropagation();
								onRegenerate();
							}}
							className={iconBtn}
							title="Regenerate"
						>
							<RotateCcw className="w-3.5 h-3.5" />
						</button>
					)}
					<button
						onClick={handleCopy}
						className={iconBtn}
						title="Copy"
					>
						{isCopied ? (
							<Check className="w-3.5 h-3.5 text-[var(--ok-fg)]" />
						) : (
							<Copy className="w-3.5 h-3.5" />
						)}
					</button>
				</div>
			</div>
		);
	},
);
