/**
 * Live TUI dashboard for the Cycle 8 batch validator. Spawns
 * `batch-validate.ts` as a child process, parses its progress lines
 * in real time, and renders an in-place updating view with running
 * metrics, per-doctor stats, last-N completed, and in-flight workers.
 *
 *   npx ts-node -r dotenv/config _cycle8-dashboard.ts
 *
 * No extra deps — uses ANSI escape codes directly. Designed for
 * Windows Terminal / modern PowerShell (both support ANSI).
 *
 * Also tees the raw stdout to `out/cycle8-live.log` so the post-mortem
 * has the full trail.
 */
import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";

const ROOT = path.resolve(__dirname, "..", "..", "..");
const SERVER_DIR = path.resolve(__dirname, "..", "..", "..");
const REPO_ROOT = path.resolve(SERVER_DIR, "..");
const OUT_DIR = path.join(SERVER_DIR, "out");
fs.mkdirSync(OUT_DIR, { recursive: true });
const LIVE_LOG = path.join(OUT_DIR, "cycle8-live.log");
const liveLogStream = fs.createWriteStream(LIVE_LOG, { flags: "w" });

// ── ANSI helpers ──────────────────────────────────────────────────
const ESC = "\x1b[";
const CLEAR_SCREEN = ESC + "2J";
const CURSOR_HOME = ESC + "H";
const HIDE_CURSOR = ESC + "?25l";
const SHOW_CURSOR = ESC + "?25h";
const CLEAR_LINE_END = ESC + "K";
const RESET = ESC + "0m";
const BOLD = ESC + "1m";
const DIM = ESC + "2m";
const fg = (n: number) => ESC + `38;5;${n}m`;
const GREEN = fg(34);
const RED = fg(196);
const YELLOW = fg(214);
const CYAN = fg(45);
const MAGENTA = fg(207);
const GRAY = fg(245);
const BLUE = fg(33);

// ── Parse args ────────────────────────────────────────────────────
const args = process.argv.slice(2);
function getArg(name: string, def?: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  if (i >= 0 && i + 1 < args.length) return args[i + 1];
  return def;
}
const csv = getArg("csv", path.join(REPO_ROOT, "Baptist Hospital Testing Files.csv"))!;
const pdfDir = getArg("pdf-dir", path.join(REPO_ROOT, "test-data", "hajira-pdfs"))!;
const offset = getArg("offset", "0")!;
const limit = getArg("limit", "49")!;
const concurrency = getArg("concurrency", "2")!;
const model = getArg("model", "sonnet")!;
const tag = getArg("tag", "cycle8-forcefn-full")!;

// ── State ─────────────────────────────────────────────────────────
type EncounterState = {
  idx: number;
  patient: string;
  doctor?: string;
  startTime?: number;
  endTime?: number;
  match?: boolean;
  expectedCpt?: string;
  actualCpt?: string;
  icdJaccard?: number;
  runtimeS?: number;
  failed?: string;
};
const state = {
  total: parseInt(limit, 10),
  startTime: Date.now(),
  inFlight: new Map<number, EncounterState>(),
  done: [] as EncounterState[],
  perDoctor: new Map<string, { total: number; matched: number }>(),
};

// ── Parsing ───────────────────────────────────────────────────────
// Lines we care about:
//   Grouped into 49 encounters. Running #1–49 (49) with ...
//   [N/M] Patient — starting · note Xc · facesheet Yc
//   [N/M] Patient — ✓ primary CPT XXX · ICD Jaccard X.XX · X.Xs
//   [N/M] Patient — ✗ primary CPT XXX vs YYY · ICD Jaccard X.XX · X.Xs
//   [N/M] Patient — failed: <reason>
const RE_RUNNING = /Running #(\d+)[–-](\d+)\s+\((\d+)\)/;
const RE_START = /^\[(\d+)\/\d+\]\s+(.+?)\s+— starting/;
const RE_DONE_OK = /^\[(\d+)\/\d+\]\s+(.+?)\s+— ✓\s+primary CPT\s+(\S+)(?:\s+·\s+ICD Jaccard\s+([\d.]+))?(?:\s+·\s+([\d.]+)s)?/;
const RE_DONE_FAIL = /^\[(\d+)\/\d+\]\s+(.+?)\s+— ✗\s+primary CPT\s+(\S+)\s+vs\s+(\S+)(?:\s+·\s+ICD Jaccard\s+([\d.]+))?(?:\s+·\s+([\d.]+)s)?/;
const RE_FAILED = /^\[(\d+)\/\d+\]\s+(.+?)\s+— failed/;

// Heuristic: pull doctor info from out/batch-validate-results-*.json
// once they appear (the inline progress doesn't include doctor).
function hydrateDoctorFor(idx: number) {
  // Best effort: look at any JSON result file written so far.
  const candidates = fs
    .readdirSync(OUT_DIR)
    .filter(
      (f) =>
        f.startsWith(`batch-validate-results-${tag}`) && f.endsWith(".json"),
    );
  for (const f of candidates) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(OUT_DIR, f), "utf-8"));
      const all: any[] = Array.isArray(raw) ? raw : raw.encounters || [];
      for (const e of all) {
        if (e.idx === idx && e.doctor) return e.doctor as string;
      }
    } catch {
      /* ignore — file may be partially written */
    }
  }
  return undefined;
}

function handleLine(raw: string) {
  liveLogStream.write(raw + "\n");
  const line = raw.replace(/\x1b\[[0-9;]*m/g, "");

  let m: RegExpMatchArray | null;
  if ((m = line.match(RE_RUNNING))) {
    state.total = parseInt(m[3], 10);
    return;
  }
  if ((m = line.match(RE_START))) {
    const idx = parseInt(m[1], 10);
    const patient = m[2].trim();
    state.inFlight.set(idx, { idx, patient, startTime: Date.now() });
    return;
  }
  if ((m = line.match(RE_DONE_OK))) {
    const idx = parseInt(m[1], 10);
    const patient = m[2].trim();
    const cpt = m[3];
    const jaccard = m[4] ? parseFloat(m[4]) : undefined;
    const runtime = m[5] ? parseFloat(m[5]) : undefined;
    const cur = state.inFlight.get(idx) || { idx, patient };
    state.inFlight.delete(idx);
    cur.endTime = Date.now();
    cur.match = true;
    cur.actualCpt = cpt;
    cur.expectedCpt = cpt;
    cur.icdJaccard = jaccard;
    cur.runtimeS = runtime;
    cur.doctor = hydrateDoctorFor(idx);
    state.done.push(cur);
    return;
  }
  if ((m = line.match(RE_DONE_FAIL))) {
    const idx = parseInt(m[1], 10);
    const patient = m[2].trim();
    const actual = m[3];
    const expected = m[4];
    const jaccard = m[5] ? parseFloat(m[5]) : undefined;
    const runtime = m[6] ? parseFloat(m[6]) : undefined;
    const cur = state.inFlight.get(idx) || { idx, patient };
    state.inFlight.delete(idx);
    cur.endTime = Date.now();
    cur.match = false;
    cur.actualCpt = actual;
    cur.expectedCpt = expected;
    cur.icdJaccard = jaccard;
    cur.runtimeS = runtime;
    cur.doctor = hydrateDoctorFor(idx);
    state.done.push(cur);
    return;
  }
  if ((m = line.match(RE_FAILED))) {
    const idx = parseInt(m[1], 10);
    const patient = m[2].trim();
    const cur = state.inFlight.get(idx) || { idx, patient };
    state.inFlight.delete(idx);
    cur.endTime = Date.now();
    cur.failed = "yes";
    state.done.push(cur);
    return;
  }
}

// ── Render ────────────────────────────────────────────────────────
function fmtSecs(secs: number): string {
  if (secs < 60) return `${secs.toFixed(0)}s`;
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${h}h ${mm}m`;
}

function progressBar(cur: number, total: number, width = 40): string {
  const ratio = total === 0 ? 0 : Math.min(1, cur / total);
  const filled = Math.round(ratio * width);
  return "[" + "█".repeat(filled) + "░".repeat(width - filled) + "]";
}

function render() {
  const elapsed = (Date.now() - state.startTime) / 1000;
  const completedCount = state.done.length;
  const matched = state.done.filter((d) => d.match === true).length;
  const failed = state.done.filter((d) => d.failed).length;
  const matchRate =
    completedCount === 0 ? 0 : (matched / completedCount) * 100;
  const jaccards = state.done
    .filter((d) => typeof d.icdJaccard === "number")
    .map((d) => d.icdJaccard!) as number[];
  const avgJaccard =
    jaccards.length === 0
      ? 0
      : jaccards.reduce((a, b) => a + b, 0) / jaccards.length;
  const runtimes = state.done
    .filter((d) => typeof d.runtimeS === "number")
    .map((d) => d.runtimeS!) as number[];
  const avgRuntime =
    runtimes.length === 0
      ? 0
      : runtimes.reduce((a, b) => a + b, 0) / runtimes.length;
  const remaining = state.total - completedCount;
  const eta =
    runtimes.length === 0
      ? "—"
      : fmtSecs(
          (avgRuntime * remaining) / Math.max(1, parseInt(concurrency, 10)),
        );

  // Per-doctor rollup (best-effort, only for rows where doctor is known).
  const perDoctor = new Map<string, { total: number; matched: number }>();
  for (const d of state.done) {
    const k = d.doctor || "(unknown)";
    const cur = perDoctor.get(k) || { total: 0, matched: 0 };
    cur.total += 1;
    if (d.match === true) cur.matched += 1;
    perDoctor.set(k, cur);
  }

  const lines: string[] = [];
  lines.push(
    `${BOLD}${CYAN}╔══════════════════════════════════════════════════════════════════════════════╗${RESET}`,
  );
  lines.push(
    `${BOLD}${CYAN}║${RESET}  ${BOLD}CYCLE 8${RESET} — ${BLUE}Sonnet 4.6 + forcing function (mdm + surgeryDecision)${RESET}     ${BOLD}${CYAN}║${RESET}`,
  );
  lines.push(
    `${BOLD}${CYAN}║${RESET}  Started: ${GRAY}${new Date(state.startTime).toLocaleString()}${RESET}  ·  Tag: ${MAGENTA}${tag}${RESET}                         ${BOLD}${CYAN}║${RESET}`,
  );
  lines.push(
    `${BOLD}${CYAN}║${RESET}  Conc=${concurrency}  ·  Model=${model}  ·  Encounters #${parseInt(offset) + 1}–${parseInt(offset) + parseInt(limit)}                                ${BOLD}${CYAN}║${RESET}`,
  );
  lines.push(
    `${BOLD}${CYAN}╚══════════════════════════════════════════════════════════════════════════════╝${RESET}`,
  );
  lines.push("");
  lines.push(
    `  ${BOLD}Progress${RESET}: ${progressBar(completedCount, state.total)} ${BOLD}${completedCount}/${state.total}${RESET} (${(
      (completedCount / state.total) *
      100
    ).toFixed(1)}%)  ${GRAY}elapsed ${fmtSecs(elapsed)}  ·  ETA ~${eta}${RESET}`,
  );
  lines.push("");
  lines.push(`  ${BOLD}Cumulative metrics${RESET}:`);
  const matchColor =
    matchRate >= 50 ? GREEN : matchRate >= 25 ? YELLOW : RED;
  lines.push(
    `    Primary CPT match : ${matchColor}${matched}/${completedCount} (${matchRate.toFixed(1)}%)${RESET}`,
  );
  lines.push(
    `    ICD Jaccard avg   : ${avgJaccard.toFixed(3)}   (over ${jaccards.length} samples)`,
  );
  lines.push(
    `    Avg runtime       : ${avgRuntime.toFixed(1)}s   (${(avgRuntime / 60).toFixed(1)}m)`,
  );
  if (failed > 0) {
    lines.push(`    ${RED}Failed (no proposal): ${failed}${RESET}`);
  }
  lines.push("");

  if (perDoctor.size > 0) {
    lines.push(`  ${BOLD}Per doctor${RESET}:`);
    for (const [doctor, stats] of perDoctor) {
      const rate = (stats.matched / stats.total) * 100;
      const color = rate >= 50 ? GREEN : rate >= 25 ? YELLOW : RED;
      lines.push(
        `    ${doctor.padEnd(28)} ${color}${stats.matched}/${stats.total} (${rate.toFixed(0)}%)${RESET}`,
      );
    }
    lines.push("");
  }

  // Last 12 done
  const last = state.done.slice(-12).reverse();
  if (last.length > 0) {
    lines.push(`  ${BOLD}Last ${last.length} encounters${RESET}:`);
    for (const d of last) {
      const icon = d.failed
        ? `${RED}!${RESET}`
        : d.match
          ? `${GREEN}✓${RESET}`
          : `${RED}✗${RESET}`;
      const cptInfo = d.failed
        ? `${RED}(no proposal)${RESET}`
        : d.match
          ? `${d.actualCpt}`
          : `${d.actualCpt} ${DIM}vs${RESET} ${d.expectedCpt}`;
      const jStr =
        d.icdJaccard != null ? `ICD ${d.icdJaccard.toFixed(2)}` : "";
      const tStr = d.runtimeS != null ? `${d.runtimeS.toFixed(0)}s` : "";
      lines.push(
        `    #${String(d.idx).padStart(2)} ${icon} ${d.patient.padEnd(34).slice(0, 34)} ${cptInfo.padEnd(20)} ${GRAY}${jStr.padEnd(10)} ${tStr}${RESET}`,
      );
    }
    lines.push("");
  }

  // In flight
  if (state.inFlight.size > 0) {
    lines.push(`  ${BOLD}In flight${RESET} (${state.inFlight.size}):`);
    for (const e of state.inFlight.values()) {
      const elapsedS = e.startTime
        ? ((Date.now() - e.startTime) / 1000).toFixed(0)
        : "?";
      lines.push(
        `    #${String(e.idx).padStart(2)} ${YELLOW}⟳${RESET} ${e.patient.padEnd(34).slice(0, 34)} ${GRAY}running ${elapsedS}s${RESET}`,
      );
    }
    lines.push("");
  }

  lines.push(
    `  ${DIM}Live log: ${LIVE_LOG}${RESET}`,
  );

  // Render: clear + home + draw
  process.stdout.write(CLEAR_SCREEN + CURSOR_HOME + lines.join("\n") + "\n");
}

// ── Spawn batch ───────────────────────────────────────────────────
process.stdout.write(HIDE_CURSOR);
process.on("exit", () => process.stdout.write(SHOW_CURSOR));
process.on("SIGINT", () => {
  process.stdout.write(SHOW_CURSOR);
  process.exit(130);
});

// Invoke node directly with ts-node/register loader. Avoids the
// npx.cmd shim (which fails with EINVAL under spawn shell:false on
// Windows) and avoids quoting issues from shell:true.
// `TS_NODE_TRANSPILE_ONLY=true` is the programmatic equivalent of `-T`.
//
// CRITICAL: batch-validate.ts only parses `--key=value` (equals form);
// passing `--key value` makes it silently default to "true". Use the
// equals form for every flag below.
const child = spawn(
  process.execPath, // the running node.exe
  [
    "-r",
    "ts-node/register",
    "-r",
    "dotenv/config",
    path.join(SERVER_DIR, "src/coverage/scripts/batch-validate.ts"),
    `--csv=${csv}`,
    `--pdf-dir=${pdfDir}`,
    `--offset=${offset}`,
    `--limit=${limit}`,
    `--concurrency=${concurrency}`,
    `--model=${model}`,
    `--tag=${tag}`,
  ],
  {
    cwd: SERVER_DIR,
    env: { ...process.env, TS_NODE_TRANSPILE_ONLY: "true" },
    shell: false,
  },
);

const rl = readline.createInterface({ input: child.stdout });
rl.on("line", handleLine);
const rlErr = readline.createInterface({ input: child.stderr });
rlErr.on("line", handleLine);

const renderInterval = setInterval(render, 800);
render();

child.on("close", (code) => {
  clearInterval(renderInterval);
  render();
  process.stdout.write(
    "\n" +
      (code === 0 ? GREEN : RED) +
      `\n  Batch process exited with code ${code}.\n` +
      RESET +
      `  Full log: ${LIVE_LOG}\n` +
      `  Reports: hanna-med-ma-server/out/batch-validate-{report,results,metrics}-${tag}.{md,json,csv}\n` +
      `\n  Press Ctrl+C to close this window.\n`,
  );
  process.stdout.write(SHOW_CURSOR);
  liveLogStream.end();
  // Don't auto-exit so the user can read the final state.
});
