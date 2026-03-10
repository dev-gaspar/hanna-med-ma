import { Injectable, Logger } from "@nestjs/common";
import { LangChainModelService } from "../langchain-model.service";
import {
  getInsurancePrompt,
  getSummaryPrompt,
  getListPrompt,
  getConversationalPrompt,
} from "../prompts/sub-agents.prompt";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";

@Injectable()
export class SubAgentsService {
  private readonly logger = new Logger(SubAgentsService.name);

  constructor(private modelService: LangChainModelService) {}

  async formatInsurance(
    rawContent: string,
    ctx: { patientName: string; hospitalType: string; extractedAt: string },
    specificQuestion?: string,
  ): Promise<string> {
    const prompt = specificQuestion
      ? getConversationalPrompt({
          patientName: ctx.patientName,
          hospitalType: ctx.hospitalType,
          specificQuestion,
        })
      : getInsurancePrompt(ctx);

    return this.invokeModel(prompt, rawContent);
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
  ): Promise<string> {
    const prompt = specificQuestion
      ? getConversationalPrompt({
          patientName: ctx.patientName,
          hospitalType: ctx.hospitalType,
          specificQuestion,
        })
      : getSummaryPrompt(ctx);

    return this.invokeModel(prompt, rawContent);
  }

  async formatPatientList(
    patientsData: string,
    ctx: { hospitalType: string; lastUpdated: string },
    specificQuestion?: string,
  ): Promise<string> {
    const prompt = specificQuestion
      ? getConversationalPrompt({
          hospitalType: ctx.hospitalType,
          specificQuestion,
        })
      : getListPrompt(ctx);

    return this.invokeModel(prompt, patientsData);
  }

  private async invokeModel(
    systemPrompt: string,
    humanContent: string,
  ): Promise<string> {
    const model = this.modelService.getModel();

    try {
      const response = await model.invoke([
        new SystemMessage(systemPrompt),
        new HumanMessage(`Raw Data Context:\\n${humanContent}`),
      ]);

      return response.content as string;
    } catch (error) {
      this.logger.error(`SubAgent invocation failed: ${error.message}`);
      return "I apologize, Doctor. I encountered an error while formatting this data.";
    }
  }
}
