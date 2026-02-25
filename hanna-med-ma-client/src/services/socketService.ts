import { io, Socket } from "socket.io-client";
import { doctorAuthService } from "./doctorAuthService";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";

class SocketService {
    private socket: Socket | null = null;
    private listeners: Map<string, Set<Function>> = new Map();

    connect(): Socket {
        if (this.socket?.connected) return this.socket;

        const token = doctorAuthService.getToken();
        if (!token) throw new Error("No auth token available");

        this.socket = io(`${API_URL}/chat`, {
            auth: { token },
            transports: ["websocket", "polling"],
            reconnection: true,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 5000,
            reconnectionAttempts: Infinity,
        });

        this.socket.on("connect", () => {
            console.log("[Socket] Connected");
        });

        this.socket.on("disconnect", (reason) => {
            console.log(`[Socket] Disconnected: ${reason}`);
        });

        this.socket.on("connect_error", (error) => {
            console.error("[Socket] Connection error:", error.message);
        });

        // Re-emit to local listeners
        this.socket.onAny((event, ...args) => {
            const handlers = this.listeners.get(event);
            if (handlers) {
                handlers.forEach((fn) => fn(...args));
            }
        });

        return this.socket;
    }

    disconnect() {
        this.socket?.disconnect();
        this.socket = null;
        this.listeners.clear();
    }

    sendMessage(content: string) {
        if (!this.socket?.connected) {
            throw new Error("Socket not connected");
        }
        this.socket.emit("send_message", { content });
    }

    regenerateMessage() {
        if (!this.socket?.connected) {
            throw new Error("Socket not connected");
        }
        this.socket.emit("regenerate_message");
    }

	editLastMessage(content: string) {
		if (!this.socket?.connected) {
			throw new Error("Socket not connected");
		}
		this.socket.emit("edit_last_message", { content });
	}

    /**
     * Subscribe to a socket event. Returns an unsubscribe function.
     */
    on(event: string, callback: Function): () => void {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, new Set());
        }
        this.listeners.get(event)!.add(callback);

        return () => {
            this.listeners.get(event)?.delete(callback);
        };
    }

    off(event: string, callback?: Function) {
        if (callback) {
            this.listeners.get(event)?.delete(callback);
        } else {
            this.listeners.delete(event);
        }
    }

    get isConnected(): boolean {
        return this.socket?.connected ?? false;
    }
}

export const socketService = new SocketService();
