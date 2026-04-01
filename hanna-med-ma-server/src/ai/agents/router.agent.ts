import { Injectable, Logger } from "@nestjs/common";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { tool } from "@langchain/core/tools";
import {
  HumanMessage,
  AIMessage,
  BaseMessageChunk,
} from "@langchain/core/messages";
import { z } from "zod";
import { currentTimeForDisplay } from "../../core/date.util";
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
import {
  PatientLabTool,
  BatchPatientLabTool,
} from "../tools/patient-lab.tools";
import { PatientSeenTool } from "../tools/patient-seen.tools";

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
    private patientLabTool: PatientLabTool,
    private batchPatientLabTool: BatchPatientLabTool,
    private findPatientContextTool: FindPatientContextTool,
    private patientSeenTool: PatientSeenTool,
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
      currentTime: currentTimeForDisplay(),
    });

    let finalResult = "";

    for (let attempt = 1; attempt <= 2; attempt++) {
      let fullText = "";
      let streamedFromTools = "";
      let isMuted = false;
      const toolsNotified = new Set<string>();

      const toolCallbacks = {
        onStreaming: (chunk: string) => {
          streamedFromTools += chunk;
          callbacks?.onStreaming?.(chunk);
        },
        onToolCall: (toolName: string) => {
          if (!toolsNotified.has(toolName)) {
            toolsNotified.add(toolName);
            this.logger.log(`🔧 Tool executed (forced prior): ${toolName}`);
            callbacks?.onToolCall?.(toolName);
          }
        },
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

      if (attempt > 1) {
        this.logger.warn(
          `Retrying LangGraph agent stream for doctor ${doctorContext.doctorId} (attempt ${attempt})`,
        );
      } else {
        this.logger.log(
          `Starting LangGraph agent stream for doctor ${doctorContext.doctorId}`,
        );
      }

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

          // Extreme logging for debugging empty responses
          if (attempt === 1 && chunkIndex === 1) {
            this.logger.debug(
              `[DEBUG EMPTY] First chunk of attempt 1: msgType=${msgType}, nodeType=${nodeType}, content=${JSON.stringify(chunk.content)}, tool_calls=${JSON.stringify(chunk.tool_calls)}, tool_call_chunks=${JSON.stringify(chunk.tool_call_chunks)}`,
            );
          }

          // --- Detect tool calls ---
          // Method 1: From ToolMessage (most reliable for Google Gemini streams)
          if (msgType === "ToolMessage" || chunk.tool_call_id) {
            const toolName = chunk.name || "unknown_tool";
            if (!toolsNotified.has(toolName) && toolName !== "unknown_tool") {
              toolsNotified.add(toolName);
              this.logger.log(`🔧 Tool executed: ${toolName}`);
              callbacks?.onToolCall?.(toolName);
            }
            if (
              [
                "query_patient_summary",
                "query_batch_patient_summary",
                "query_patient_insurance",
                "query_batch_patient_insurance",
                "query_patient_list",
                "query_batch_patient_list",
                "query_patient_lab",
                "query_batch_patient_lab",
                "query_patient_seen",
              ].includes(toolName)
            ) {
              isMuted = true;
            }
          }

          // Method 2: From AIMessage chunks
          if (chunk.tool_call_chunks?.length > 0) {
            for (const tc of chunk.tool_call_chunks) {
              if (tc.name && !toolsNotified.has(tc.name)) {
                toolsNotified.add(tc.name);
                this.logger.log(`🔧 Tool requested (chunk): ${tc.name}`);
                callbacks?.onToolCall?.(tc.name);
              }
            }
          }
          if (chunk.tool_calls?.length > 0) {
            for (const tc of chunk.tool_calls) {
              // LangGraph sometimes sends full tool_calls in an AIMessage
              if (tc.name && !toolsNotified.has(tc.name)) {
                toolsNotified.add(tc.name);
                this.logger.log(`🔧 Tool requested: ${tc.name}`);
                callbacks?.onToolCall?.(tc.name);
              }
            }
          }

          // --- Extract streaming text from agent node ---
          if (nodeType === "agent") {
            // If we successfully streamed markdown from a SubAgent, ignore the Router LLM's attempt to hallucinate/summarize it
            if (isMuted && streamedFromTools.length > 0) continue;

            const text = this.extractTextContent(chunk);
            if (text) {
              // Mute logic: don't append if we already printed stuff from SubAgents
              if (isMuted && streamedFromTools.length > 0) continue;

              fullText += text;
              callbacks?.onStreaming?.(text);
            }
          }
        }

        this.logger.log(
          `Stream completed: ${chunkIndex} chunks | ${toolsNotified.size} tools called | ${fullText.length} chars`,
        );
      } catch (error) {
        this.logger.error(
          `LangGraph agent error: ${error.message}`,
          error.stack,
        );
        if (attempt === 2) throw error;
      }

      const combinedResult = (streamedFromTools + "\n" + fullText).trim();
      if (combinedResult) {
        finalResult = combinedResult;
        break;
      }
    }

    if (!finalResult) {
      this.logger.warn(
        "Agent returned empty text after all attempts — returning fallback",
      );
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
    callbacks?: {
      onStreaming?: (chunk: string) => void;
      onToolCall?: (toolName: string) => void;
    },
  ) {
    const hospitalEnum = z
      .string()
      .describe(
        "Hospital EMR system (must be uppercase, e.g. JACKSON, STEWARD, BAPTIST)",
      );

    return [
      tool(
        async ({ hospital_type, specific_question }) => {
          callbacks?.onToolCall?.("query_patient_list");
          return this.patientListTool.execute(
            { hospital_type: hospital_type.toUpperCase(), specific_question },
            { doctorId: ctx.doctorId, doctorName: ctx.doctorName },
            callbacks,
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
          callbacks?.onToolCall?.("query_batch_patient_list");
          return this.batchPatientListTool.execute(
            {
              hospital_types: hospital_types.map((h) => h.toUpperCase()),
              specific_question,
            },
            { doctorId: ctx.doctorId, doctorName: ctx.doctorName },
            callbacks,
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
          callbacks?.onToolCall?.("query_patient_summary");
          return this.patientSummaryTool.execute(
            {
              hospital_type: hospital_type.toUpperCase(),
              patient_name,
              specific_question,
            },
            { doctorId: ctx.doctorId, doctorSpecialty: ctx.doctorSpecialty },
            callbacks,
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
          callbacks?.onToolCall?.("query_batch_patient_summary");
          return this.batchPatientSummaryTool.execute(
            {
              hospital_type: hospital_type.toUpperCase(),
              patient_names,
              specific_question,
            },
            { doctorId: ctx.doctorId, doctorSpecialty: ctx.doctorSpecialty },
            callbacks,
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
          callbacks?.onToolCall?.("query_patient_insurance");
          return this.patientInsuranceTool.execute(
            {
              hospital_type: hospital_type.toUpperCase(),
              patient_name,
              specific_question,
            },
            { doctorId: ctx.doctorId },
            callbacks,
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
          callbacks?.onToolCall?.("query_batch_patient_insurance");
          return this.batchPatientInsuranceTool.execute(
            {
              hospital_type: hospital_type.toUpperCase(),
              patient_names,
              specific_question,
            },
            { doctorId: ctx.doctorId },
            callbacks,
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
        async ({ hospital_type, patient_name, specific_question }) => {
          callbacks?.onToolCall?.("query_patient_lab");
          return this.patientLabTool.execute(
            {
              hospital_type: hospital_type.toUpperCase(),
              patient_name,
              specific_question,
            },
            { doctorId: ctx.doctorId, doctorSpecialty: ctx.doctorSpecialty },
            callbacks,
          );
        },
        {
          name: "query_patient_lab",
          description:
            "Get the most recent lab results on file for a single patient.",
          schema: z.object({
            hospital_type: hospitalEnum.describe("Hospital EMR system"),
            patient_name: z.string().describe("Patient full name"),
            specific_question: z
              .string()
              .optional()
              .describe(
                "If the doctor asks a specific question about lab values instead of the full report",
              ),
          }),
        },
      ),
      tool(
        async ({ hospital_type, patient_names, specific_question }) => {
          callbacks?.onToolCall?.("query_batch_patient_lab");
          return this.batchPatientLabTool.execute(
            {
              hospital_type: hospital_type.toUpperCase(),
              patient_names,
              specific_question,
            },
            { doctorId: ctx.doctorId, doctorSpecialty: ctx.doctorSpecialty },
            callbacks,
          );
        },
        {
          name: "query_batch_patient_lab",
          description:
            "Get the most recent lab results on file for multiple patients at one hospital.",
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
          callbacks?.onToolCall?.("find_patient_context");
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
      tool(
        async ({ hospital_types, specific_question }) => {
          callbacks?.onToolCall?.("query_patient_seen");
          return this.patientSeenTool.execute(
            { hospital_types: hospital_types?.map((h) => h.toUpperCase()), specific_question },
            { doctorId: ctx.doctorId, doctorName: ctx.doctorName },
            callbacks,
          );
        },
        {
          name: "query_patient_seen",
          description:
            "Find patients that the doctor has ALREADY MARKED AS SEEN. Use when asked 'which patients have I seen?', 'did I see anyone from Jackson?', etc.",
          schema: z.object({
            hospital_types: z
              .array(hospitalEnum)
              .optional()
              .describe("Optional array of hospital systems to filter by"),
            specific_question: z
              .string()
              .optional()
              .describe("Specific question about the seen patients"),
          }),
        },
      ),
    ];
  }
}
