import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatAnthropic } from "@langchain/anthropic";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

// Why multiple models:
//   - Gemini 2.5 Flash powers the Router agent in the doctor chat — UX
//     tolerates some flakiness, but latency is everything (doctor is
//     typing, waiting).
//   - Claude Sonnet 4.6 powers the AI Coder in production — tool use
//     reliability and ICD specificity beat Gemini on the medical-coding
//     benchmark (MAX-EVAL-11, Oct 2025).
//   - Claude Haiku 4.5 is available as an alternate for batch validation
//     / development. ~3x faster, ~1/5 the cost, and 7x the tier-1 rate
//     limit (200k vs 30k input tokens/min) — enough to run 50-encounter
//     batches without 429 stalls. Quality is a half-step below Sonnet
//     on complex reasoning but fine for coding-benchmark baselines.

const CODER_MODEL_SONNET = "claude-sonnet-4-6";
const CODER_MODEL_HAIKU = "claude-haiku-4-5-20251001";

@Injectable()
export class LangChainModelService {
  private readonly logger = new Logger(LangChainModelService.name);
  private readonly routerModel: ChatGoogleGenerativeAI;
  private readonly coderModelSonnet: ChatAnthropic | null;
  private readonly coderModelHaiku: ChatAnthropic | null;

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
        {
          category: "HARM_CATEGORY_HARASSMENT" as any,
          threshold: "BLOCK_NONE" as any,
        },
        {
          category: "HARM_CATEGORY_HATE_SPEECH" as any,
          threshold: "BLOCK_NONE" as any,
        },
        {
          category: "HARM_CATEGORY_SEXUALLY_EXPLICIT" as any,
          threshold: "BLOCK_NONE" as any,
        },
        {
          category: "HARM_CATEGORY_DANGEROUS_CONTENT" as any,
          threshold: "BLOCK_NONE" as any,
        },
      ],
    });

    const anthropicKey = this.configService.get<string>(
      "SERVER_ANTHROPIC_API_KEY",
    );
    if (!anthropicKey) {
      this.logger.warn(
        "SERVER_ANTHROPIC_API_KEY not set — AI Coder will be unavailable",
      );
      this.coderModelSonnet = null;
      this.coderModelHaiku = null;
    } else {
      // Shared coder config — only `model` differs between the two.
      const commonConfig = {
        apiKey: anthropicKey,
        // Lower temperature for coding — this is a precision task, not
        // a creative one.
        temperature: 0.2,
        // Non-streaming: we wait for the whole proposal (finalize_coding).
        streaming: false,
        maxTokens: 8192,
        // A single coding run makes ~30 LLM calls and can burst over
        // Tier-1's input-tokens/min window. LangChain's built-in
        // retry honors the Retry-After header on 429s — bump the
        // cap so batch validation runs complete. Default is 2.
        maxRetries: 10,
      };
      this.coderModelSonnet = new ChatAnthropic({
        ...commonConfig,
        model: CODER_MODEL_SONNET,
      });
      this.coderModelHaiku = new ChatAnthropic({
        ...commonConfig,
        model: CODER_MODEL_HAIKU,
      });
    }
  }

  /** Gemini 2.5 Flash — used by the doctor-chat Router. */
  getModel(): ChatGoogleGenerativeAI {
    return this.routerModel;
  }

  /**
   * Coder model — Sonnet 4.6 (production quality) by default, or
   * Haiku 4.5 when `variant: "haiku"` is passed (fast batch runs,
   * higher rate limits).
   */
  getCoderModel(variant: "sonnet" | "haiku" = "sonnet"): BaseChatModel {
    const m =
      variant === "haiku" ? this.coderModelHaiku : this.coderModelSonnet;
    if (!m) {
      throw new Error(
        "Coder model not configured — set SERVER_ANTHROPIC_API_KEY",
      );
    }
    return m;
  }
}
