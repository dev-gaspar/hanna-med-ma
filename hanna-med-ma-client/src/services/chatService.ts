import api from "../lib/api";
import type { ChatSession, Message } from "../types/chat";

export const chatService = {
    async getHistory(limit: number = 5, cursor?: number): Promise<ChatSession> {
        const params = new URLSearchParams();
        if (limit) params.append('limit', limit.toString());
        if (cursor) params.append('cursor', cursor.toString());

        const response = await api.get<ChatSession>(`/chat?${params.toString()}`);
        return response.data;
    },

    async sendMessage(content: string): Promise<Message> {
        const response = await api.post<Message>("/chat", { content });
        return response.data;
    },
};
