import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useRef,
	useState,
	type ReactNode,
} from "react";
import { chatService } from "../services/chatService";
import { socketService } from "../services/socketService";
import type { Message } from "../types/chat";

/**
 * Chat state shared across the doctor portal.
 *
 * Why a context (rather than local state in DoctorChat):
 *   - History was re-fetched on every navigation into the chat tab.
 *   - The socket was re-connected on every navigation, meaning an assistant
 *     response streaming while the doctor briefly checked another tab was
 *     lost.
 *   - Actions from PatientList (Summary / Insurance / Lab buttons) need to
 *     enqueue a message and get the response regardless of which screen the
 *     doctor is currently looking at.
 *
 * Lifecycle:
 *   - DoctorLayout mounts → provider initialises → history loads once,
 *     socket connects once.
 *   - DoctorLayout unmounts (logout or full navigation away) → socket
 *     disconnects, state is freed.
 */

interface DoctorChatState {
	messages: Message[];
	isReady: boolean;
	isLoadingHistory: boolean;
	isSending: boolean;
	isAiThinking: boolean;
	currentToolCall: string | null;
	streamingText: string;
	hasMoreHistory: boolean;
	/** Send a new user message. Waits briefly for the socket handshake. */
	sendMessage: (content: string) => Promise<void>;
	/** Re-run the last assistant response. */
	regenerate: () => void;
	/** Overwrite the most recent user message and regenerate the reply. */
	editLastUser: (content: string) => void;
	/** Pagination — loads the next page of older messages. Returns count. */
	loadMoreHistory: () => Promise<number>;
}

const DoctorChatContext = createContext<DoctorChatState | null>(null);

export function DoctorChatProvider({ children }: { children: ReactNode }) {
	const [messages, setMessages] = useState<Message[]>([]);
	const [nextCursor, setNextCursor] = useState<number | undefined>();
	const [isReady, setIsReady] = useState(false);
	const [isLoadingHistory, setIsLoadingHistory] = useState(false);
	const [isSending, setIsSending] = useState(false);

	const [isAiThinking, setIsAiThinking] = useState(false);
	const [currentToolCall, setCurrentToolCall] = useState<string | null>(null);
	const [streamingText, setStreamingText] = useState("");
	const streamingBufferRef = useRef("");
	const renderTimerRef = useRef<number | null>(null);

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

	// Initial history load — once per provider mount, guarded against
	// StrictMode double-invocation so dev doesn't fire two requests.
	const didInitRef = useRef(false);
	useEffect(() => {
		if (didInitRef.current) return;
		didInitRef.current = true;
		(async () => {
			try {
				const session = await chatService.getHistory(20);
				setMessages(session.messages);
				setNextCursor(session.nextCursor);
			} catch (error) {
				console.error("chat history load failed", error);
			} finally {
				setIsReady(true);
			}
		})();
	}, []);

	// Socket lifecycle — connect once, tear down when provider unmounts.
	useEffect(() => {
		try {
			socketService.connect();
		} catch (error) {
			console.warn("socket connect failed", error);
		}

		const cleanupThinking = socketService.on("ai_thinking", (data: any) => {
			setIsAiThinking(data.status);
			if (!data.status) setCurrentToolCall(null);
		});
		const cleanupToolCall = socketService.on("ai_tool_call", (data: any) => {
			setCurrentToolCall(data.message);
		});
		const cleanupStreaming = socketService.on("ai_streaming", (data: any) => {
			if (data.chunk) onStreamingChunk(data.chunk);
		});
		const cleanupComplete = socketService.on(
			"ai_response_complete",
			(data: any) => {
				stopStreaming();
				setIsAiThinking(false);
				setCurrentToolCall(null);
				setIsSending(false);
				setMessages((prev) => [...prev, data.message]);
			},
		);
		const cleanupError = socketService.on("error", (data: any) => {
			console.error("[Socket] Error:", data.message);
			stopStreaming();
			setIsAiThinking(false);
			setCurrentToolCall(null);
			setIsSending(false);
		});

		return () => {
			cleanupThinking();
			cleanupToolCall();
			cleanupStreaming();
			cleanupComplete();
			cleanupError();
			socketService.disconnect();
		};
	}, [onStreamingChunk, stopStreaming]);

	const waitForSocket = useCallback(async (timeoutMs = 3000) => {
		const start = Date.now();
		while (!socketService.isConnected) {
			if (Date.now() - start > timeoutMs) return false;
			await new Promise((r) => setTimeout(r, 100));
		}
		return true;
	}, []);

	const sendMessage = useCallback(
		async (content: string) => {
			const trimmed = content.trim();
			if (!trimmed) return;

			setIsSending(true);
			const optimistic: Message = {
				id: Date.now(),
				role: "USER" as const,
				content: trimmed,
				type: "TEXT" as const,
				createdAt: new Date().toISOString(),
			};
			setMessages((prev) => [...prev, optimistic]);

			const connected = await waitForSocket();
			try {
				if (connected) {
					socketService.sendMessage(trimmed);
				} else {
					// HTTP fallback — response won't stream over the socket we're
					// not subscribed to, but the message gets persisted.
					await chatService.sendMessage(trimmed);
					setIsSending(false);
				}
			} catch (error) {
				console.error("sendMessage failed", error);
				setIsSending(false);
			}
		},
		[waitForSocket],
	);

	const regenerate = useCallback(() => {
		setMessages((prev) => {
			const reverseIdx = [...prev]
				.reverse()
				.findIndex((m) => m.role === "ASSISTANT");
			if (reverseIdx === -1) return prev;
			return prev.filter((_, i) => i !== prev.length - 1 - reverseIdx);
		});
		setIsAiThinking(true);
		setIsSending(true);
		try {
			if (socketService.isConnected) {
				socketService.regenerateMessage();
			}
		} catch (error) {
			console.error("regenerate failed", error);
			setIsSending(false);
		}
	}, []);

	const editLastUser = useCallback((content: string) => {
		const trimmed = content.trim();
		if (!trimmed) return;
		setIsSending(true);
		setMessages((prev) => {
			const updated = [...prev];
			for (let i = updated.length - 1; i >= 0; i--) {
				if (updated[i].role === "USER") {
					updated[i] = { ...updated[i], content: trimmed };
					break;
				}
			}
			for (let i = updated.length - 1; i >= 0; i--) {
				if (updated[i].role === "ASSISTANT") {
					updated.splice(i, 1);
					break;
				}
			}
			return updated;
		});
		try {
			if (socketService.isConnected) {
				socketService.editLastMessage(trimmed);
			}
		} catch (error) {
			console.error("edit last failed", error);
			setIsSending(false);
		}
	}, []);

	const loadMoreHistory = useCallback(async () => {
		if (!nextCursor || isLoadingHistory) return 0;
		setIsLoadingHistory(true);
		try {
			const session = await chatService.getHistory(20, nextCursor);
			if (session.messages.length > 0) {
				setMessages((prev) => [...session.messages, ...prev]);
				setNextCursor(session.nextCursor);
				return session.messages.length;
			}
			return 0;
		} catch (error) {
			console.error("loadMoreHistory failed", error);
			return 0;
		} finally {
			setIsLoadingHistory(false);
		}
	}, [nextCursor, isLoadingHistory]);

	return (
		<DoctorChatContext.Provider
			value={{
				messages,
				isReady,
				isLoadingHistory,
				isSending,
				isAiThinking,
				currentToolCall,
				streamingText,
				hasMoreHistory: !!nextCursor,
				sendMessage,
				regenerate,
				editLastUser,
				loadMoreHistory,
			}}
		>
			{children}
		</DoctorChatContext.Provider>
	);
}

export function useDoctorChat(): DoctorChatState {
	const ctx = useContext(DoctorChatContext);
	if (!ctx) {
		throw new Error(
			"useDoctorChat must be used within a <DoctorChatProvider />",
		);
	}
	return ctx;
}
