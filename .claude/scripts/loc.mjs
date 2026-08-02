import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { extname, join } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const CODE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const HARD_CAP = 500;
const WARN_CAP = 400;

/**
 * Counts source lines of code: non-blank lines that remain after stripping
 * block (slash-star) and line (double-slash) comments. A pragmatic estimate —
 * comment markers inside string or regex literals are not detected.
 */
export function countSloc(content) {
  return content
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/)
    .map((line) => line.replace(/\/\/.*$/, "").trim())
    .filter((line) => line.length > 0).length;
}

/**
 * Builds report rows from `{ path, content }` entries, sorted by raw line
 * count descending, each tagged against the size cap.
 */
export function buildReport(files) {
  return files
    .map(({ path, content }) => {
      const raw = rawLineCount(content);
      return { path, raw, sloc: countSloc(content), flag: flagFor(raw) };
    })
    .sort((a, b) => b.raw - a.raw);
}

function rawLineCount(content) {
  const lines = content.split(/\r?\n/);
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines.length;
}

function flagFor(raw) {
  if (raw > HARD_CAP) return "over";
  if (raw >= WARN_CAP) return "warn";
  return "ok";
}

function readTracked(root, path) {
  try {
    return { path, content: readFileSync(join(root, path), "utf8") };
  } catch {
    return null;
  }
}

function collectFiles() {
  const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
    encoding: "utf8",
  }).trim();
  const tracked = execFileSync("git", ["ls-files"], {
    cwd: root,
    encoding: "utf8",
  });
  return tracked
    .split(/\r?\n/)
    .filter((path) => path.length > 0 && CODE_EXTENSIONS.has(extname(path)))
    .map((path) => readTracked(root, path))
    .filter((entry) => entry !== null);
}

function printReport(report, totalSloc) {
  const marker = { over: "⚠", warn: "!", ok: " " };
  console.log(
    `Lines of code — ${totalSloc} SLOC across ${report.length} files`,
  );
  console.log("");
  console.log("   RAW  SLOC  FILE");
  for (const row of report) {
    const raw = String(row.raw).padStart(5);
    const sloc = String(row.sloc).padStart(5);
    console.log(`${marker[row.flag]}${raw} ${sloc}  ${row.path}`);
  }
  console.log("");
  const over = report.filter((row) => row.flag === "over");
  if (over.length > 0) {
    console.log(`⚠ ${over.length} file(s) over the 500-line cap.`);
  } else {
    console.log("All files within the 500-line cap.");
  }
}

function main() {
  const report = buildReport(collectFiles());
  const totalSloc = report.reduce((sum, row) => sum + row.sloc, 0);
  printReport(report, totalSloc);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
