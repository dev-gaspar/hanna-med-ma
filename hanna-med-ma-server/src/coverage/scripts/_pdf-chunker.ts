/**
 * Shared helpers for PDF → heading-chunked corpus ingestion. Used by
 * the load-*.ts scripts that ingest prose policy documents (CMS
 * Claims Processing Manual, NCCI Policy Manual, Global Surgery
 * Booklet, ICD-10-CM Official Guidelines).
 *
 * The common shape across these docs is: stable heading pattern →
 * split by heading → pack each section into ~500-token chunks so
 * embedding granularity matches the unit a coder would cite ("§30.6.10",
 * "Section 1.E", etc.). Embedding the whole doc as one vector loses
 * the snap-to-evidence affordance.
 */

import * as fs from "fs";

// pdf-parse is CJS, and its typings are thin — re-import through a
// typed constructor so callers don't deal with `any`. Module is
// lazy-required the first time it's needed so cold environments
// where pdf-parse can't import its fixture still boot the server.
type PDFParseCtor = new (opts: { data: Buffer }) => {
  getText: () => Promise<{ text: string }>;
};
let _PDFParse: PDFParseCtor | null = null;
function pdfParseCtor(): PDFParseCtor {
  if (_PDFParse) return _PDFParse;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require("pdf-parse");
  _PDFParse = mod.PDFParse ?? mod.default ?? mod;
  return _PDFParse!;
}

/**
 * Canonical PDF → text primitive. Takes a Buffer so the caller
 * decides where the bytes came from (S3 download in production,
 * `fs.readFileSync` in tests and ingest scripts). Returns the
 * trimmed text body.
 */
export async function extractPdfTextFromBuffer(buf: Buffer): Promise<string> {
  const Ctor = pdfParseCtor();
  const parser = new Ctor({ data: buf });
  const res = await parser.getText();
  return (res.text || "").trim();
}

/**
 * Convenience wrapper for file-path callers (ingest scripts, local
 * dev). Reads the file and forwards to extractPdfTextFromBuffer.
 */
export async function extractPdfText(filePath: string): Promise<string> {
  const buf = fs.readFileSync(filePath);
  return extractPdfTextFromBuffer(buf);
}

/**
 * Collapse mid-sentence linewraps into spaces while preserving
 * paragraph breaks. CMS PDFs wrap prose inside a hard right margin
 * so every line ends mid-sentence — without this cleanup the
 * embedding gets split noise between every 80 chars.
 */
export function cleanChunk(raw: string): string {
  return raw
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/(?<=\S)\n(?=\S)/g, " ")
    .trim();
}

/**
 * Default chunk-packing parameters. "Token" here is a rough char/4
 * proxy — good enough since the downstream embedder truncates at
 * 8k chars anyway. TARGET_CHARS=2000 ≈ 500 tokens matches what
 * retrieval benchmarks show as the sweet spot for dense retrieval.
 */
export const TARGET_CHARS = 2000;
export const MIN_CHARS = 200;

/**
 * Pack a section body into <= TARGET_CHARS chunks along sentence
 * boundaries. Pathological sentences longer than TARGET_CHARS are
 * hard-split; everything else greedy-packs into the current buffer.
 * Chunks shorter than MIN_CHARS are dropped to avoid embedding
 * near-empty fragments (section headers with no body).
 */
export function chunkBody(
  body: string,
  targetChars = TARGET_CHARS,
  minChars = MIN_CHARS,
): string[] {
  const out: string[] = [];
  const sentences = body
    .split(/(?<=[.!?])\s+(?=[A-Z0-9])/)
    .map((s) => s.trim())
    .filter(Boolean);
  let buf = "";
  for (const s of sentences) {
    if (s.length > targetChars) {
      if (buf) {
        out.push(buf);
        buf = "";
      }
      for (let i = 0; i < s.length; i += targetChars) {
        out.push(s.slice(i, i + targetChars));
      }
      continue;
    }
    if (buf.length + s.length + 1 > targetChars) {
      out.push(buf);
      buf = s;
    } else {
      buf = buf ? `${buf} ${s}` : s;
    }
  }
  if (buf) out.push(buf);
  return out.filter((c) => c.length >= minChars);
}

// ─── Heading detection ────────────────────────────────────────────

/**
 * Tracked section boundary. `start` is the char offset in the raw
 * extracted text. `label` is a normalized citation string ("30.6.10",
 * "A", "1.E", etc.) — whitespace-stripped so it's comparable.
 */
export interface SectionMarker {
  start: number;
  label: string;
  // The regex match itself — useful when a caller wants to distinguish
  // between a decimal section ("30.6.10") and an alpha sub-section
  // ("A.", "B.") that used the same heading regex.
  rawMatch: string;
}

/**
 * Run a heading regex across the raw text and return sorted, deduped
 * markers. The regex must have `g` flag. The `labelOf` hook lets the
 * caller customize how the raw match becomes a citation label
 * (e.g. "30.6.10" stripped of trailing punct).
 */
export function findSectionMarkers(
  raw: string,
  regex: RegExp,
  labelOf: (match: string) => string = (m) => m.replace(/\s+/g, ""),
): SectionMarker[] {
  const markers: SectionMarker[] = [];
  for (const m of raw.matchAll(regex)) {
    if (m.index === undefined) continue;
    markers.push({ start: m.index, label: labelOf(m[0]), rawMatch: m[0] });
  }
  // Dedupe consecutive identical labels — some PDFs include a TOC
  // entry followed by the real heading using the exact same text.
  const deduped: SectionMarker[] = [];
  for (const m of markers) {
    if (!deduped.length || deduped[deduped.length - 1].label !== m.label) {
      deduped.push(m);
    }
  }
  return deduped;
}

export interface SplitSection {
  section: string;
  heading: string;
  body: string;
  rawMatch: string;
}

/**
 * Split raw text into sections using pre-computed markers. The
 * section body runs from just after each marker to the start of
 * the next (or EOF). The first line after the marker is treated
 * as the heading (up to 200 chars); the rest is the body, cleaned.
 */
export function splitBySectionMarkers(
  raw: string,
  markers: SectionMarker[],
): SplitSection[] {
  const out: SplitSection[] = [];
  for (let i = 0; i < markers.length; i++) {
    const { start, label, rawMatch } = markers[i];
    const end = i + 1 < markers.length ? markers[i + 1].start : raw.length;
    const after = raw.slice(start + rawMatch.length, end).trim();
    const lineBreak = after.indexOf("\n");
    const headingEnd = lineBreak > 0 ? Math.min(lineBreak, 200) : 200;
    const heading = after.slice(0, headingEnd).trim();
    const body = cleanChunk(after.slice(headingEnd));
    if (body.length < 100) continue;
    out.push({ section: label, heading, body, rawMatch });
  }
  return out;
}

// ─── CLI arg parsing (shared) ─────────────────────────────────────

/**
 * Tolerant `--k v` and `--k=v` parser. Last-wins semantics, no
 * per-key validation — callers narrow the shape with `as { ... }`.
 */
export function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    if (!m) continue;
    if (m[2] !== undefined) {
      out[m[1]] = m[2];
    } else if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
      out[m[1]] = argv[i + 1];
      i++;
    } else {
      out[m[1]] = "true";
    }
  }
  return out;
}
