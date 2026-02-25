import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";

@Injectable()
export class LangChainModelService {
  private readonly logger = new Logger(LangChainModelService.name);
  private readonly model: ChatGoogleGenerativeAI;

  constructor(private configService: ConfigService) {
    const apiKey = this.configService.get<string>("SERVER_GEMINI_API_KEY");
    if (!apiKey) {
      this.logger.warn(
        "SERVER_GEMINI_API_KEY not set — AI features will be unavailable",
      );
    }

    this.model = new ChatGoogleGenerativeAI({
      model: "gemini-2.5-flash",
      apiKey: apiKey || "",
      temperature: 0.3,
      streaming: true,
    });
  }

  getModel(): ChatGoogleGenerativeAI {
    return this.model;
  }
}
