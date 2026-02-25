import {
	useState,
	useRef,
	useEffect,
	useLayoutEffect,
	useMemo,
	type FormEvent,
	useCallback,
} from "react";
import { useNavigate } from "react-router-dom";
import { doctorAuthService } from "../../services/doctorAuthService";
import { chatService } from "../../services/chatService";
import { notificationService } from "../../services/notificationService";
import { socketService } from "../../services/socketService";
import type { Message } from "../../types/chat";
import {
	Send,
	LogOut,
	Stethoscope,
	Bot,
	Shield,
	Loader2,
	X,
	Copy,
	FileText,
	Landmark,
	Check,
} from "lucide-react";
import ThemeToggle from "../../components/ThemeToggle";
import { MessageItem } from "./MessageItem";
import { ChatSkeleton } from "./ChatSkeleton";
import { parseWhatsAppFormat } from "../../lib/chatUtils";

export type SelectedItem = {
	type: "message" | "patient";
	id: string | number;
	content: string;
	patientName?: string;
};

export default function DoctorChat() {
	const navigate = useNavigate();
	const doctor = doctorAuthService.getCurrentDoctor();

	// --- State ---
	const [messages, setMessages] = useState<Message[]>([]);
	const [input, setInput] = useState("");
	const [nextCursor, setNextCursor] = useState<number | undefined>(undefined);
	const [editingMessageId, setEditingMessageId] = useState<number | null>(null);

	// Selection State
	const [selectedItem, setSelectedItem] = useState<SelectedItem | null>(null);
	const [isCopied, setIsCopied] = useState(false);

	// UI States
	const [isReady, setIsReady] = useState(false);
	const [isLoadingHistory, setIsLoadingHistory] = useState(false);
	const [isSending, setIsSending] = useState(false);
	const [scrollSpacerActive, setScrollSpacerActive] = useState(false);

	// Real-time AI states
	const [isAiThinking, setIsAiThinking] = useState(false);
	const [currentToolCall, setCurrentToolCall] = useState<string | null>(null);
	const [streamingText, setStreamingText] = useState("");
	const streamingBufferRef = useRef("");
	const renderTimerRef = useRef<number | null>(null);

	// --- Refs ---
	const scrollContainerRef = useRef<HTMLDivElement>(null);
	const messagesEndRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLTextAreaElement | null>(null);

	const prevScrollHeightRef = useRef(0);
	const isPrependRef = useRef(false);
	const isInitialLoadRef = useRef(true);

	const onStreamingChunk = useCallback((chunk: string) => {
		streamingBufferRef.current += chunk;
		if (!renderTimerRef.current) {
			renderTimerRef.current = window.setTimeout(() => {
				setStreamingText(streamingBufferRef.current);
				renderTimerRef.current = null;
			}, 30);
		}
	}, []);

	const stopStreaming = useCallback(() => {
		if (renderTimerRef.current) {
			clearTimeout(renderTimerRef.current);
			renderTimerRef.current = null;
		}
		streamingBufferRef.current = "";
		setStreamingText("");
	}, []);

	// --- Handlers ---
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

	// --- Effects ---
	// Initial history load
	useEffect(() => {
		const init = async () => {
			try {
				const session = await chatService.getHistory(20);
				setMessages(session.messages);
				setNextCursor(session.nextCursor);
			} catch (error) {
				console.error("Failed to load chat history", error);
			} finally {
				setIsReady(true);
			}
		};
		init();
	}, []);

	// Socket.IO real-time connection
	useEffect(() => {
		try {
			socketService.connect();
		} catch {
			console.warn("Socket connection failed, falling back to polling");
		}

		const cleanupThinking = socketService.on("ai_thinking", (data: any) => {
			setIsAiThinking(data.status);
			if (!data.status) setCurrentToolCall(null);
		});

		const cleanupToolCall = socketService.on("ai_tool_call", (data: any) => {
			setCurrentToolCall(data.message);
		});

		const cleanupStreaming = socketService.on("ai_streaming", (data: any) => {
			if (data.chunk) {
				onStreamingChunk(data.chunk);
			}
		});

		const cleanupComplete = socketService.on(
			"ai_response_complete",
			(data: any) => {
				stopStreaming();
				setIsAiThinking(false);
				setCurrentToolCall(null);
				setIsSending(false);
				setScrollSpacerActive(false);
				setMessages((prev) => [...prev, data.message]);
			},
		);

		const cleanupError = socketService.on("error", (data: any) => {
			console.error("[Socket] Error:", data.message);
			stopStreaming();
			setIsAiThinking(false);
			setCurrentToolCall(null);
			setIsSending(false);
			setScrollSpacerActive(false);
		});

		return () => {
			cleanupThinking();
			cleanupToolCall();
			cleanupStreaming();
			cleanupComplete();
			cleanupError();
			socketService.disconnect();
		};
	}, []);

	useEffect(() => {
		const setupNotifications = async () => {
			try {
				await notificationService.initialize();
			} catch (error) {
				console.error("Failed to initialize notifications:", error);
			}
		};
		setupNotifications();
	}, []);

	useLayoutEffect(() => {
		const container = scrollContainerRef.current;
		if (!container) return;

		if (isInitialLoadRef.current && messages.length > 0) {
			container.scrollTop = container.scrollHeight;
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

		// Auto-scroll when new messages are appended
		const { scrollTop, scrollHeight, clientHeight } = container;
		const isNearBottom = scrollHeight - scrollTop - clientHeight < 200;
		if (isNearBottom) {
			requestAnimationFrame(() => {
				messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
			});
		}
	}, [messages]);

	useEffect(() => {
		if (isAiThinking) {
			requestAnimationFrame(() => {
				messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
			});
		}
	}, [isAiThinking]);

	useEffect(() => {
		if (currentToolCall) {
			requestAnimationFrame(() => {
				messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
			});
		}
	}, [currentToolCall]);

	useEffect(() => {
		if (!window.visualViewport) return;
		const handleResize = () => scrollToBottom("smooth");
		window.visualViewport.addEventListener("resize", handleResize);
		return () =>
			window.visualViewport?.removeEventListener("resize", handleResize);
	}, []);

	const handleScroll = async (e: React.UIEvent<HTMLDivElement>) => {
		const { scrollTop, scrollHeight } = e.currentTarget;
		if (scrollTop < 50 && nextCursor && !isLoadingHistory) {
			setIsLoadingHistory(true);
			prevScrollHeightRef.current = scrollHeight;
			isPrependRef.current = true;
			try {
				const session = await chatService.getHistory(20, nextCursor);
				if (session.messages.length > 0) {
					setMessages((prev) => [...session.messages, ...prev]);
					setNextCursor(session.nextCursor);
				} else {
					isPrependRef.current = false;
				}
			} catch (err) {
				isPrependRef.current = false;
			} finally {
				setIsLoadingHistory(false);
			}
		}
	};

	const handleSubmit = async (e: FormEvent) => {
		e.preventDefault();
		if (!input.trim() || isSending) return;
		const tempContent = input.trim();

		// Edit mode: update last user message and regenerate via WebSocket
		if (editingMessageId !== null && socketService.isConnected) {
			setInput("");
			setIsSending(true);
			setScrollSpacerActive(true);

			setMessages((prev) => {
				const updated = [...prev];

				// Update last USER message content
				for (let i = updated.length - 1; i >= 0; i--) {
					if (updated[i].role === "USER") {
						updated[i] = { ...updated[i], content: tempContent };
						break;
					}
				}

				// Remove last ASSISTANT message so new one streams in cleanly
				for (let i = updated.length - 1; i >= 0; i--) {
					if (updated[i].role === "ASSISTANT") {
						updated.splice(i, 1);
						break;
					}
				}

				return updated;
			});

			setEditingMessageId(null);
			scrollToBottom("smooth");

			try {
				(socketService as any).editLastMessage(tempContent);
			} catch (error) {
				console.error("Failed to edit last message", error);
				setIsSending(false);
				setScrollSpacerActive(false);
			}

			return;
		}

		// If edit mode but no socket, fall back to sending a new message
		if (editingMessageId !== null) {
			setEditingMessageId(null);
		}

		setInput("");
		setIsSending(true);

		// Optimistic: add user message immediately
		const optimisticMsg: Message = {
			id: Date.now(),
			role: "USER" as const,
			content: tempContent,
			type: "TEXT" as const,
			createdAt: new Date().toISOString(),
		};
		setMessages((prev) => [...prev, optimisticMsg]);
		setScrollSpacerActive(true);
		scrollToBottom("smooth");

		try {
			if (socketService.isConnected) {
				socketService.sendMessage(tempContent);
			} else {
				await chatService.sendMessage(tempContent);
				setIsSending(false);
				setScrollSpacerActive(false);
			}
		} catch (error) {
			setInput(tempContent);
			setMessages((prev) => prev.filter((m) => m.id !== optimisticMsg.id));
			setIsSending(false);
			setScrollSpacerActive(false);
		}
	};

	const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
		requestAnimationFrame(() => {
			messagesEndRef.current?.scrollIntoView({ behavior, block: "end" });
		});
	}, []);

	const handlePatientAction = useCallback(async (
		action: "summary" | "insurance",
		patientName: string,
	) => {
		const prefix =
			action === "summary"
				? "Check clinical summary of"
				: "Check medical insurance of";
		const content = `${prefix} ${patientName}`;
		setSelectedItem(null);
		setIsSending(true);

		const optimisticMsg: Message = {
			id: Date.now(),
			role: "USER" as const,
			content,
			type: "TEXT" as const,
			createdAt: new Date().toISOString(),
		};
		setMessages((prev) => [...prev, optimisticMsg]);
		setScrollSpacerActive(true);
		scrollToBottom("smooth");

		try {
			if (socketService.isConnected) {
				socketService.sendMessage(content);
			} else {
				await chatService.sendMessage(content);
				setIsSending(false);
				setScrollSpacerActive(false);
			}
		} catch (error) {
			console.error("Failed to send patient action message", error);
			setIsSending(false);
			setScrollSpacerActive(false);
		}
	}, [scrollToBottom]);

	const handleRegenerate = useCallback(() => {
		setMessages((prev) => {
			const idx = [...prev].reverse().findIndex((m) => m.role === "ASSISTANT");
			if (idx === -1) return prev;
			return prev.filter((_, i) => i !== prev.length - 1 - idx);
		});
		setIsAiThinking(true);
		setIsSending(true);
		setScrollSpacerActive(true);
		scrollToBottom("smooth");
		if (socketService.isConnected) {
			socketService.regenerateMessage();
		}
	}, [scrollToBottom]);

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

	const handleStartEditUser = useCallback(
		(id: number, content: string) => {
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
		},
		[],
	);

	const handleLogout = () => {
		doctorAuthService.logout();
		navigate("/");
	};

	return (
		<div className="h-[100dvh] overflow-hidden bg-slate-50 dark:bg-slate-900 flex flex-col transition-colors duration-300 pt-[env(safe-area-inset-top)] relative">
			{/* Selection Backdrop */}

			{/* Unified Selection Toolbar (WhatsApp UX) */}
			{selectedItem && (
				<div className="fixed top-0 left-0 right-0 z-[100] h-16 bg-white/70 dark:bg-slate-900/70 backdrop-blur-md border-b border-slate-200 dark:border-slate-700 md:hidden animate-in slide-in-from-top duration-300 flex items-center justify-between px-6">
					<div className="flex items-center gap-4">
						<button
							onClick={() => setSelectedItem(null)}
							className="p-2 -ml-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-colors"
						>
							<X className="w-5 h-5" />
						</button>
						<div className="flex flex-col">
							<span className="text-sm font-bold text-slate-900 dark:text-white">
								1 selected
							</span>
							{selectedItem?.patientName && (
								<span className="text-[10px] text-slate-500 font-medium truncate max-w-[150px]">
									{selectedItem.patientName}
								</span>
							)}
						</div>
					</div>

					<div className="flex items-center gap-1 sm:gap-2">
						{/* Patient Specific Actions */}
						{selectedItem?.type === "patient" && (
							<>
								<button
									onClick={() =>
										handlePatientAction("summary", selectedItem?.patientName!)
									}
									className="flex items-center gap-2 p-2 sm:px-3 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-all group"
									title="Summary"
								>
									<FileText className="w-5 h-5 text-blue-500" />
									<span className="text-xs font-semibold hidden sm:inline">
										Summary
									</span>
								</button>
								<button
									onClick={() =>
										handlePatientAction("insurance", selectedItem?.patientName!)
									}
									className="flex items-center gap-2 p-2 sm:px-3 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-all group"
									title="Insurance"
								>
									<Landmark className="w-5 h-5 text-cyan-500" />
									<span className="text-xs font-semibold hidden sm:inline">
										Insurance
									</span>
								</button>
							</>
						)}

						<div className="w-px h-6 bg-slate-200 dark:bg-slate-700 mx-1" />

						<button
							onClick={handleCopy}
							className="flex items-center gap-2 p-2 sm:px-3 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-all group active:scale-95"
						>
							{isCopied ? (
								<Check className="w-5 h-5 text-green-500" />
							) : (
								<Copy className="w-5 h-5 text-indigo-500" />
							)}
							<span className="text-xs font-semibold hidden sm:inline">
								{isCopied ? "Copied" : "Copy"}
							</span>
						</button>
					</div>
				</div>
			)}

			<header className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 shadow-sm shrink-0">
				<div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
					<div className="flex items-center gap-2.5">
						<div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-cyan-500 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/20">
							<Stethoscope className="w-5 h-5 text-white" />
						</div>
						<div className="flex flex-col">
							<h1 className="text-sm font-bold text-slate-800 dark:text-white leading-none">
								Hanna-Med MA
							</h1>
							<span className="text-[10px] text-slate-500 font-medium">
								Dr. {doctor?.name}
							</span>
						</div>
					</div>
					<div className="flex items-center gap-2 sm:gap-3">
						<div className="hidden sm:flex items-center gap-1.5 text-xs text-slate-500">
							<Shield className="w-3 h-3 text-green-500" /> HIPAA Secure
						</div>
						<ThemeToggle />
						<button
							onClick={handleLogout}
							className="p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-full transition-colors"
						>
							<LogOut className="w-5 h-5" />
						</button>
					</div>
				</div>
			</header>

			<main className="flex-1 w-full max-w-5xl mx-auto flex flex-col min-h-0 relative">
				<div className="flex-1 flex flex-col min-h-0 relative">
					{!isReady && (
						<div className="absolute inset-0 z-20 bg-slate-50 dark:bg-slate-900">
							<ChatSkeleton />
						</div>
					)}

					{isLoadingHistory && (
						<div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 flex items-center justify-center pointer-events-none">
							<div className="bg-white/90 dark:bg-slate-800/90 backdrop-blur-sm shadow-md border border-slate-200 dark:border-slate-700 rounded-full px-4 py-1.5 flex items-center gap-2">
								<Loader2 className="w-3.5 h-3.5 animate-spin text-blue-500" />
								<span className="text-xs font-medium text-slate-600 dark:text-slate-300">
									Loading history...
								</span>
							</div>
						</div>
					)}

					<div
						ref={scrollContainerRef}
						onScroll={handleScroll}
						className={`flex-1 overflow-y-auto p-3 md:p-4 space-y-3 min-h-0 transition-opacity duration-300 custom-scrollbar
                        ${isReady ? "opacity-100" : "opacity-0"}`}
					>
						{isReady && messages.length === 0 && (
							<div className="absolute inset-0 flex flex-col items-center justify-center text-slate-400 pointer-events-none">
								<div className="bg-slate-100 dark:bg-slate-800 p-4 rounded-full mb-4">
									<Stethoscope className="w-8 h-8 opacity-50 text-blue-500" />
								</div>
								<h3 className="text-lg font-semibold text-slate-700 dark:text-slate-300 mb-2">
									Welcome, Dr. {doctor?.name}
								</h3>
								<p className="text-sm max-w-xs text-center leading-relaxed">
									I'm your AI assistant. Ask me about patient lists, summaries
									or insurance details.
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
							isLastAssistant={message.id === lastAssistantId}
							onRegenerate={handleRegenerate}
							isLastUser={message.id === lastUserId}
							onEditUser={handleStartEditUser}
						/>
					))}

				{(isAiThinking || streamingText) && (
					<div className="flex gap-2 items-start">
						<div className="shrink-0 mt-0.5">
							<div className={`w-6 h-6 md:w-7 md:h-7 rounded-full bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center shadow-sm shadow-blue-500/20 ${!streamingText ? "animate-pulse" : ""}`}>
								<Bot className="w-3 h-3 md:w-3.5 md:h-3.5 text-white" />
							</div>
						</div>
						<div className="flex-1 min-w-0 flex flex-col gap-1.5">
							{currentToolCall && (
								<div className="flex items-center gap-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800/50 rounded-xl px-3 py-2 w-fit">
									<Loader2 className="w-3 h-3 animate-spin text-blue-500" />
									<span className="text-[11px] font-medium text-blue-600 dark:text-blue-400">
										{currentToolCall}
									</span>
								</div>
							)}
							{streamingText ? (
							<div className="pt-0.5 pb-1 text-slate-800 dark:text-slate-100">
								<div className="text-[13px] leading-relaxed tracking-wide">
										{parseWhatsAppFormat(streamingText)}
									</div>
								</div>
							) : (
								<div className="py-3">
									<div className="flex gap-1.5 items-center">
										<span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" />
										<span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce delay-75" />
										<span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce delay-150" />
									</div>
								</div>
							)}
						</div>
					</div>
				)}

						{scrollSpacerActive && (
							<div className="shrink-0 min-h-[50vh]" aria-hidden="true" />
						)}
						<div ref={messagesEndRef} />
					</div>

					{/* Input Area */}
					<div className="px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 shrink-0 z-30">
						<form
							onSubmit={handleSubmit}
							className="max-w-3xl mx-auto bg-white/80 dark:bg-slate-800/80 backdrop-blur-xl border border-white/20 dark:border-slate-700 rounded-2xl shadow-xl p-1.5 flex items-center gap-1.5 ring-1 ring-black/5 dark:ring-white/5"
						>
							<textarea
								ref={inputRef}
								value={input}
								onChange={(e) => setInput(e.target.value)}
								onKeyDown={(e) => {
									if (e.key === "Enter" && !e.shiftKey) {
										e.preventDefault();
										handleSubmit(e as any);
									}
								}}
								placeholder="Ask anything..."
								autoComplete="off"
								rows={1}
								className="flex-1 max-h-32 min-h-[36px] px-3 py-2 text-sm bg-transparent border-none outline-none focus:outline-none focus:ring-0 text-slate-800 dark:text-gray-100 placeholder-slate-400 dark:placeholder-slate-500 resize-none overflow-y-auto custom-scrollbar leading-snug"
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
								className="shrink-0 self-end mb-0.5 w-9 h-9 bg-gradient-to-br from-blue-600 to-cyan-500 hover:from-blue-700 hover:to-cyan-600 text-white rounded-xl shadow-md shadow-blue-500/20 disabled:opacity-30 disabled:scale-90 disabled:shadow-none flex items-center justify-center transition-all duration-200 active:scale-95"
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
		</div>
	);
}
