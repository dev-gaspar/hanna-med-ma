import { Injectable, Logger } from "@nestjs/common";
import { LangChainModelService } from "../langchain-model.service";
import {
  getInsurancePrompt,
  getSummaryPrompt,
  getListPrompt,
  getLabPrompt,
  getConversationalPrompt,
  getCareTrackerInsurancePayloadPrompt,
} from "../prompts/sub-agents.prompt";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";

@Injectable()
export class SubAgentsService {
  private readonly logger = new Logger(SubAgentsService.name);

  constructor(private modelService: LangChainModelService) {}

  async formatInsurance(
    rawContent: string,
    context: { patientName: string; hospitalType: string; extractedAt: string },
    specificQuestion?: string,
    onStreaming?: (chunk: string) => void,
  ): Promise<string> {
    const prompt = specificQuestion
      ? getConversationalPrompt({
          patientName: context.patientName,
          hospitalType: context.hospitalType,
          specificQuestion,
        })
      : getInsurancePrompt(context);

    return this.invokeModel(
      prompt,
      `Raw Data Context:\n${rawContent}`,
      onStreaming,
    );
  }

  async formatSummary(
    rawContent: string,
    ctx: {
      patientName: string;
      hospitalType: string;
      extractedAt: string;
      doctorSpecialty: string;
    },
    specificQuestion?: string,
    onStreaming?: (chunk: string) => void,
  ): Promise<string> {
    const prompt = specificQuestion
      ? getConversationalPrompt({
          patientName: ctx.patientName,
          hospitalType: ctx.hospitalType,
          specificQuestion,
        })
      : getSummaryPrompt(ctx);

    return this.invokeModel(
      prompt,
      `Raw Data Context:\n${rawContent}`,
      onStreaming,
    );
  }

  async formatPatientList(
    patientsJson: string,
    context: { hospitalType: string; lastUpdated: string },
    specificQuestion?: string,
    onStreaming?: (chunk: string) => void,
  ): Promise<string> {
    const prompt = specificQuestion
      ? getConversationalPrompt({
          hospitalType: context.hospitalType,
          specificQuestion,
        })
      : getListPrompt(context);

    return this.invokeModel(
      prompt,
      `List Data Context:\n${patientsJson}`,
      onStreaming,
    );
  }

  async formatLab(
    rawContent: string,
    ctx: {
      patientName: string;
      hospitalType: string;
      extractedAt: string;
      doctorSpecialty: string;
    },
    specificQuestion?: string,
    onStreaming?: (chunk: string) => void,
  ): Promise<string> {
    const prompt = specificQuestion
      ? getConversationalPrompt({
          patientName: ctx.patientName,
          hospitalType: ctx.hospitalType,
          specificQuestion,
        })
      : getLabPrompt(ctx);

    return this.invokeModel(
      prompt,
      `Raw Lab Data Context:\n${rawContent}`,
      onStreaming,
    );
  }

  async formatCareTrackerInsurancePayload(
    rawContent: string,
    ctx: { extractedAt: string },
  ): Promise<string> {
    const prompt = getCareTrackerInsurancePayloadPrompt({
      extractedAt: ctx.extractedAt,
    });

    return this.invokeModel(prompt, `Raw Data Context:\n${rawContent}`);
  }

  private async invokeModel(
    systemPrompt: string,
    humanContent: string,
    onStreaming?: (chunk: string) => void,
  ): Promise<string> {
    const model = this.modelService.getModel();

    try {
      if (onStreaming) {
        let fullContent = "";
        const stream = await model.stream([
          new SystemMessage(systemPrompt),
          new HumanMessage(humanContent),
        ]);
        for await (const chunk of stream) {
          if (chunk.content) {
            fullContent += chunk.content;
            onStreaming(chunk.content as string);
          }
        }
        return fullContent;
      }

      const response = await model.invoke([
        new SystemMessage(systemPrompt),
        new HumanMessage(humanContent),
      ]);

      return response.content as string;
    } catch (error) {
      this.logger.error(`SubAgent invocation failed: ${error.message}`);
      return "I apologize, Doctor. I encountered an error while formatting this data.";
    }
  }
}
