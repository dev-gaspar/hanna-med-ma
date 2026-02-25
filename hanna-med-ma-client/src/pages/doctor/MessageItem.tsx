import type { Message } from "../../types/chat";
import { Bot, Copy, Check, RotateCcw, Pencil } from "lucide-react";
import { memo, useMemo, useRef, useCallback, useState } from "react";
import { PatientListMessage } from "./PatientListMessage";
import { parseWhatsAppFormat } from "../../lib/chatUtils";
import type { SelectedItem } from "./DoctorChat";

interface MessageItemProps {
	message: Message;
	selectedId?: string | number;
	onSelect: (item: SelectedItem | null) => void;
	onAction?: (action: "summary" | "insurance", patientName: string) => void;
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
				const text = message.content;
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
			[message.content],
		);

		const actionBtnClass =
			"p-1.5 rounded-lg text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors";

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
							className={`mt-1 inline-flex items-center justify-center ${actionBtnClass} opacity-100 md:opacity-0 md:group-hover/user:opacity-100`}
							aria-label="Edit message"
						>
							<Pencil className="w-3.5 h-3.5" />
						</button>
					)}

					<div
						onTouchStart={startLongPress}
						onTouchEnd={stopLongPress}
						onTouchMove={stopLongPress}
						className={`max-w-[88%] sm:max-w-[75%] rounded-2xl rounded-br-md px-4 py-2.5 shadow-sm select-none md:select-text transition-all duration-200 bg-gradient-to-br from-blue-600 to-blue-500 text-white shadow-blue-500/20 ${
							isSelected
								? "ring-2 ring-indigo-500 dark:ring-indigo-400 ring-offset-2 dark:ring-offset-slate-900"
								: "hover:shadow-md"
						}`}
					>
						<div className="text-xs leading-relaxed tracking-wide">
							{formattedContent}
						</div>
					</div>
				</div>
			);
		}

		return (
			<div className="flex gap-2 relative group/msg items-start">
				<div className="shrink-0 mt-0.5">
					<div className="w-6 h-6 md:w-7 md:h-7 rounded-full bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center shadow-sm shadow-blue-500/20">
						<Bot className="w-3 h-3 md:w-3.5 md:h-3.5 text-white" />
					</div>
				</div>

				<div
					onTouchStart={startLongPress}
					onTouchEnd={stopLongPress}
					onTouchMove={stopLongPress}
					className={`flex-1 min-w-0 pt-0.5 pb-1 select-none md:select-text text-slate-800 dark:text-slate-100 ${
						isSelected
							? "ring-2 ring-indigo-500 dark:ring-indigo-400 ring-offset-2 dark:ring-offset-slate-900 rounded-lg"
							: ""
					}`}
				>
					<div className="text-[13px] leading-relaxed tracking-wide">
						{formattedContent}
					</div>

					<div
						className={`flex items-center gap-0.5 mt-1.5 transition-opacity duration-200 ${
							isLastAssistant
								? "opacity-100 md:opacity-60 md:hover:opacity-100"
								: "opacity-100 md:opacity-0 md:group-hover/msg:opacity-100"
						}`}
					>
						{isLastAssistant && onRegenerate && (
							<button
								onClick={(e) => {
									e.stopPropagation();
									onRegenerate();
								}}
								className={actionBtnClass}
								title="Regenerate"
							>
								<RotateCcw className="w-3.5 h-3.5" />
							</button>
						)}
						<button
							onClick={handleCopy}
							className={actionBtnClass}
							title="Copy"
						>
							{isCopied ? (
								<Check className="w-3.5 h-3.5 text-green-500" />
							) : (
								<Copy className="w-3.5 h-3.5" />
							)}
						</button>
					</div>
				</div>
			</div>
		);
	},
);
