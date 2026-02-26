import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { MessageRole, MessageType } from "@prisma/client";
import { PrismaService } from "../core/prisma.service";
import { AiService } from "../ai/ai.service";
import { JwtService } from "@nestjs/jwt";

interface MessageEventCallbacks {
	onToolCall?: (toolName: string) => void;
	onStreaming?: (chunk: string) => void;
}

@Injectable()
export class ChatService {
	private readonly logger = new Logger(ChatService.name);

	constructor(
		private prisma: PrismaService,
		private configService: ConfigService,
		private aiService: AiService,
		private jwtService: JwtService,
	) {}

	async getSession(doctorId: number, limit: number = 5, cursor?: number) {
		let session = await this.prisma.chatSession.findUnique({
			where: { doctorId },
			include: {
				doctor: { select: { id: true, name: true, specialty: true } },
			},
		});

		if (!session) {
			session = await this.prisma.chatSession.create({
				data: { doctorId },
				include: {
					doctor: { select: { id: true, name: true, specialty: true } },
				},
			});
		}

		const messages = await this.prisma.message.findMany({
			take: limit,
			skip: cursor ? 1 : 0,
			cursor: cursor ? { id: cursor } : undefined,
			where: { sessionId: session.id },
			orderBy: { id: "desc" },
		});

		return {
			...session,
			messages: messages.reverse(),
			nextCursor: messages.length === limit ? messages[0].id : undefined,
		};
	}

	/**
	 * Create a message (used by HTTP POST /chat endpoint as fallback).
	 * For WebSocket-based messaging, use sendMessageWithEvents().
	 */
	async createMessage(
		doctorId: number,
		content: string,
		role: MessageRole = MessageRole.USER,
		type: MessageType = MessageType.TEXT,
	) {
		let session = await this.prisma.chatSession.findUnique({
			where: { doctorId },
			include: {
				doctor: { select: { id: true, name: true, specialty: true } },
			},
		});

		if (!session) {
			session = await this.prisma.chatSession.create({
				data: { doctorId },
				include: {
					doctor: { select: { id: true, name: true, specialty: true } },
				},
			});
		}

		const message = await this.prisma.message.create({
			data: {
				sessionId: session.id,
				content,
				role,
				type,
			},
		});

		// If user sent a message, process it with AI
		if (role === MessageRole.USER) {
			this.processWithAi(doctorId, session, content);
		}

		return message;
	}

	/**
	 * Process a message with AI and save the response.
	 * Used as a fire-and-forget from createMessage() for HTTP fallback.
	 */
	private async processWithAi(doctorId: number, session: any, content: string) {
		try {
			const chatHistory = await this.prisma.message.findMany({
				where: { sessionId: session.id },
				orderBy: { createdAt: "desc" },
				take: 10,
				select: { role: true, content: true },
			});

			const aiResponse = await this.aiService.processMessage({
				doctorId,
				doctorName: session.doctor.name,
				doctorSpecialty: session.doctor.specialty || "General Medicine",
				userMessage: content,
				chatHistory: chatHistory.reverse().map((m) => ({
					role: m.role,
					content: m.content,
				})),
			});

			// Save AI response
			await this.prisma.message.create({
				data: {
					sessionId: session.id,
					content: aiResponse.text,
					role: MessageRole.ASSISTANT,
					type: (aiResponse.messageType as MessageType) || MessageType.TEXT,
				},
			});
		} catch (error) {
			this.logger.error(
				`AI processing error for doctor ${doctorId}: ${error.message}`,
			);
		}
	}

	/**
	 * Send a message with real-time event callbacks (WebSocket mode).
	 */
	async sendMessageWithEvents(
		doctorId: number,
		content: string,
		callbacks: MessageEventCallbacks,
	) {
		// Step 1: Get or create session
		let session = await this.prisma.chatSession.findUnique({
			where: { doctorId },
			include: {
				doctor: { select: { id: true, name: true, specialty: true } },
			},
		});

		if (!session) {
			session = await this.prisma.chatSession.create({
				data: { doctorId },
				include: {
					doctor: { select: { id: true, name: true, specialty: true } },
				},
			});
		}

		// Step 2: Save user message
		const userMessage = await this.prisma.message.create({
			data: {
				sessionId: session.id,
				content,
				role: MessageRole.USER,
				type: MessageType.TEXT,
			},
		});

		// Step 3: Get chat history for context
		const chatHistory = await this.prisma.message.findMany({
			where: { sessionId: session.id },
			orderBy: { createdAt: "desc" },
			take: 10,
			select: { role: true, content: true },
		});

		// Step 4: Process with AI (with event callbacks)
		const aiResponse = await this.aiService.processMessage({
			doctorId,
			doctorName: session.doctor.name,
			doctorSpecialty: session.doctor.specialty || "General Medicine",
			userMessage: content,
			chatHistory: chatHistory.reverse().map((m) => ({
				role: m.role,
				content: m.content,
			})),
			callbacks,
		});

		// Step 5: Save AI response
		const assistantMessage = await this.prisma.message.create({
			data: {
				sessionId: session.id,
				content: aiResponse.text,
				role: MessageRole.ASSISTANT,
				type: (aiResponse.messageType as MessageType) || MessageType.TEXT,
			},
		});

		return { userMessage, assistantMessage };
	}

	/**
	 * Delete the last assistant message and re-process the preceding user message.
	 */
	async regenerateLastMessage(
		doctorId: number,
		callbacks: MessageEventCallbacks,
	) {
		const session = await this.prisma.chatSession.findUnique({
			where: { doctorId },
			include: {
				doctor: { select: { id: true, name: true, specialty: true } },
			},
		});

		if (!session) throw new Error("No chat session found");

		const lastAssistantMsg = await this.prisma.message.findFirst({
			where: { sessionId: session.id, role: MessageRole.ASSISTANT },
			orderBy: { createdAt: "desc" },
		});

		if (!lastAssistantMsg)
			throw new Error("No assistant message to regenerate");

		const lastUserMsg = await this.prisma.message.findFirst({
			where: {
				sessionId: session.id,
				role: MessageRole.USER,
				createdAt: { lte: lastAssistantMsg.createdAt },
			},
			orderBy: { createdAt: "desc" },
		});

		if (!lastUserMsg)
			throw new Error("No user message found to regenerate from");

		await this.prisma.message.delete({
			where: { id: lastAssistantMsg.id },
		});

		this.logger.log(
			`Regenerating response for doctor ${doctorId} — deleted msg #${lastAssistantMsg.id}, re-processing "${lastUserMsg.content.substring(0, 50)}..."`,
		);

		const chatHistory = await this.prisma.message.findMany({
			where: { sessionId: session.id },
			orderBy: { createdAt: "desc" },
			take: 10,
			select: { role: true, content: true },
		});

		const aiResponse = await this.aiService.processMessage({
			doctorId,
			doctorName: session.doctor.name,
			doctorSpecialty: session.doctor.specialty || "General Medicine",
			userMessage: lastUserMsg.content,
			chatHistory: chatHistory.reverse().map((m) => ({
				role: m.role,
				content: m.content,
			})),
			callbacks,
		});

		const assistantMessage = await this.prisma.message.create({
			data: {
				sessionId: session.id,
				content: aiResponse.text,
				role: MessageRole.ASSISTANT,
				type: (aiResponse.messageType as MessageType) || MessageType.TEXT,
			},
		});

		return { assistantMessage };
	}

	/**
	 * Edit the last user message (paired with the last assistant message)
	 * and regenerate the assistant response using the updated content.
	 */
	async editLastMessage(
		doctorId: number,
		newContent: string,
		callbacks: MessageEventCallbacks,
	) {
		const session = await this.prisma.chatSession.findUnique({
			where: { doctorId },
			include: {
				doctor: { select: { id: true, name: true, specialty: true } },
			},
		});

		if (!session) throw new Error("No chat session found");

		const lastAssistantMsg = await this.prisma.message.findFirst({
			where: { sessionId: session.id, role: MessageRole.ASSISTANT },
			orderBy: { createdAt: "desc" },
		});

		if (!lastAssistantMsg) throw new Error("No assistant message to edit from");

		const lastUserMsg = await this.prisma.message.findFirst({
			where: {
				sessionId: session.id,
				role: MessageRole.USER,
				createdAt: { lte: lastAssistantMsg.createdAt },
			},
			orderBy: { createdAt: "desc" },
		});

		if (!lastUserMsg) throw new Error("No user message found to edit");

		// Update the last user message with the new content
		await this.prisma.message.update({
			where: { id: lastUserMsg.id },
			data: { content: newContent },
		});

		// Remove the old assistant message so a new one can be generated
		await this.prisma.message.delete({
			where: { id: lastAssistantMsg.id },
		});

		this.logger.log(
			`Editing last message for doctor ${doctorId} — updated user msg #${lastUserMsg.id}, regenerating assistant response...`,
		);

		const chatHistory = await this.prisma.message.findMany({
			where: { sessionId: session.id },
			orderBy: { createdAt: "desc" },
			take: 10,
			select: { role: true, content: true },
		});

		const aiResponse = await this.aiService.processMessage({
			doctorId,
			doctorName: session.doctor.name,
			doctorSpecialty: session.doctor.specialty || "General Medicine",
			userMessage: newContent,
			chatHistory: chatHistory.reverse().map((m) => ({
				role: m.role,
				content: m.content,
			})),
			callbacks,
		});

		const assistantMessage = await this.prisma.message.create({
			data: {
				sessionId: session.id,
				content: aiResponse.text,
				role: MessageRole.ASSISTANT,
				type: (aiResponse.messageType as MessageType) || MessageType.TEXT,
			},
		});

		return { assistantMessage };
	}

	/**
	 * Verify a JWT token and return the doctor info.
	 * Used by ChatGateway for WebSocket auth.
	 */
	async verifyToken(token: string) {
		try {
			const payload = this.jwtService.verify(token);
			const doctor = await this.prisma.doctor.findFirst({
				where: { id: payload.userId || payload.sub, deleted: false },
				select: { id: true, name: true, specialty: true },
			});
			return doctor;
		} catch {
			return null;
		}
	}
}
