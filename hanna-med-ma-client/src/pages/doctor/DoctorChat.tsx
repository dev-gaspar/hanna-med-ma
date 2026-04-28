import {
	useState,
	useRef,
	useEffect,
	useLayoutEffect,
	useMemo,
	type FormEvent,
	useCallback,
} from "react";
import { useSearchParams } from "react-router-dom";
import { patientService } from "../../services/patientService";
import { toast } from "sonner";
import {
	Send,
	Loader2,
	X,
	Copy,
	FileText,
	Shield,
	FlaskConical,
	Check,
	CheckCircle2,
	Calendar,
} from "lucide-react";
import { MessageItem } from "./MessageItem";
import { ChatSkeleton } from "./ChatSkeleton";
import { parseMarkdown } from "../../lib/markdown";
import { cls } from "../../lib/cls";
import { Button } from "../../components/ui/Button";
import { IconButton } from "../../components/ui/IconButton";
import { useDoctorChat } from "../../contexts/DoctorChatContext";
import { useDoctorData } from "../../contexts/DoctorDataContext";

export type SelectedItem = {
	type: "message" | "patient";
	id: string | number;
	content: string;
	patientName?: string;
	patientId?: number;
};

export default function DoctorChat() {
	const [searchParams, setSearchParams] = useSearchParams();

	// Everything that used to be local (history, socket, streaming) now lives
	// in DoctorChatContext so navigating away and back does not re-fetch
	// history or drop the socket subscription. DoctorChat only owns UI
	// state from here on.
	const {
		messages,
		isReady,
		isLoadingHistory,
		isSending,
		isAiThinking,
		currentToolCall,
		streamingText,
		hasMoreHistory,
		sendMessage,
		regenerate,
		editLastUser,
		loadMoreHistory,
	} = useDoctorChat();

	const { markSeenLocally } = useDoctorData();

	const [input, setInput] = useState("");
	const [editingMessageId, setEditingMessageId] = useState<number | null>(null);

	const [selectedItem, setSelectedItem] = useState<SelectedItem | null>(null);
	const [isCopied, setIsCopied] = useState(false);

	const [markingLoading, setMarkingLoading] = useState<Set<number>>(new Set());

	const [encounterModalPatientId, setEncounterModalPatientId] = useState<
		number | null
	>(null);
	const todayIso = () => new Date().toISOString().slice(0, 10);
	const [encounterDateOfService, setEncounterDateOfService] = useState<string>(
		todayIso(),
	);
	const [encounterType, setEncounterType] = useState<
		"CONSULT" | "PROGRESS" | "PROCEDURE"
	>("CONSULT");

	const scrollContainerRef = useRef<HTMLDivElement>(null);
	const messagesEndRef = useRef<HTMLDivElement>(null);
	const spacerEndRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLTextAreaElement | null>(null);

	const prevScrollHeightRef = useRef(0);
	const isPrependRef = useRef(false);
	const isInitialLoadRef = useRef(true);

	const handleSelect = useCallback((item: SelectedItem | null) => {
		if (!item) {
			setSelectedItem(null);
			return;
		}
		setSelectedItem((prev) =>
			prev?.id === item.id && prev?.type === item.type ? null : item,
		);
	}, []);

	const copyToClipboard = useCallback((text: string) => {
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
	}, []);

	const handleCopy = useCallback(() => {
		if (!selectedItem) return;
		copyToClipboard(selectedItem.content);
		setIsCopied(true);
		setTimeout(() => {
			setIsCopied(false);
			setSelectedItem(null);
		}, 1000);
	}, [selectedItem, copyToClipboard]);

	const handleMarkSeen = (patientId: number) => {
		setEncounterDateOfService(todayIso());
		setEncounterType("CONSULT");
		setEncounterModalPatientId(patientId);
	};

	const handleConfirmEncounter = async () => {
		const patientId = encounterModalPatientId;
		const dateOfService = encounterDateOfService;
		const type = encounterType;
		setEncounterModalPatientId(null);
		if (!patientId) return;

		const label =
			type === "CONSULT"
				? "Consult"
				: type === "PROGRESS"
					? "Follow-Up"
					: "Procedure";

		try {
			setMarkingLoading((prev) => new Set(prev).add(patientId));
			await patientService.markAsSeen(patientId, type, dateOfService);
			const isToday = dateOfService === todayIso();
			toast.success(
				isToday
					? `${label} encounter created`
					: `${label} encounter created for ${dateOfService}`,
			);
			markSeenLocally(patientId);
		} catch (error) {
			console.error("Failed to mark patient as seen:", error);
			toast.error("Failed to create encounter. Please try again.");
		} finally {
			setMarkingLoading((prev) => {
				const next = new Set(prev);
				next.delete(patientId);
				return next;
			});
		}
	};

	const scrollToSpacer = useCallback((behavior: ScrollBehavior = "smooth") => {
		requestAnimationFrame(() => {
			setTimeout(() => {
				spacerEndRef.current?.scrollIntoView({ behavior, block: "end" });
			}, 50);
		});
	}, []);

	// Chat interop: when another screen navigates here with `?q=...`, send
	// the query once. The context handles socket waiting internally.
	const autoSentRef = useRef(false);
	useEffect(() => {
		if (!isReady || autoSentRef.current) return;
		const q = searchParams.get("q");
		if (!q) return;
		const content = q.trim();
		if (!content) return;
		autoSentRef.current = true;

		// Clear query so a hard refresh doesn't replay.
		const next = new URLSearchParams(searchParams);
		next.delete("q");
		setSearchParams(next, { replace: true });

		sendMessage(content);
		scrollToSpacer("smooth");
	}, [isReady, searchParams, setSearchParams, sendMessage, scrollToSpacer]);

	useLayoutEffect(() => {
		const container = scrollContainerRef.current;
		if (!container) return;

		if (isInitialLoadRef.current && messages.length > 0) {
			requestAnimationFrame(() => {
				messagesEndRef.current?.scrollIntoView({
					behavior: "auto",
					block: "end",
				});
			});
			isInitialLoadRef.current = false;
			return;
		}

		if (isPrependRef.current) {
			const newHeight = container.scrollHeight;
			const diff = newHeight - prevScrollHeightRef.current;
			if (diff > 0) container.scrollTop = diff;
			isPrependRef.current = false;
			return;
		}

		const containerRect = container.getBoundingClientRect();
		const messagesEndRect = messagesEndRef.current?.getBoundingClientRect();

		if (
			messagesEndRect &&
			messagesEndRect.bottom <= containerRect.bottom + 150
		) {
			requestAnimationFrame(() => {
				messagesEndRef.current?.scrollIntoView({
					behavior: "smooth",
					block: "end",
				});
			});
		}
	}, [messages]);

	useEffect(() => {
		if (!window.visualViewport) return;
		const handleResize = () => scrollToSpacer("smooth");
		window.visualViewport.addEventListener("resize", handleResize);
		return () =>
			window.visualViewport?.removeEventListener("resize", handleResize);
	}, [scrollToSpacer]);

	const handleScroll = async (e: React.UIEvent<HTMLDivElement>) => {
		const { scrollTop, scrollHeight } = e.currentTarget;
		if (scrollTop < 50 && hasMoreHistory && !isLoadingHistory) {
			prevScrollHeightRef.current = scrollHeight;
			isPrependRef.current = true;
			const loaded = await loadMoreHistory();
			if (!loaded) isPrependRef.current = false;
		}
	};

	const handleSubmit = (e: FormEvent) => {
		e.preventDefault();
		const content = input.trim();
		if (!content || isSending) return;

		if (editingMessageId !== null) {
			setInput("");
			setEditingMessageId(null);
			scrollToSpacer("smooth");
			editLastUser(content);
			return;
		}

		setInput("");
		scrollToSpacer("smooth");
		sendMessage(content);
	};

	const handlePatientAction = useCallback(
		(action: "summary" | "insurance" | "lab", patientName: string) => {
			const prefix =
				action === "summary"
					? "Check clinical summary of"
					: action === "insurance"
						? "Check medical insurance of"
						: "Check lab results of";
			setSelectedItem(null);
			scrollToSpacer("smooth");
			sendMessage(`${prefix} ${patientName}`);
		},
		[scrollToSpacer, sendMessage],
	);

	const handleRegenerate = useCallback(() => {
		scrollToSpacer("smooth");
		regenerate();
	}, [scrollToSpacer, regenerate]);

	const lastAssistantId = useMemo(() => {
		for (let i = messages.length - 1; i >= 0; i--) {
			if (messages[i].role === "ASSISTANT") return messages[i].id;
		}
		return null;
	}, [messages]);

	const lastUserId = useMemo(() => {
		for (let i = messages.length - 1; i >= 0; i--) {
			if (messages[i].role === "USER") return messages[i].id;
		}
		return null;
	}, [messages]);

	const handleStartEditUser = useCallback((id: number, content: string) => {
		setEditingMessageId(id);
		setInput(content);
		requestAnimationFrame(() => {
			if (inputRef.current) {
				const target = inputRef.current;
				target.focus();
				target.style.height = "auto";
				target.style.height = `${Math.min(target.scrollHeight, 128)}px`;
			}
		});
	}, []);

	return (
		<div className="flex-1 flex flex-col min-h-0 bg-n-50 relative">
			{selectedItem && (
				<div className="fixed top-0 left-0 right-0 z-[100] h-14 bg-n-0/90 backdrop-blur-md border-b border-n-150 md:hidden flex items-center justify-between px-4">
					<div className="flex items-center gap-3 min-w-0">
						<IconButton
							onClick={() => setSelectedItem(null)}
							aria-label="Close selection"
						>
							<X className="w-4 h-4" />
						</IconButton>
						<div className="flex flex-col min-w-0">
							<span className="text-[13px] font-semibold text-n-900">
								1 selected
							</span>
							{selectedItem?.patientName && (
								<span className="font-mono text-[10.5px] text-n-500 truncate max-w-[180px]">
									{selectedItem.patientName}
								</span>
							)}
						</div>
					</div>

					<div className="flex items-center gap-1">
						{selectedItem?.type === "patient" && (
							<>
								<button
									onClick={() =>
										handlePatientAction("summary", selectedItem?.patientName!)
									}
									className="inline-flex items-center gap-1.5 h-8 px-2 rounded-md text-n-700 hover:bg-n-100 transition"
									title="Summary"
								>
									<FileText className="w-4 h-4" />
									<span className="text-[11.5px] font-medium hidden sm:inline">
										Summary
									</span>
								</button>
								<button
									onClick={() =>
										handlePatientAction("insurance", selectedItem?.patientName!)
									}
									className="inline-flex items-center gap-1.5 h-8 px-2 rounded-md text-n-700 hover:bg-n-100 transition"
									title="Insurance"
								>
									<Shield className="w-4 h-4" />
									<span className="text-[11.5px] font-medium hidden sm:inline">
										Insurance
									</span>
								</button>
								<button
									onClick={() =>
										handlePatientAction("lab", selectedItem?.patientName!)
									}
									className="inline-flex items-center gap-1.5 h-8 px-2 rounded-md text-n-700 hover:bg-n-100 transition"
									title="Lab"
								>
									<FlaskConical className="w-4 h-4" />
									<span className="text-[11.5px] font-medium hidden sm:inline">
										Lab
									</span>
								</button>
								<button
									onClick={() => handleMarkSeen(selectedItem?.patientId!)}
									disabled={
										!selectedItem?.patientId ||
										markingLoading.has(selectedItem?.patientId!)
									}
									className="inline-flex items-center gap-1.5 h-8 px-2 rounded-md text-n-700 hover:bg-n-100 transition disabled:opacity-40"
									title="Seen"
								>
									{selectedItem?.patientId &&
									markingLoading.has(selectedItem.patientId) ? (
										<Loader2 className="w-4 h-4 animate-spin" />
									) : (
										<CheckCircle2 className="w-4 h-4" />
									)}
									<span className="text-[11.5px] font-medium hidden sm:inline">
										Seen
									</span>
								</button>
							</>
						)}

						<div className="w-px h-5 bg-n-200 mx-1" />

						<button
							onClick={handleCopy}
							className="inline-flex items-center gap-1.5 h-8 px-2 rounded-md text-n-700 hover:bg-n-100 transition"
						>
							{isCopied ? (
								<Check className="w-4 h-4 text-[var(--ok-fg)]" />
							) : (
								<Copy className="w-4 h-4" />
							)}
							<span className="text-[11.5px] font-medium hidden sm:inline">
								{isCopied ? "Copied" : "Copy"}
							</span>
						</button>
					</div>
				</div>
			)}

			<main className="flex-1 w-full max-w-5xl mx-auto flex flex-col min-h-0 relative">
				<div className="flex-1 flex flex-col min-h-0 relative">
					{!isReady && (
						<div className="absolute inset-0 z-20 bg-n-50">
							<ChatSkeleton />
						</div>
					)}

					{isLoadingHistory && (
						<div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 pointer-events-none">
							<div className="bg-n-0 border border-n-200 rounded-md px-3 py-1.5 flex items-center gap-2 shadow-soft">
								<Loader2 className="w-3 h-3 animate-spin text-p-500" />
								<span className="font-mono text-[10.5px] uppercase tracking-widest text-n-500">
									Loading history
								</span>
							</div>
						</div>
					)}

					<div
						ref={scrollContainerRef}
						onScroll={handleScroll}
						className={cls(
							"flex-1 overflow-y-auto p-4 space-y-5 min-h-0 transition-opacity duration-300 custom-scrollbar",
							isReady ? "opacity-100" : "opacity-0",
						)}
						style={{ overflowAnchor: "none" }}
					>
						{isReady && messages.length === 0 && (
							<div className="absolute inset-0 flex flex-col items-start justify-center px-8 pointer-events-none">
								<div className="label-kicker mb-3">Assistant · idle</div>
								<div className="font-serif text-[22px] text-n-900 mb-1.5 leading-tight">
									Ask about your census.
								</div>
								<p className="text-[13px] text-n-500 max-w-sm leading-relaxed">
									Patient lists, summaries, insurance, lab results. Cite,
									compare, mark seen.
								</p>
							</div>
						)}

						{messages.map((message) => (
							<MessageItem
								key={message.id}
								message={message}
								selectedId={selectedItem?.id}
								onSelect={handleSelect}
								onAction={handlePatientAction}
								onMarkSeen={handleMarkSeen}
								markingLoading={markingLoading}
								isLastAssistant={message.id === lastAssistantId}
								onRegenerate={handleRegenerate}
								isLastUser={message.id === lastUserId}
								onEditUser={handleStartEditUser}
							/>
						))}

						{(isAiThinking || streamingText) && (
							<div className="max-w-[92%]">
								<div className="font-mono text-[10px] uppercase tracking-widest text-n-500 mb-1.5 flex items-center gap-2">
									<span>assistant</span>
									<span className="w-1.5 h-1.5 rounded-full bg-[var(--info-fg)] animate-pulse" />
								</div>
								{currentToolCall && (
									<div className="rounded-lg border border-n-150 bg-n-50 mb-1.5">
										<div className="flex items-center gap-2 px-3 py-1.5 font-mono text-[11.5px] text-n-700">
											<Loader2 className="w-3 h-3 animate-spin text-[var(--info-fg)]" />
											<span className="flex-1">{currentToolCall}</span>
										</div>
									</div>
								)}
								{streamingText &&
								!(
									streamingText.trimStart().startsWith("{") ||
									streamingText.trimStart().startsWith("[")
								) ? (
									<div className="rounded-lg bg-n-0 border border-n-150 px-3.5 py-3 text-[13px] text-n-800 leading-[1.6]">
										{parseMarkdown(streamingText)}
									</div>
								) : (
									!currentToolCall && (
										<div className="inline-flex items-center gap-1.5 rounded-lg border border-n-150 bg-n-0 px-3 py-2.5 w-fit">
											<span className="w-1.5 h-1.5 bg-n-400 rounded-full animate-bounce" />
											<span className="w-1.5 h-1.5 bg-n-400 rounded-full animate-bounce delay-75" />
											<span className="w-1.5 h-1.5 bg-n-400 rounded-full animate-bounce delay-150" />
										</div>
									)
								)}
							</div>
						)}

						<div ref={messagesEndRef} />
						<div className="shrink-0 min-h-[30vh]" aria-hidden="true" />
						<div ref={spacerEndRef} />
					</div>

					<div className="px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 shrink-0 z-30">
						<form
							onSubmit={handleSubmit}
							className="max-w-3xl mx-auto bg-n-0 border border-n-200 rounded-lg p-1.5 flex items-center gap-1.5 shadow-soft focus-within:border-p-500 transition"
						>
							<textarea
								ref={inputRef}
								value={input}
								onChange={(e) => setInput(e.target.value)}
								onKeyDown={(e) => {
									if (e.key === "Enter" && !e.shiftKey) {
										e.preventDefault();
										handleSubmit(e as unknown as FormEvent);
									}
								}}
								placeholder={
									editingMessageId
										? "Edit your message…"
										: "Ask about your census…"
								}
								autoComplete="off"
								rows={1}
								className="flex-1 max-h-32 min-h-[36px] px-2.5 py-2 text-[13.5px] bg-transparent border-none outline-none focus:outline-none focus:ring-0 text-n-900 placeholder:text-n-400 resize-none overflow-y-auto custom-scrollbar leading-snug"
								style={{ height: "auto" }}
								onInput={(e) => {
									const target = e.target as HTMLTextAreaElement;
									target.style.height = "auto";
									target.style.height = `${Math.min(target.scrollHeight, 128)}px`;
								}}
							/>
							<button
								type="submit"
								disabled={!input.trim() || isSending}
								className="shrink-0 self-end mb-0.5 w-9 h-9 bg-p-600 hover:bg-p-700 text-white rounded-md disabled:opacity-30 disabled:cursor-not-allowed inline-flex items-center justify-center transition"
								aria-label="Send"
							>
								{isSending ? (
									<Loader2 className="w-4 h-4 animate-spin" />
								) : (
									<Send className="w-4 h-4" />
								)}
							</button>
						</form>
					</div>
				</div>
			</main>

			{encounterModalPatientId !== null && (
				<div
					className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center bg-n-900/40 backdrop-blur-[2px]"
					onClick={() => setEncounterModalPatientId(null)}
				>
					<div
						className="bg-n-0 rounded-t-2xl sm:rounded-lg border-t sm:border border-n-200 shadow-deep w-full sm:max-w-[420px] px-5 pt-4 pb-6 sm:p-5"
						onClick={(e) => e.stopPropagation()}
					>
						<div className="w-10 h-1 bg-n-200 rounded-full mx-auto mb-4 sm:hidden" />

						<div className="flex items-start justify-between mb-4">
							<div>
								<h3 className="font-serif text-[20px] text-n-900 leading-tight">
									Mark as seen
								</h3>
								<p className="text-[12px] text-n-500 mt-1">
									Creates an encounter record. Sign-off is deliberate.
								</p>
							</div>
							<IconButton
								onClick={() => setEncounterModalPatientId(null)}
								aria-label="Close"
								className="shrink-0"
							>
								<X className="w-4 h-4" />
							</IconButton>
						</div>

						<div className="space-y-4">
							<div>
								<label className="label-kicker block mb-1.5">
									Encounter type
								</label>
								<div className="grid grid-cols-3 gap-2">
									<button
										onClick={() => setEncounterType("CONSULT")}
										className={cls(
											"h-10 rounded-md border text-[13px] font-medium transition",
											encounterType === "CONSULT"
												? "border-p-500 bg-p-50 text-p-700"
												: "border-n-200 text-n-700 hover:bg-n-100",
										)}
									>
										Consult{" "}
										<span className="font-mono text-[10.5px] opacity-70">
											· 1st
										</span>
									</button>
									<button
										onClick={() => setEncounterType("PROGRESS")}
										className={cls(
											"h-10 rounded-md border text-[13px] font-medium transition",
											encounterType === "PROGRESS"
												? "border-p-500 bg-p-50 text-p-700"
												: "border-n-200 text-n-700 hover:bg-n-100",
										)}
									>
										Follow-Up{" "}
										<span className="font-mono text-[10.5px] opacity-70">
											· daily
										</span>
									</button>
									<button
										onClick={() => setEncounterType("PROCEDURE")}
										className={cls(
											"h-10 rounded-md border text-[13px] font-medium transition",
											encounterType === "PROCEDURE"
												? "border-p-500 bg-p-50 text-p-700"
												: "border-n-200 text-n-700 hover:bg-n-100",
										)}
									>
										Procedure{" "}
										<span className="font-mono text-[10.5px] opacity-70">
											· surgical
										</span>
									</button>
								</div>
							</div>

							<div>
								<label
									htmlFor="encounter-dos"
									className="label-kicker block mb-1.5"
								>
									Date of service
								</label>
								<div className="relative">
									<Calendar className="w-3.5 h-3.5 text-n-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
									<input
										id="encounter-dos"
										type="date"
										value={encounterDateOfService}
										max={todayIso()}
										onChange={(e) =>
											setEncounterDateOfService(e.target.value)
										}
										className="input-field h-10 pl-8"
									/>
								</div>
								<p className="mt-1 text-[10.5px] text-n-500 leading-tight">
									Defaults to today. Change it if you forgot to mark the visit
									on the actual day.
								</p>
							</div>
						</div>

						<div className="flex gap-2 mt-5">
							<Button
								tone="ghost"
								size="md"
								onClick={() => setEncounterModalPatientId(null)}
								className="flex-1"
							>
								Cancel
							</Button>
							<Button
								tone="primary"
								size="md"
								onClick={handleConfirmEncounter}
								className="flex-1"
							>
								Sign & record
							</Button>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
