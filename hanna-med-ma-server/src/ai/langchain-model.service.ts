import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatAnthropic } from "@langchain/anthropic";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

// Why two models:
//   - Gemini 2.5 Flash powers the Router agent in the doctor chat — UX
//     tolerates some flakiness, but latency is everything (doctor is
//     typing, waiting).
//   - Claude Sonnet 4.6 powers the AI Coder — tool use reliability and
//     ICD specificity beat Gemini on the medical-coding benchmark
//     (MAX-EVAL-11, Oct 2025). Slower per token but we're already at
//     60s/encounter; the extra 30–60s is worth the quality.

const CODER_MODEL = "claude-sonnet-4-6";

@Injectable()
export class LangChainModelService {
  private readonly logger = new Logger(LangChainModelService.name);
  private readonly routerModel: ChatGoogleGenerativeAI;
  private readonly coderModel: ChatAnthropic | null;

  constructor(private configService: ConfigService) {
    const geminiKey = this.configService.get<string>("SERVER_GEMINI_API_KEY");
    if (!geminiKey) {
      this.logger.warn(
        "SERVER_GEMINI_API_KEY not set — chat router will be unavailable",
      );
    }
    this.routerModel = new ChatGoogleGenerativeAI({
      model: "gemini-2.5-flash",
      apiKey: geminiKey || "",
      temperature: 0.3,
      streaming: true,
      safetySettings: [
        { category: "HARM_CATEGORY_HARASSMENT" as any, threshold: "BLOCK_NONE" as any },
        { category: "HARM_CATEGORY_HATE_SPEECH" as any, threshold: "BLOCK_NONE" as any },
        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT" as any, threshold: "BLOCK_NONE" as any },
        { category: "HARM_CATEGORY_DANGEROUS_CONTENT" as any, threshold: "BLOCK_NONE" as any },
      ],
    });

    const anthropicKey = this.configService.get<string>("SERVER_ANTHROPIC_API_KEY");
    if (!anthropicKey) {
      this.logger.warn(
        "SERVER_ANTHROPIC_API_KEY not set — AI Coder will be unavailable",
      );
      this.coderModel = null;
    } else {
      this.coderModel = new ChatAnthropic({
        model: CODER_MODEL,
        apiKey: anthropicKey,
        // Lower temperature for coding — this is a precision task, not
        // a creative one. Claude still deviates usefully around the
        // rationale text even at 0.2.
        temperature: 0.2,
        // Non-streaming for the coder: we wait for the whole proposal
        // at once (finalize_coding), there's no partial UI to update.
        streaming: false,
        maxTokens: 8192,
      });
    }
  }

  /** Gemini 2.5 Flash — used by the doctor-chat Router. */
  getModel(): ChatGoogleGenerativeAI {
    return this.routerModel;
  }

  /** Claude Sonnet 4.6 — used by the AI Coder agent. */
  getCoderModel(): BaseChatModel {
    if (!this.coderModel) {
      throw new Error(
        "Coder model not configured — set SERVER_ANTHROPIC_API_KEY",
      );
    }
    return this.coderModel;
  }
}
