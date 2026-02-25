import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from "@nestjs/websockets";
import { Server, Socket } from "socket.io";
import { Logger } from "@nestjs/common";
import { ChatService } from "./chat.service";

@WebSocketGateway({
  cors: { origin: "*" },
  namespace: "/chat",
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(ChatGateway.name);
  private connectedDoctors = new Map<number, string>();

  constructor(private chatService: ChatService) {}

  async handleConnection(client: Socket) {
    try {
      const token =
        client.handshake.auth?.token ||
        client.handshake.headers?.authorization?.replace("Bearer ", "");

      if (!token) {
        client.disconnect();
        return;
      }

      const doctor = await this.chatService.verifyToken(token);
      if (!doctor) {
        client.disconnect();
        return;
      }

      (client as any).doctorId = doctor.id;
      client.join(`doctor_${doctor.id}`);
      this.connectedDoctors.set(doctor.id, client.id);

      this.logger.log(`Doctor ${doctor.name} connected (Socket: ${client.id})`);
    } catch (error) {
      this.logger.error(`Connection error: ${error.message}`);
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    const doctorId = (client as any).doctorId;
    if (doctorId) {
      this.connectedDoctors.delete(doctorId);
      this.logger.log(`Doctor ${doctorId} disconnected`);
    }
  }

  @SubscribeMessage("send_message")
  async handleMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { content: string },
  ) {
    const doctorId = (client as any).doctorId;
    if (!doctorId) return;

    const room = `doctor_${doctorId}`;

    try {
      // Step 1: Emit "thinking" indicator
      this.server.to(room).emit("ai_thinking", { status: true });

      // Step 2: Process message with AI (real-time events)
      let streamChunkCount = 0;
      const result = await this.chatService.sendMessageWithEvents(
        doctorId,
        body.content,
        {
          onToolCall: (toolName: string) => {
            this.logger.log(
              `📡 Emitting ai_tool_call: ${toolName} → room ${room}`,
            );
            this.server.to(room).emit("ai_tool_call", {
              tool: toolName,
              message: this.getToolDescription(toolName),
            });
          },
          onStreaming: (chunk: string) => {
            streamChunkCount++;
            if (streamChunkCount <= 3 || streamChunkCount % 50 === 0) {
              this.logger.debug(
                `📡 Streaming chunk #${streamChunkCount} (${chunk.length} chars) → room ${room}`,
              );
            }
            this.server.to(room).emit("ai_streaming", { chunk });
          },
        },
      );
      this.logger.log(`📡 Stream complete: ${streamChunkCount} chunks emitted`);

      // Step 3: Emit complete response
      this.server.to(room).emit("ai_response_complete", {
        message: result.assistantMessage,
      });
    } catch (error) {
      this.logger.error(`Message processing error: ${error.message}`);
      this.server.to(room).emit("error", {
        message: "I apologize, Doctor. Something went wrong. Please try again.",
      });
    } finally {
      this.server.to(room).emit("ai_thinking", { status: false });
    }
  }

  @SubscribeMessage("regenerate_message")
  async handleRegenerate(@ConnectedSocket() client: Socket) {
    const doctorId = (client as any).doctorId;
    if (!doctorId) return;

    const room = `doctor_${doctorId}`;

    try {
      this.server.to(room).emit("ai_thinking", { status: true });

      let streamChunkCount = 0;
      const result = await this.chatService.regenerateLastMessage(doctorId, {
        onToolCall: (toolName: string) => {
          this.server.to(room).emit("ai_tool_call", {
            tool: toolName,
            message: this.getToolDescription(toolName),
          });
        },
        onStreaming: (chunk: string) => {
          streamChunkCount++;
          if (streamChunkCount <= 3 || streamChunkCount % 50 === 0) {
            this.logger.debug(
              `📡 Regen chunk #${streamChunkCount} (${chunk.length} chars) → room ${room}`,
            );
          }
          this.server.to(room).emit("ai_streaming", { chunk });
        },
      });

      this.logger.log(
        `📡 Regeneration complete: ${streamChunkCount} chunks emitted`,
      );

      this.server.to(room).emit("ai_response_complete", {
        message: result.assistantMessage,
      });
    } catch (error) {
      this.logger.error(`Regeneration error: ${error.message}`);
      this.server.to(room).emit("error", {
        message:
          "I apologize, Doctor. Something went wrong. Please try again.",
      });
    } finally {
      this.server.to(room).emit("ai_thinking", { status: false });
    }
  }

  @SubscribeMessage("edit_last_message")
  async handleEditLastMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { content: string },
  ) {
    const doctorId = (client as any).doctorId;
    if (!doctorId) return;

    const room = `doctor_${doctorId}`;

    try {
      this.server.to(room).emit("ai_thinking", { status: true });

      let streamChunkCount = 0;
      const result = await this.chatService.editLastMessage(
        doctorId,
        body.content,
        {
          onToolCall: (toolName: string) => {
            this.server.to(room).emit("ai_tool_call", {
              tool: toolName,
              message: this.getToolDescription(toolName),
            });
          },
          onStreaming: (chunk: string) => {
            streamChunkCount++;
            if (streamChunkCount <= 3 || streamChunkCount % 50 === 0) {
              this.logger.debug(
                `📡 Edit chunk #${streamChunkCount} (${chunk.length} chars) → room ${room}`,
              );
            }
            this.server.to(room).emit("ai_streaming", { chunk });
          },
        },
      );

      this.logger.log(
        `📡 Edit complete: ${streamChunkCount} chunks emitted for doctor ${doctorId}`,
      );

      this.server.to(room).emit("ai_response_complete", {
        message: result.assistantMessage,
      });
    } catch (error) {
      this.logger.error(`Edit message error: ${error.message}`);
      this.server.to(room).emit("error", {
        message:
          "I apologize, Doctor. Something went wrong. Please try again.",
      });
    } finally {
      this.server.to(room).emit("ai_thinking", { status: false });
    }
  }

  /**
   * Emit an event to a specific doctor's room (used by other services).
   */
  emitToDoctor(doctorId: number, event: string, data: any) {
    this.server.to(`doctor_${doctorId}`).emit(event, data);
  }

  private getToolDescription(toolName: string): string {
    const descriptions: Record<string, string> = {
      query_patient_list: "Looking up patient list...",
      query_batch_patient_list: "Fetching lists from multiple hospitals...",
      query_patient_summary: "Retrieving clinical summary...",
      query_batch_patient_summary: "Processing batch summaries...",
      find_patient_context: "Locating patient across hospitals...",
      query_patient_insurance: "Checking insurance information...",
      query_batch_patient_insurance: "Processing batch insurance data...",
    };
    return descriptions[toolName] || "Processing your request...";
  }
}
