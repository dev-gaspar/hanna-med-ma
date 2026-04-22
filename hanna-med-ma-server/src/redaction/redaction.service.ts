import { Injectable } from "@nestjs/common";
import { RULES } from "./rules";

export type RedactionResult = {
  redacted: string;
  tokens: Record<string, string>;
};

/**
 * PHI redaction / rehydration. Clinical notes are never sent to a
 * third-party LLM without being passed through redact() first — PHI
 * values become tokens like [NAME_1], [MRN_1], [PHONE_1]. The tokens
 * map is kept alongside the request so the response can be rehydrated
 * before the UI renders it back to the clinician.
 *
 * Ported from hannamed-scribe (Adony's work) — the rule set was
 * already well-tuned for the clinical PHI we see. Kept the reRedact
 * path too in case we ever need to send a persisted (already
 * rehydrated) response back through the LLM.
 */
@Injectable()
export class RedactionService {
  redact(text: string): RedactionResult {
    const tokens: Record<string, string> = {};
    const reverseMap = new Map<string, string>();
    const counters: Record<string, number> = {};

    let working = text;
    for (const rule of RULES) {
      working = working.replace(rule.pattern, (match) => {
        const existing = reverseMap.get(`${rule.type}:${match}`);
        if (existing) return existing;
        counters[rule.type] = (counters[rule.type] ?? 0) + 1;
        const token = `[${rule.type}_${counters[rule.type]}]`;
        tokens[token] = match;
        reverseMap.set(`${rule.type}:${match}`, token);
        return token;
      });
    }

    return { redacted: working, tokens };
  }

  rehydrate(text: string, tokens: Record<string, string>): string {
    let out = text;
    // Replace longest tokens first so [NAME_10] doesn't get
    // half-replaced when [NAME_1] is iterated first.
    const keys = Object.keys(tokens).sort((a, b) => b.length - a.length);
    for (const token of keys) {
      out = out.split(token).join(tokens[token]);
    }
    return out;
  }

  /**
   * Recursively rehydrate any string field inside an arbitrary JSON
   * structure (objects, arrays, nested mix). Used on the CoderAgent
   * proposal so evidence spans, rationales, and summaries render with
   * real PHI once they're back inside our HIPAA boundary.
   */
  rehydrateDeep<T>(value: T, tokens: Record<string, string>): T {
    if (value === null || value === undefined) return value;
    if (typeof value === "string") {
      return this.rehydrate(value, tokens) as unknown as T;
    }
    if (Array.isArray(value)) {
      return value.map((v) => this.rehydrateDeep(v, tokens)) as unknown as T;
    }
    if (typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        out[k] = this.rehydrateDeep(v, tokens);
      }
      return out as unknown as T;
    }
    return value;
  }
}
