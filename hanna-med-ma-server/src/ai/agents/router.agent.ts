import { Injectable, Logger } from "@nestjs/common";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { tool } from "@langchain/core/tools";
import {
  HumanMessage,
  AIMessage,
  BaseMessageChunk,
} from "@langchain/core/messages";
import { z } from "zod";
import { LangChainModelService } from "../langchain-model.service";
import { getRouterPrompt } from "../prompts/router.prompt";
import {
  PatientListTool,
  BatchPatientListTool,
} from "../tools/patient-list.tools";
import {
  PatientSummaryTool,
  BatchPatientSummaryTool,
} from "../tools/patient-summary.tools";
import {
  PatientInsuranceTool,
  BatchPatientInsuranceTool,
} from "../tools/patient-insurance.tools";
import { FindPatientContextTool } from "../tools/find-patient-context.tool";

interface DoctorContext {
  doctorId: number;
  doctorName: string;
  doctorSpecialty: string;
}

@Injectable()
export class RouterAgent {
  private readonly logger = new Logger(RouterAgent.name);

  constructor(
    private modelService: LangChainModelService,
    private patientListTool: PatientListTool,
    private batchPatientListTool: BatchPatientListTool,
    private patientSummaryTool: PatientSummaryTool,
    private batchPatientSummaryTool: BatchPatientSummaryTool,
    private patientInsuranceTool: PatientInsuranceTool,
    private batchPatientInsuranceTool: BatchPatientInsuranceTool,
    private findPatientContextTool: FindPatientContextTool,
  ) {}

  async processMessage(
    doctorContext: DoctorContext,
    userMessage: string,
    chatHistory: Array<{ role: string; content: string }>,
    callbacks?: {
      onToolCall?: (toolName: string) => void;
      onStreaming?: (chunk: string) => void;
    },
  ): Promise<string> {
    const systemPrompt = getRouterPrompt({
      doctorName: doctorContext.doctorName,
      doctorSpecialty: doctorContext.doctorSpecialty,
      currentTime: new Date().toLocaleTimeString("en-US", {
        timeZone: "America/New_York",
        hour: "2-digit",
        minute: "2-digit",
      }),
    });

    let fullText = "";
    let streamedFromTools = "";
    let isMuted = false;
    const toolsNotified = new Set<string>();

    const toolCallbacks = {
      onStreaming: (chunk: string) => {
        streamedFromTools += chunk;
        callbacks?.onStreaming?.(chunk);
      }
    };

    const tools = this.buildTools(doctorContext, toolCallbacks);

    const agent = createReactAgent({
      llm: this.modelService.getModel(),
      tools,
      prompt: systemPrompt,
    });

    const messages = chatHistory
      .slice(-10)
      .map((m) =>
        m.role === "USER"
          ? new HumanMessage(m.content)
          : new AIMessage(m.content),
      );
    messages.push(new HumanMessage(userMessage));

    this.logger.log(
      `Starting LangGraph agent stream for doctor ${doctorContext.doctorId}`,
    );

    try {
      const stream = await agent.stream(
        { messages },
        { streamMode: "messages" },
      );

      let chunkIndex = 0;
      for await (const item of stream as AsyncIterable<any>) {
        const [message, metadata] = Array.isArray(item) ? item : [item, {}];
        const chunk = message as any;
        const nodeType = metadata?.langgraph_node || "unknown";
        const msgType = chunk?.constructor?.name || typeof chunk;
        chunkIndex++;

        // --- Detect tool calls ---
        // Method 1: From ToolMessage (most reliable for Google Gemini)
        if (msgType === "ToolMessage" || chunk.tool_call_id) {
          const toolName = chunk.name || "unknown_tool";
          if (!toolsNotified.has(toolName)) {
            toolsNotified.add(toolName);
            this.logger.log(`🔧 Tool executed: ${toolName}`);
            callbacks?.onToolCall?.(toolName);
          }
          if (["query_patient_summary", "query_batch_patient_summary", "query_patient_insurance", "query_batch_patient_insurance", "query_patient_list", "query_batch_patient_list"].includes(toolName)) {
             isMuted = true;
          }
        }

        // Method 2: From AIMessage tool_calls/tool_call_chunks
        if (chunk.tool_call_chunks?.length > 0) {
          for (const tc of chunk.tool_call_chunks) {
            if (tc.name && !toolsNotified.has(tc.name)) {
              toolsNotified.add(tc.name);
              this.logger.log(`🔧 Tool call (chunk): ${tc.name}`);
              callbacks?.onToolCall?.(tc.name);
            }
          }
        }
        if (chunk.tool_calls?.length > 0) {
          for (const tc of chunk.tool_calls) {
            if (tc.name && !toolsNotified.has(tc.name)) {
              toolsNotified.add(tc.name);
              this.logger.log(`🔧 Tool call: ${tc.name}`);
              callbacks?.onToolCall?.(tc.name);
            }
          }
        }

        // --- Extract streaming text from agent node ---
        if (nodeType === "agent") {
          if (isMuted) continue;

          const text = this.extractTextContent(chunk);
          if (text) {
            fullText += text;
            callbacks?.onStreaming?.(text);
          }
        }
      }

      this.logger.log(
        `Stream completed: ${chunkIndex} chunks | ${toolsNotified.size} tools called | ${fullText.length} chars`,
      );
    } catch (error) {
      this.logger.error(`LangGraph agent error: ${error.message}`, error.stack);
      throw error;
    }

    const finalResult = (fullText + "\\n" + streamedFromTools).trim();

    if (!finalResult) {
      this.logger.warn("Agent returned empty text — returning fallback");
      return "I apologize, Doctor. I experienced a momentary issue. Please try again.";
    }

    return finalResult;
  }

  private extractTextContent(chunk: any): string {
    if (typeof chunk.content === "string") {
      return chunk.content;
    }
    if (Array.isArray(chunk.content)) {
      return chunk.content
        .filter((p: any) => typeof p === "string" || p?.type === "text")
        .map((p: any) => (typeof p === "string" ? p : p.text || ""))
        .join("");
    }
    if (chunk.text) {
      return chunk.text;
    }
    return "";
  }

  private buildTools(
    ctx: DoctorContext,
    callbacks?: { onStreaming?: (chunk: string) => void }
  ) {
    const hospitalEnum = z.enum(["JACKSON", "STEWARD", "BAPTIST"]);

    return [
      tool(
        async ({ hospital_type, specific_question }) => {
          return this.patientListTool.execute(
            { hospital_type, specific_question },
            { doctorId: ctx.doctorId, doctorName: ctx.doctorName },
            callbacks
          );
        },
        {
          name: "query_patient_list",
          description:
            "Get patient census/list from one hospital EMR. Use for 'list', 'census', 'patients' for ONE hospital.",
          schema: z.object({
            hospital_type: hospitalEnum.describe(
              "Hospital EMR system to query",
            ),
            specific_question: z
              .string()
              .optional()
              .describe(
                "If the doctor asks a specific question about the list",
              ),
          }),
        },
      ),
      tool(
        async ({ hospital_types, specific_question }) => {
          return this.batchPatientListTool.execute(
            { hospital_types, specific_question },
            { doctorId: ctx.doctorId, doctorName: ctx.doctorName },
            callbacks
          );
        },
        {
          name: "query_batch_patient_list",
          description:
            "Get patient lists from multiple hospitals at once. Use for 'all my lists', 'every hospital'.",
          schema: z.object({
            hospital_types: z
              .array(hospitalEnum)
              .describe("Array of hospital types to query"),
            specific_question: z
              .string()
              .optional()
              .describe("Specific question about the lists"),
          }),
        },
      ),
      tool(
        async ({ hospital_type, patient_name, specific_question }) => {
          return this.patientSummaryTool.execute(
            { hospital_type, patient_name, specific_question },
            { doctorId: ctx.doctorId, doctorSpecialty: ctx.doctorSpecialty },
            callbacks
          );
        },
        {
          name: "query_patient_summary",
          description: "Get clinical summary for a single patient.",
          schema: z.object({
            hospital_type: hospitalEnum.describe("Hospital EMR system"),
            patient_name: z.string().describe("Patient full name"),
            specific_question: z
              .string()
              .optional()
              .describe(
                "If the doctor asks a specific question instead of generic report",
              ),
          }),
        },
      ),
      tool(
        async ({ hospital_type, patient_names, specific_question }) => {
          return this.batchPatientSummaryTool.execute(
            { hospital_type, patient_names, specific_question },
            { doctorId: ctx.doctorId, doctorSpecialty: ctx.doctorSpecialty },
            callbacks
          );
        },
        {
          name: "query_batch_patient_summary",
          description:
            "Get clinical summaries for multiple patients in one hospital.",
          schema: z.object({
            hospital_type: hospitalEnum.describe("Hospital EMR system"),
            patient_names: z
              .array(z.string())
              .describe("Array of patient names"),
            specific_question: z
              .string()
              .optional()
              .describe("Specific question"),
          }),
        },
      ),
      tool(
        async ({ hospital_type, patient_name, specific_question }) => {
          return this.patientInsuranceTool.execute(
            { hospital_type, patient_name, specific_question },
            { doctorId: ctx.doctorId },
            callbacks
          );
        },
        {
          name: "query_patient_insurance",
          description: "Get insurance information for a patient.",
          schema: z.object({
            hospital_type: hospitalEnum.describe("Hospital EMR system"),
            patient_name: z.string().describe("Patient full name"),
            specific_question: z
              .string()
              .optional()
              .describe(
                "If the doctor asks a specific question instead of generic report",
              ),
          }),
        },
      ),
      tool(
        async ({ hospital_type, patient_names, specific_question }) => {
          return this.batchPatientInsuranceTool.execute(
            { hospital_type, patient_names, specific_question },
            { doctorId: ctx.doctorId },
            callbacks
          );
        },
        {
          name: "query_batch_patient_insurance",
          description: "Get insurance for multiple patients at one hospital.",
          schema: z.object({
            hospital_type: hospitalEnum.describe("Hospital EMR system"),
            patient_names: z
              .array(z.string())
              .describe("Array of patient names"),
            specific_question: z.string().optional(),
          }),
        },
      ),
      tool(
        async ({ patient_names }) => {
          return this.findPatientContextTool.execute(
            { patient_names },
            { doctorId: ctx.doctorId },
          );
        },
        {
          name: "find_patient_context",
          description:
            "Locate which hospital a patient is in, or discover all active patients. Use patient_names=['ALL_PATIENTS'] to get all patients grouped by hospital.",
          schema: z.object({
            patient_names: z
              .array(z.string())
              .describe("Patient names to locate, or ['ALL_PATIENTS'] for all"),
          }),
        },
      ),
    ];
  }
}
