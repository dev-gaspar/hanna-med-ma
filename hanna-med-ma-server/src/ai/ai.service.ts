import { Injectable, Logger } from "@nestjs/common";
import { RouterAgent } from "./agents/router.agent";

interface ProcessMessageInput {
  doctorId: number;
  doctorName: string;
  doctorSpecialty: string;
  userMessage: string;
  chatHistory: Array<{ role: string; content: string }>;
  callbacks?: {
    onToolCall?: (toolName: string) => void;
    onStreaming?: (chunk: string) => void;
  };
}

interface ProcessMessageOutput {
  text: string;
  messageType: string;
}

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(private routerAgent: RouterAgent) {}

  async processMessage(
    input: ProcessMessageInput,
  ): Promise<ProcessMessageOutput> {
    this.logger.log(
      `Processing message for doctor ${input.doctorId}: "${input.userMessage.substring(0, 50)}..."`,
    );

    try {
      const responseText = await this.routerAgent.processMessage(
        {
          doctorId: input.doctorId,
          doctorName: input.doctorName,
          doctorSpecialty: input.doctorSpecialty,
        },
        input.userMessage,
        input.chatHistory,
        input.callbacks,
      );

      const messageType = this.inferMessageType(responseText);

      return { text: responseText, messageType };
    } catch (error) {
      this.logger.error(`AI processing error: ${error.message}`);
      return {
        text: "I apologize, Doctor. I'm experiencing a temporary issue. Please try again in a moment.",
        messageType: "TEXT",
      };
    }
  }

  private inferMessageType(text: string): string {
    if (text.includes("CLINICAL SUMMARY")) {
      return text.includes("---") ? "BATCH_PATIENT_SUMMARY" : "PATIENT_SUMMARY";
    }
    if (text.includes("INSURANCE INFORMATION")) {
      return text.includes("---")
        ? "BATCH_PATIENT_INSURANCE"
        : "PATIENT_INSURANCE";
    }
    if (text.includes("├") || text.includes("└")) {
      return "PATIENT_LIST";
    }
    return "TEXT";
  }
}
