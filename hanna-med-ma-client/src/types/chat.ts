export interface Message {
    id: number;
    content: string;
    role: 'USER' | 'ASSISTANT';
    type: string;
    createdAt: string;
}

export interface ChatSession {
    id: number;
    doctorId: number;
    messages: Message[];
    nextCursor?: number;
}
