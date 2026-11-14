// src/cli.ts
import { readFileSync as readFileSync3 } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

// src/config.ts
import { randomInt } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
var KEYS = ["repository", "timeZone", "machine", "models"];
var REPOSITORY = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/;
var MACHINE_ID = /^[a-z0-9]{1,32}$/;
var ConfigError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "ConfigError";
  }
};
var configPath = (dataDir) => join(dataDir, "config.json");
function readConfig(dataDir) {
  const path = configPath(dataDir);
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new ConfigError(`${path} does not exist. Run /token-heatmap:setup in Claude Code first`);
    }
    throw new ConfigError(`cannot read ${path}: ${error.message}`);
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new ConfigError(`${path}: not JSON`);
  }
  const problem = checkConfig(value);
  if (problem) throw new ConfigError(`${path}: ${problem}`);
  const { repository, timeZone, machine, models } = value;
  return { repository, timeZone, machine, models };
}
function writeConfig(dataDir, config) {
  const { repository, timeZone, machine, models } = config;
  const problem = checkConfig({ repository, timeZone, machine, models });
  if (problem) throw new ConfigError(`config.json not written: ${problem}`);
  mkdirSync(dataDir, { recursive: true });
  const path = configPath(dataDir);
  const next = `${path}.${process.pid}.tmp`;
  writeFileSync(next, `${JSON.stringify({ repository, timeZone, machine, models }, null, 2)}
`);
  renameSync(next, path);
}
function checkConfig(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return "not a JSON object";
  for (const key of Object.keys(value)) {
    if (!KEYS.includes(key)) return `unknown key ${JSON.stringify(key)}`;
  }
  const { repository, timeZone, machine, models } = value;
  if (typeof repository !== "string" || !REPOSITORY.test(repository)) {
    return "repository is not a GitHub repository written USER/USER";
  }
  if (typeof timeZone !== "string" || !isTimeZone(timeZone)) {
    return "timeZone is not an IANA time zone such as America/Los_Angeles";
  }
  if (typeof machine !== "string" || !MACHINE_ID.test(machine))
    return "machine is not an id of lowercase letters and digits";
  if (typeof models !== "boolean") return "models is not true or false";
  return void 0;
}
function newMachineId() {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let id = "";
  for (let i = 0; i < 6; i++) id += alphabet[randomInt(alphabet.length)];
  return id;
}
function isTimeZone(zone) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}
var canonicalTimeZone = (zone) => new Intl.DateTimeFormat("en-US", { timeZone: zone }).resolvedOptions().timeZone;
function machineTimeZone() {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return typeof zone === "string" && zone !== "" && isTimeZone(zone) ? canonicalTimeZone(zone) : void 0;
}

// src/providers/claude-code.ts
import { open, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join as join2 } from "node:path";

// src/providers/provider.ts
var TOKEN_TYPES = ["input", "output", "cache_write", "cache_read"];
var NO_TOKENS = Object.freeze({ input: 0, output: 0, cache_write: 0, cache_read: 0 });
var addTokens = (a, b) => ({
  input: a.input + b.input,
  output: a.output + b.output,
  cache_write: a.cache_write + b.cache_write,
  cache_read: a.cache_read + b.cache_read
});
var totalOf = (t) => t.input + t.output + t.cache_write + t.cache_read;

// src/store.ts
var LINE_KEYS = ["date", "provider", "machine", "tokens", "models"];
var HistoryError = class extends Error {
  line;
  constructor(line, problem) {
    super(`line ${line}: ${problem}`);
    this.name = "HistoryError";
    this.line = line;
  }
};
function isDate(text) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}
var dayFormats = /* @__PURE__ */ new Map();
function localDate(instant, timeZone) {
  let format = dayFormats.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-US", {
      timeZone,
      calendar: "gregory",
      numberingSystem: "latn",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    });
    dayFormats.set(timeZone, format);
  }
  const parts = format.formatToParts(instant);
  const part = (type) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year").padStart(4, "0")}-${part("month")}-${part("day")}`;
}
function parseHistory(text) {
  const lines2 = [];
  const firstLine = /* @__PURE__ */ new Map();
  text.replace(/^﻿/, "").split("\n").forEach((raw, index) => {
    const n = index + 1;
    if (raw.trim() === "") return;
    let value;
    try {
      value = JSON.parse(raw);
    } catch {
      throw new HistoryError(n, "not JSON");
    }
    const line = readLine(value, n);
    const key = keyOf(line);
    const earlier = firstLine.get(key);
    if (earlier !== void 0) {
      throw new HistoryError(
        n,
        `a second line for ${line.date}, ${line.provider}, ${line.machine}; line ${earlier} has it`
      );
    }
    firstLine.set(key, n);
    lines2.push(line);
  });
  return lines2;
}
function formatHistory(lines2) {
  return [...lines2].sort((a, b) => compare(a.date, b.date) || compare(a.provider, b.provider) || compare(a.machine, b.machine)).map(({ date, provider, machine, tokens, models }) => {
    const line = { date, provider, machine, tokens: ordered(tokens) };
    if (models) {
      line.models = Object.fromEntries(
        Object.entries(models).sort(([a], [b]) => compare(a, b)).map(([name, counts]) => [name, ordered(counts)])
      );
    }
    return `${JSON.stringify(line)}
`;
  }).join("");
}
function merge(history, records, machine) {
  const lines2 = [...history];
  const index = new Map(lines2.map((line, i) => [keyOf(line), i]));
  for (const record of records) {
    const recorded = record.models ? { date: record.date, provider: record.provider, machine, ...splitByModel(Object.entries(record.models)) } : { date: record.date, provider: record.provider, machine, tokens: ordered(record.tokens) };
    const key = keyOf(recorded);
    const i = index.get(key);
    if (i === void 0) {
      index.set(key, lines2.length);
      lines2.push(recorded);
    } else {
      lines2[i] = mergeLine(lines2[i], recorded);
    }
  }
  return lines2;
}
function mergeLine(line, recorded) {
  if (line.models && recorded.models) {
    const models = new Map(Object.entries(line.models));
    for (const [name, counts] of Object.entries(recorded.models)) {
      const kept = models.get(name);
      if (!kept || totalOf(counts) > totalOf(kept)) models.set(name, counts);
    }
    return { ...line, ...splitByModel([...models]) };
  }
  return totalOf(recorded.tokens) > totalOf(line.tokens) ? recorded : line;
}
function splitByModel(entries) {
  return {
    tokens: entries.reduce((sum, [, counts]) => addTokens(sum, counts), NO_TOKENS),
    models: Object.fromEntries(entries.map(([name, counts]) => [name, ordered(counts)]))
  };
}
var keyOf = (line) => JSON.stringify([line.date, line.provider, line.machine]);
var compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
var ordered = (t) => ({
  input: t.input,
  output: t.output,
  cache_write: t.cache_write,
  cache_read: t.cache_read
});
var isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
function readLine(value, n) {
  if (!isObject(value)) throw new HistoryError(n, "not a JSON object");
  for (const key of Object.keys(value)) {
    if (!LINE_KEYS.includes(key)) throw new HistoryError(n, `unknown key ${JSON.stringify(key)}`);
  }
  const { date, provider, machine, tokens, models } = value;
  if (typeof date !== "string" || !isDate(date)) throw new HistoryError(n, "date is not a day written YYYY-MM-DD");
  if (typeof provider !== "string" || provider === "") throw new HistoryError(n, "provider is not a name");
  if (typeof machine !== "string" || machine === "") throw new HistoryError(n, "machine is not an id");
  const line = { date, provider, machine, tokens: readTokens(tokens, "tokens", n) };
  if (models === void 0) return line;
  if (!isObject(models)) throw new HistoryError(n, "models is not an object");
  line.models = Object.fromEntries(
    Object.entries(models).map(([name, counts]) => {
      if (name === "") throw new HistoryError(n, "a model has no name");
      return [name, readTokens(counts, `models[${JSON.stringify(name)}]`, n)];
    })
  );
  const sum = Object.values(line.models).reduce(addTokens, NO_TOKENS);
  for (const type of TOKEN_TYPES) {
    if (sum[type] !== line.tokens[type]) throw new HistoryError(n, `tokens.${type} is not the sum of models`);
  }
  return line;
}
function readTokens(value, where, n) {
  if (!isObject(value)) throw new HistoryError(n, `${where} is not an object`);
  for (const key of Object.keys(value)) {
    if (!TOKEN_TYPES.includes(key)) {
      throw new HistoryError(n, `${where} has an unknown key ${JSON.stringify(key)}`);
    }
  }
  for (const type of TOKEN_TYPES) {
    const count = value[type];
    if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) {
      throw new HistoryError(n, `${where}.${type} is not a whole number of 0 or more`);
    }
  }
  return ordered(value);
}

// src/providers/claude-code.ts
var CLAUDE_CODE = "claude-code";
var MODEL_NAME = /^[A-Za-z0-9._:@-]{1,64}$/;
var OTHER = "other";
var SYNTHETIC = "<synthetic>";
var CHUNK_SIZE = 1 << 20;
function claudeCode(opts = {}) {
  return {
    id: CLAUDE_CODE,
    async collect({ timeZone }) {
      const root = opts.root ?? projectsDir();
      const responses = /* @__PURE__ */ new Map();
      const chunk = Buffer.allocUnsafe(CHUNK_SIZE);
      const count = (bytes) => {
        const line = readAssistantLine(bytes);
        if (!line) return;
        const seen = responses.get(line.key);
        if (!seen) {
          responses.set(line.key, { model: line.model, usage: line.usage, first: line.time });
          return;
        }
        if (totalOf(line.usage) > totalOf(seen.usage)) seen.usage = line.usage;
        if (line.time < seen.first) seen.first = line.time;
      };
      for (const file of await transcriptFiles(root)) {
        try {
          await readLines(file, chunk, count);
        } catch (error) {
          if (!isGone(error)) throw error;
        }
      }
      return days(responses.values(), timeZone);
    }
  };
}
function projectsDir() {
  return join2(process.env.CLAUDE_CONFIG_DIR || join2(homedir(), ".claude"), "projects");
}
var isGone = (error) => error?.code === "ENOENT";
async function transcriptFiles(root) {
  const files = [];
  const walk = async (dir) => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      if (isGone(error)) return;
      throw error;
    }
    for (const entry of entries) {
      const path = join2(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push(path);
    }
  };
  await walk(root);
  return files.sort();
}
var NEWLINE = 10;
async function readLines(file, chunk, onLine) {
  const handle = await open(file, "r");
  try {
    let pending = [];
    for (; ; ) {
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
      if (bytesRead === 0) break;
      const view = chunk.subarray(0, bytesRead);
      let start = 0;
      for (let end = view.indexOf(NEWLINE); end >= 0; end = view.indexOf(NEWLINE, start)) {
        const rest = view.subarray(start, end);
        if (pending.length === 0) {
          onLine(rest);
        } else {
          pending.push(rest);
          onLine(Buffer.concat(pending));
          pending = [];
        }
        start = end + 1;
      }
      if (start < bytesRead) pending.push(Buffer.from(view.subarray(start)));
    }
    if (pending.length > 0) onLine(Buffer.concat(pending));
  } finally {
    await handle.close();
  }
}
var QUOTED_USAGE = Buffer.from('"usage"');
var QUOTED_ASSISTANT = Buffer.from('"assistant"');
var isObject2 = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var isCount = (value) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
var optionalCount = (value) => value === void 0 || value === null ? 0 : isCount(value) ? value : void 0;
function readAssistantLine(bytes) {
  if (bytes.indexOf(QUOTED_USAGE) < 0 || bytes.indexOf(QUOTED_ASSISTANT) < 0) return void 0;
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    return void 0;
  }
  if (!isObject2(value) || value.type !== "assistant") return void 0;
  const { message, requestId, sessionId, timestamp } = value;
  if (!isObject2(message) || typeof timestamp !== "string") return void 0;
  const { id, model, usage } = message;
  if (typeof id !== "string" || id === "" || model === SYNTHETIC || !isObject2(usage)) return void 0;
  const time = Date.parse(timestamp);
  if (Number.isNaN(time)) return void 0;
  const counts = readUsage(usage);
  if (!counts) return void 0;
  return {
    // Copies keep message.id and requestId. Lines from before requestId was written fall back
    // to the session, as ccusage does; the two kinds of key cannot meet.
    key: typeof requestId === "string" && requestId !== "" ? JSON.stringify([id, requestId]) : JSON.stringify([id, null, typeof sessionId === "string" ? sessionId : null]),
    model: typeof model === "string" && MODEL_NAME.test(model) ? model : OTHER,
    usage: counts,
    time
  };
}
function readUsage(usage) {
  const { input_tokens: input, output_tokens: output, cache_creation: split } = usage;
  const cacheRead = optionalCount(usage.cache_read_input_tokens);
  let cacheWrite = optionalCount(usage.cache_creation_input_tokens);
  if (!isCount(input) || !isCount(output) || cacheRead === void 0 || cacheWrite === void 0) return void 0;
  if (cacheWrite === 0 && isObject2(split)) {
    const fiveMinutes = optionalCount(split.ephemeral_5m_input_tokens);
    const oneHour = optionalCount(split.ephemeral_1h_input_tokens);
    if (fiveMinutes !== void 0 && oneHour !== void 0) cacheWrite = fiveMinutes + oneHour;
  }
  return { input, output, cache_write: cacheWrite, cache_read: cacheRead };
}
function days(responses, timeZone) {
  const byDay = /* @__PURE__ */ new Map();
  for (const { model, usage, first } of responses) {
    const date = localDate(new Date(first), timeZone);
    let models = byDay.get(date);
    if (!models) {
      models = /* @__PURE__ */ new Map();
      byDay.set(date, models);
    }
    models.set(model, addTokens(models.get(model) ?? NO_TOKENS, usage));
  }
  return [...byDay].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([date, models]) => ({
    date,
    provider: CLAUDE_CODE,
    tokens: [...models.values()].reduce(addTokens, NO_TOKENS),
    // Object.fromEntries makes each name an own key, so a name such as "__proto__" stays a name.
    models: Object.fromEntries([...models].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))
  }));
}

// src/providers/index.ts
var providers = [claudeCode()];

// src/levels.ts
function cutoffs(totals) {
  const active = totals.filter((t) => t > 0).sort((a, b) => a - b);
  if (active.length === 0) return [];
  const at = (p) => active[Math.max(0, Math.ceil(p * active.length) - 1)];
  return [at(0.25), at(0.5), at(0.75)];
}
function levels(totals) {
  const cuts = cutoffs(totals);
  return totals.map((t) => t > 0 ? 1 + cuts.filter((c) => t > c).length : 0);
}

// src/render.ts
var HISTORY = "token-heatmap/history.jsonl";
var MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December"
];
var MONTH_FILES = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
var WEEKDAY_FILES = ["gap-30x14", "mon", "gap-30x14", "wed", "gap-30x14", "fri", "gap-30x14"];
var IMAGES = new Map([
  ...[0, 1, 2, 3, 4].map((level) => [String(level), [14, 14]]),
  // a day of that level, and the legend
  ...MONTH_FILES.map((file) => [file, [28, 16]]),
  // a month label, two columns wide
  ["mon", [30, 14]],
  ["wed", [30, 14]],
  ["fri", [30, 14]],
  ["gap-30x14", [30, 14]],
  // the blank label of the other four weekday rows
  ["gap-30x16", [30, 16]],
  // the blank corner that starts the month row
  ["gap-14x16", [14, 16]],
  // the rest of a month's columns after its label
  ["gap-28x16", [28, 16]],
  ["gap-42x16", [42, 16]],
  ["gap-158x14", [158, 14]],
  // four of them indent the legend
  ["gap-2x2", [2, 2]],
  // with side margins, it holds the frame open on a narrow screen
  ["less", [36, 14]],
  ["more", [34, 14]]
]);
var IMAGE_FILES = [...IMAGES.keys()].map((file) => `${file}.svg`);
var GRID_WIDTH = 772;
var MS_PER_DAY = 864e5;
var dayOf = (iso) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / MS_PER_DAY;
var dateOf = (day) => new Date(day * MS_PER_DAY);
var sumOf = (t) => t.input + t.output + t.cache_write + t.cache_read;
function render(history, today) {
  if (!isDate(today)) throw new Error(`today is not a day written YYYY-MM-DD: ${JSON.stringify(today)}`);
  const last = dayOf(today);
  const first = last - dateOf(last).getUTCDay() - 364;
  const totals = new Array(last - first + 1).fill(0);
  for (const line of history) {
    const i = dayOf(line.date) - first;
    if (i >= 0 && i < totals.length) totals[i] += sumOf(line.tokens);
  }
  const level = levels(totals);
  const total = totals.reduce((a, b) => a + b, 0);
  const cells = totals.map((tokens, i) => image(String(level[i]), tooltip(tokens, first + i)));
  const weekdayRow = (label, r) => image(label) + cells.filter((_, i) => i % 7 === r).join("");
  const rows = [monthRow(first, Math.ceil(totals.length / 7)), ...WEEKDAY_FILES.map(weekdayRow), holdRow(), legendRow()];
  return `<table><tr><td nowrap>
<b>${short(total, 2)}</b> Claude Code ${total === 1 ? "token" : "tokens"} in the last year<br>
<kbd>${rows.join("<br\n>")}</kbd>
</td></tr></table>`;
}
function image(file, title, hspace) {
  const size = IMAGES.get(file);
  if (!size) throw new Error(`the block has no image ${file}.svg`);
  const [width, height] = size;
  return `<a href="${HISTORY}"${title ? ` title="${title}"` : ""} tabindex="-1"><img src="token-heatmap/${file}.svg" width="${width}" height="${height}"${hspace ? ` hspace="${hspace}"` : ""} align="top" alt=""></a>`;
}
function monthRow(first, columns) {
  const month = (column) => dateOf(first + 7 * column).getUTCMonth();
  let row2 = image("gap-30x16");
  for (let c = 0; c < columns; ) {
    let run2 = 1;
    while (c + run2 < columns && month(c + run2) === month(c)) run2++;
    if (run2 === 1) row2 += image("gap-14x16");
    else row2 += image(MONTH_FILES[month(c)]) + (run2 > 2 ? image(`gap-${14 * (run2 - 2)}x16`) : "");
    c += run2;
  }
  return row2;
}
var holdRow = () => image("gap-2x2", void 0, (GRID_WIDTH - 2) / 2);
var legendRow = () => image("gap-158x14").repeat(4) + image("less") + [0, 1, 2, 3, 4].map((level) => image(String(level))).join("") + image("more");
function tooltip(tokens, day) {
  const date = dateOf(day);
  const when = `${MONTHS[date.getUTCMonth()]} ${ordinal(date.getUTCDate())}`;
  if (tokens <= 0) return `No tokens on ${when}.`;
  return `${short(tokens, 1)} ${tokens === 1 ? "token" : "tokens"} on ${when}.`;
}
var ordinal = (n) => {
  if (n % 100 >= 11 && n % 100 <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
};
var UNITS = [
  [1000n, "K"],
  [1000000n, "M"],
  [1000000000n, "B"]
];
function short(n, decimals) {
  if (n < 1e3) return String(n);
  const scale = decimals === 1 ? 10n : 100n;
  const rounded = (unit2) => (BigInt(n) * scale + unit2 / 2n) / unit2;
  let u = n < 1e6 ? 0 : n < 1e9 ? 1 : 2;
  if (u < 2 && rounded(UNITS[u][0]) >= 1000n * scale) u++;
  const [unit, letter] = UNITS[u];
  const q = rounded(unit);
  return `${q / scale}.${String(q % scale).padStart(decimals, "0")}${letter}`;
}

// src/setup.ts
import { existsSync as existsSync2, readFileSync as readFileSync2 } from "node:fs";
import { join as join4 } from "node:path";

// src/publish/git-readme.ts
import { spawn } from "node:child_process";
import { existsSync, mkdirSync as mkdirSync2, readdirSync, rmdirSync, rmSync, statSync, writeFileSync as writeFileSync2 } from "node:fs";
import { join as join3 } from "node:path";
var BOT = { name: "token-heatmap[bot]", email: "token-heatmap[bot]@users.noreply.github.com" };
var COMMIT_MESSAGE = "Update token heatmap [skip ci]";
var README = "README.md";
var FOLDER = "token-heatmap";
var HISTORY2 = `${FOLDER}/history.jsonl`;
var addresses = (repository) => ({ https: `https://github.com/${repository}.git`, ssh: `git@github.com:${repository}.git` });
function isAddressOf(url, repository) {
  const name = repository.toLowerCase();
  const bare = url.trim().toLowerCase().replace(/\/+$/, "").replace(/\.git$/, "");
  return [`https://github.com/${name}`, `git@github.com:${name}`, `ssh://git@github.com/${name}`].includes(bare);
}
async function clone(dataDir, repository, opts = {}) {
  const repo = join3(dataDir, "repo");
  const env = gitEnv();
  if (existsSync(repo) && statSync(repo).isDirectory() && readdirSync(repo).length === 0) rmdirSync(repo);
  if (existsSync(repo)) {
    const origin = existsSync(join3(repo, ".git")) ? await run(repo, ["config", "--get", "remote.origin.url"], env) : void 0;
    const url = origin?.code === 0 ? origin.stdout.trim() : "";
    if (url !== "" && isAddressOf(url, repository)) return { address: url, kept: true };
    if (url === "" || opts.replaces === void 0 || !isAddressOf(url, opts.replaces)) {
      throw new Error(
        `${repo} is in the way: token-heatmap keeps its clone of ${repository} there, and that is something else. Move it away, then run setup again`
      );
    }
    rmSync(repo, { recursive: true, force: true });
  }
  mkdirSync2(dataDir, { recursive: true });
  const network = { ...env, GIT_TERMINAL_PROMPT: "0", ...await batchSsh(dataDir, env) };
  const refused = [];
  for (const address of Object.values(addresses(repository))) {
    const result = await run(dataDir, ["clone", "--quiet", "--depth", "1", "--no-tags", "--", address, "repo"], network);
    if (result.code === 0) {
      if ((await run(repo, ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"], env)).code !== 0) {
        rmSync(repo, { recursive: true, force: true });
        throw new Error(
          `github.com/${repository} has no commits yet. Add a README.md to it on GitHub, then run setup again`
        );
      }
      return { address, kept: false };
    }
    rmSync(repo, { recursive: true, force: true });
    refused.push(`${address}: ${result.stderr.trim() || `exit code ${result.code}`}`);
  }
  throw new Error(
    `cannot clone github.com/${repository}, over HTTPS or SSH. A profile README lives in a public repository named after the user, USER/USER: check that it exists. Git said:
${refused.join("\n")}`
  );
}
async function publish(dataDir, update, opts = {}) {
  const repo = join3(dataDir, "repo");
  if (!existsSync(join3(repo, ".git"))) {
    throw new Error(`${repo} is not a clone of the profile repository. Run /token-heatmap:setup in Claude Code first`);
  }
  const images = [...opts.images ?? []];
  for (const [name] of images) {
    if (!/^[A-Za-z0-9._-]+$/.test(name) || name === "history.jsonl")
      throw new Error(`not an image's file name: ${name}`);
  }
  const env = gitEnv();
  const network = { ...env, GIT_TERMINAL_PROMPT: "0", ...await batchSsh(repo, env) };
  const branch = await defaultBranch(repo, network);
  for (let attempt = 1; ; attempt++) {
    const base = await fetchBranch(repo, branch, network);
    await git(repo, ["reset", "--quiet", "--hard", base], env);
    const current = { history: await readAt(repo, base, HISTORY2, env), readme: await readAt(repo, base, README, env) };
    const next = update(current);
    if (images.length === 0 && next.history === current.history && next.readme === current.readme) return "unchanged";
    let pushed;
    try {
      mkdirSync2(join3(repo, FOLDER), { recursive: true });
      writeFileSync2(join3(repo, HISTORY2), next.history);
      writeFileSync2(join3(repo, README), next.readme);
      for (const [name, bytes] of images) writeFileSync2(join3(repo, FOLDER, name), bytes);
      const paths = [README, HISTORY2, ...images.map(([name]) => `${FOLDER}/${name}`)];
      await git(repo, ["add", "--force", "--", ...paths], env);
      if ((await run(repo, ["diff", "--cached", "--quiet"], env)).code === 0) {
        await git(repo, ["reset", "--quiet", "--hard", base], env);
        return "unchanged";
      }
      await commit(repo, env);
      pushed = await push(repo, branch, network);
    } catch (error) {
      await undo(repo, base, env);
      throw error;
    }
    if (pushed) return "pushed";
    if (attempt === 2) {
      await undo(repo, base, env);
      throw new Error(
        `the push to ${branch} was refused twice, because the profile repository changed while sync ran. Nothing was forced, and the next sync tries again`
      );
    }
  }
}
async function commit(repo, env) {
  await git(
    repo,
    // No signing: a detached sync has no one to type a passphrase.
    [
      "-c",
      `user.name=${BOT.name}`,
      "-c",
      `user.email=${BOT.email}`,
      "-c",
      "commit.gpgsign=false",
      "commit",
      "--quiet",
      "--message",
      COMMIT_MESSAGE
    ],
    // The environment wins over any configuration, author.name and committer.email included.
    {
      ...env,
      GIT_AUTHOR_NAME: BOT.name,
      GIT_AUTHOR_EMAIL: BOT.email,
      GIT_COMMITTER_NAME: BOT.name,
      GIT_COMMITTER_EMAIL: BOT.email
    }
  );
}
async function undo(repo, base, env) {
  await run(repo, ["reset", "--quiet", "--hard", base], env);
}
async function defaultBranch(repo, env) {
  const listed = await git(repo, ["ls-remote", "--symref", "origin", "HEAD"], env);
  const match = /^ref: refs\/heads\/(\S+)\tHEAD$/m.exec(listed);
  if (!match) throw new Error("the profile repository has no default branch to publish to");
  return match[1];
}
async function fetchBranch(repo, branch, env) {
  const tracking = `refs/remotes/origin/${branch}`;
  await git(repo, ["fetch", "--quiet", "--depth", "1", "--no-tags", "origin", `+refs/heads/${branch}:${tracking}`], env);
  return (await git(repo, ["rev-parse", "--verify", "--quiet", `${tracking}^{commit}`], env)).trim();
}
async function readAt(repo, rev, path, env) {
  if (await git(repo, ["ls-tree", "--name-only", rev, "--", path], env) === "") return "";
  return git(repo, ["cat-file", "blob", `${rev}:${path}`], env);
}
async function push(repo, branch, env) {
  const args = ["push", "--porcelain", "origin", `HEAD:refs/heads/${branch}`];
  const result = await run(repo, args, env);
  if (result.code === 0) return true;
  if (/^!\t[^\t]*\t\[rejected\]/m.test(result.stdout)) return false;
  const refused = result.stdout.split("\n").filter((line) => line.startsWith("!	"));
  throw new PushError(args, {
    ...result,
    stderr: [result.stderr.trim(), ...refused].filter(Boolean).join("\n"),
    declined: refused.some((line) => /\t\[remote rejected\]/.test(line))
  });
}
async function batchSsh(dir, env) {
  if (env.GIT_SSH_COMMAND) return { GIT_SSH_COMMAND: `${env.GIT_SSH_COMMAND} -o BatchMode=yes` };
  if (env.GIT_SSH) return {};
  const configured = await run(dir, ["config", "--get", "core.sshCommand"], env);
  return { GIT_SSH_COMMAND: `${configured.code === 0 && configured.stdout.trim() || "ssh"} -o BatchMode=yes` };
}
function gitEnv() {
  const env = { ...process.env, LC_ALL: "C" };
  for (const name of [
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_INDEX_FILE",
    "GIT_OBJECT_DIRECTORY",
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    "GIT_COMMON_DIR",
    "GIT_NAMESPACE",
    "GIT_PREFIX"
  ]) {
    delete env[name];
  }
  return env;
}
var GitError = class extends Error {
  constructor(args, result) {
    const command = args.find((arg, i) => !arg.startsWith("-") && args[i - 1] !== "-c") ?? "git";
    super(`git ${command} failed: ${result.stderr.trim() || `exit code ${result.code}`}`);
    this.name = "GitError";
  }
};
var PushError = class extends GitError {
  declined;
  constructor(args, result) {
    super(args, result);
    this.name = "PushError";
    this.declined = result.declined;
  }
};
async function git(repo, args, env) {
  const result = await run(repo, args, env);
  if (result.code !== 0) throw new GitError(args, result);
  return result.stdout;
}
function run(dir, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn("git", ["-C", dir, ...args], { env, stdio: ["ignore", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", (error) => {
      reject(error.code === "ENOENT" ? new Error("git was not found on PATH. Install git, then try again") : error);
    });
    child.on("close", (code) => {
      resolve({
        code: code ?? 1,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8")
      });
    });
  });
}

// src/readme.ts
var START = "<!-- token-heatmap:start -->";
var END = "<!-- token-heatmap:end -->";
var MarkersError = class extends Error {
  constructor(message = `README.md has no "${START}" line followed by an "${END}" line, so the block has nowhere to go`) {
    super(message);
    this.name = "MarkersError";
  }
};
function replaceBlock(readme, block) {
  const start = readme.indexOf(START);
  const end = start < 0 ? -1 : readme.indexOf(END, start + START.length);
  if (end < 0) throw new MarkersError();
  return `${readme.slice(0, start + START.length)}
${block}
${readme.slice(end)}`;
}
function withMarkers(readme) {
  const start = readme.indexOf(START);
  const end = readme.indexOf(END);
  if (start < 0 && end < 0) {
    const gap = readme === "" || readme.endsWith("\n\n") ? "" : readme.endsWith("\n") ? "\n" : "\n\n";
    return `${readme}${gap}${START}
${END}
`;
  }
  if (start >= 0 && readme.indexOf(END, start + START.length) >= 0) return readme;
  throw new MarkersError(
    start >= 0 ? `README.md has a "${START}" line with no "${END}" line after it. Add the end marker where the block is to end, or delete the start marker, then run setup again` : `README.md has a "${END}" line with no "${START}" line before it. Add the start marker where the block is to begin, or delete the end marker, then run setup again`
  );
}

// src/sync.ts
async function sync(opts) {
  const config = readConfig(opts.dataDir);
  const collected = await collect(opts.providers, config.timeZone);
  const records = config.models ? collected : withoutModels(collected);
  const today = localDate(opts.now, config.timeZone);
  return publish(
    opts.dataDir,
    (current) => nextFiles({
      history: readHistory(current.history, config.repository),
      readme: current.readme,
      records,
      machine: config.machine,
      today
    })
  );
}
async function collect(providers2, timeZone) {
  const records = [];
  for (const provider of providers2) {
    for (const record of await provider.collect({ timeZone })) {
      if (record.provider !== provider.id) {
        throw new Error(`provider ${provider.id} returned a day of ${JSON.stringify(record.provider)}`);
      }
      records.push(record);
    }
  }
  return records;
}
var withoutModels = (records) => records.map(({ date, provider, tokens }) => ({ date, provider, tokens }));
function readHistory(text, repository) {
  try {
    return parseHistory(text);
  } catch (error) {
    throw new Error(`token-heatmap/history.jsonl in ${repository}: ${error.message}`);
  }
}
function nextFiles(o) {
  const history = merge(o.history, o.records, o.machine);
  const text = formatHistory(history);
  try {
    parseHistory(text);
  } catch (error) {
    throw new Error(`the history to publish cannot be read back: ${error.message}`);
  }
  return { history: text, readme: replaceBlock(o.readme, render(history, o.today)) };
}

// src/setup.ts
function profileRepository(arg) {
  const [owner, name, ...rest] = arg.split("/");
  if (rest.length > 0 || !/^[A-Za-z0-9-]{1,39}$/.test(owner)) return void 0;
  if (name !== void 0 && name.toLowerCase() !== owner.toLowerCase()) return void 0;
  return `${owner}/${owner}`;
}
async function setup(opts) {
  const config = existingConfig(opts.dataDir);
  if (opts.timeZone !== void 0 && !isTimeZone(opts.timeZone)) {
    throw new Error(`--timezone takes an IANA time zone such as America/Los_Angeles, not ${opts.timeZone}`);
  }
  if (config && opts.timeZone !== void 0) return changeConfig(config, { ...opts, timeZone: opts.timeZone });
  const timeZone = opts.timeZone !== void 0 ? canonicalTimeZone(opts.timeZone) : config?.timeZone ?? machineTimeZone();
  if (timeZone === void 0) {
    throw new Error(
      "cannot tell this machine's time zone. Run setup again with --timezone ZONE, such as America/Los_Angeles"
    );
  }
  const models = opts.models ?? config?.models ?? true;
  const images = readImages(opts.assets);
  const collected = await collect(opts.providers, timeZone);
  if (!opts.yes) {
    return {
      done: "planned",
      text: planText({
        repository: opts.repository,
        previous: config && !same(config.repository, opts.repository) ? config.repository : void 0,
        timeZone,
        machine: opts.adopt ?? config?.machine,
        adopt: opts.adopt !== void 0,
        models,
        modelsKept: opts.models === void 0 && config !== void 0,
        dates: [...new Set(collected.map((record) => record.date))].sort(),
        modelNames: [...new Set(collected.flatMap((record) => Object.keys(record.models ?? {})))].sort()
      })
    };
  }
  const repo = join4(opts.dataDir, "repo");
  const { address } = await clone(opts.dataDir, opts.repository, { replaces: config?.repository });
  const records = models ? collected : withoutModels(collected);
  const today = localDate(opts.now, timeZone);
  const own = config?.machine ?? newMachineId();
  let chosen = { machine: own, others: [] };
  let done;
  try {
    done = await publish(
      opts.dataDir,
      (current) => {
        const history = readHistory(current.history, opts.repository);
        chosen = whichMachine(history, { repository: opts.repository, own, adopt: opts.adopt });
        return nextFiles({ history, readme: withMarkers(current.readme), records, machine: chosen.machine, today });
      },
      { images }
    );
  } catch (error) {
    if (error instanceof PushError) throw new Error(refusedPush(error, { repository: opts.repository, address, repo }));
    throw error;
  }
  writeConfig(opts.dataDir, { repository: opts.repository, timeZone, machine: chosen.machine, models });
  return {
    done,
    text: lines(
      done === "pushed" ? `Pushed one commit by token-heatmap[bot] to github.com/${opts.repository}. The profile shows it at https://github.com/${opts.repository.split("/")[0]}` : `github.com/${opts.repository} has this block, history and images already, so nothing was pushed.`,
      `This machine's id is ${chosen.machine}, and config.json in ${opts.dataDir} holds it.`,
      chosen.others.length > 0 ? `The lines of ${list(chosen.others)} in history.jsonl stay as they are.` : void 0
    )
  };
}
function existingConfig(dataDir) {
  if (!existsSync2(configPath(dataDir))) return void 0;
  try {
    return readConfig(dataDir);
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    throw new Error(
      `${error.message}. Fix it, or delete it to set this machine up anew; its lines in history.jsonl can then be taken over with --adopt ID`
    );
  }
}
function changeConfig(config, opts) {
  if (!same(config.repository, opts.repository)) {
    throw new Error(
      `this machine is set up for ${config.repository}. On a machine that is set up, --timezone changes config.json only: run setup without it to publish to ${opts.repository}`
    );
  }
  if (opts.adopt !== void 0) {
    throw new Error(
      "on a machine that is set up, --timezone changes config.json only, and --adopt needs the history: run setup with --adopt first, then with --timezone"
    );
  }
  const next = { ...config, timeZone: canonicalTimeZone(opts.timeZone), models: opts.models ?? config.models };
  const changes = [
    next.timeZone === config.timeZone ? void 0 : row("Time zone", `${config.timeZone}, to become ${next.timeZone}`),
    next.models === config.models ? void 0 : row("Model names", next.models ? "not published, to become published" : "published, to become not published")
  ].filter((change) => change !== void 0);
  if (changes.length === 0) {
    return { done: "unchanged", text: lines(`config.json counts days in ${next.timeZone} already. Nothing to change.`) };
  }
  const after = "Nothing is pushed, and the days already in history.jsonl stay as they are.";
  if (!opts.yes) {
    return {
      done: "planned",
      text: lines(
        "token-heatmap setup: the plan. Nothing has changed yet.",
        "",
        ...changes,
        "",
        `Only config.json changes. ${after} From the next sync on, days are counted in ${next.timeZone}.`,
        "Run setup again with --yes to make the change."
      )
    };
  }
  writeConfig(opts.dataDir, next);
  return { done: "configured", text: lines(`config.json now counts days in ${next.timeZone}. ${after}`) };
}
function whichMachine(history, o) {
  const ids = [...new Set(history.map((line) => line.machine))].sort();
  const where = `token-heatmap/history.jsonl in ${o.repository}`;
  if (o.adopt !== void 0) {
    if (!ids.includes(o.adopt)) {
      throw new Error(
        `--adopt ${o.adopt}: ${where} has no lines of that machine, ${ids.length > 0 ? `only of ${list(ids)}` : "and no lines at all yet"}. Nothing was published`
      );
    }
    return { machine: o.adopt, others: ids.filter((id) => id !== o.adopt) };
  }
  const others = ids.filter((id) => id !== o.own);
  if (others.length > 0 && !ids.includes(o.own)) {
    const one = others.length === 1;
    throw new Error(
      lines(
        `${where} has the lines of ${one ? "another machine" : "other machines"}, ${list(others)}, and none of this one's. Nothing was published.`,
        one ? `If they are this machine's own, from an earlier install, run setup again with --adopt ${others[0]} to go on with them.` : "If one of them is this machine's own, from an earlier install, run setup again with --adopt and its id to go on with it.",
        "If another machine still publishes to this profile, set it up there only: token-heatmap publishes from one machine."
      ).trimEnd()
    );
  }
  return { machine: o.own, others };
}
function refusedPush(error, o) {
  return lines(
    `the push to ${o.repository} was refused, so nothing was published. ${error.message}`,
    error.declined ? `GitHub turned the commit down, as it does on a protected branch: let your account push to the default branch of ${o.repository}, then run setup again.` : "To fix it, run `gh auth setup-git`, so that git signs in to github.com with your GitHub CLI login, then run setup again.",
    !error.declined && !o.address.startsWith("https://") ? `This clone reaches GitHub over SSH, which that does not change: load your key with \`ssh-add\`, or switch the clone to HTTPS first with \`git -C "${o.repo}" remote set-url origin ${addresses(o.repository).https}\`.` : void 0
  ).trimEnd();
}
function planText(plan) {
  const days2 = plan.dates.length;
  return lines(
    "token-heatmap setup: the plan. Nothing has changed yet.",
    "",
    row(
      "Repository",
      `github.com/${plan.repository}, its default branch${plan.previous ? `, in place of ${plan.previous}` : ""}`
    ),
    row("Time zone", `${plan.timeZone}: it decides which day each response counts on`),
    row(
      "Machine id",
      plan.adopt ? `${plan.machine}, taken over with --adopt: the history must have lines of it` : plan.machine ? `${plan.machine}, from config.json` : "a new random one"
    ),
    row(
      "Days found",
      days2 === 0 ? "none yet: the block shows a year of no tokens until there is usage" : `${days2} ${days2 === 1 ? "day" : "days"} with usage, ${plan.dates[0]} to ${plan.dates[days2 - 1]}`
    ),
    row(
      "Model names",
      !plan.models ? plan.modelsKept ? "none: this machine is set up with --no-models, and --models would publish them" : "none: --no-models keeps them out" : plan.modelNames.length === 0 ? "none found yet" : plan.modelNames.join(", ")
    ),
    "",
    `With --yes, setup pushes one commit by token-heatmap[bot] to github.com/${plan.repository}: README.md with the block between two marker lines, added at its end if it has none, and in token-heatmap/, history.jsonl and the block's ${IMAGE_FILES.length} images.`,
    `history.jsonl holds, for each day: the date, the provider, this machine's id, and the token counts by type${plan.models ? " and by model. A model name first seen later is published too" : ""}.`,
    "What is pushed stays in the repository's git history.",
    "Run setup again with --yes to publish."
  );
}
function readImages(assets) {
  const images = /* @__PURE__ */ new Map();
  for (const name of IMAGE_FILES) {
    try {
      images.set(name, readFileSync2(join4(assets, name)));
    } catch (error) {
      throw new Error(
        `the plugin's image ${name} cannot be read from ${assets}: ${error.message}. Reinstall the plugin, then run setup again`
      );
    }
  }
  return images;
}
var same = (a, b) => a.toLowerCase() === b.toLowerCase();
var row = (name, value) => `  ${name.padEnd(12)} ${value}`;
var list = (items) => items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
var lines = (...text) => text.filter((line) => line !== void 0).map((line) => `${line}
`).join("");

// src/cli.ts
var USAGE = `usage: token-heatmap render --history FILE [--today YYYY-MM-DD]
       token-heatmap sync --foreground [--data-dir DIR]
       token-heatmap setup --repo USER [--data-dir DIR] [--timezone ZONE] [--models | --no-models]
                           [--adopt ID] [--yes]

commands:
  render    print the README block for a history file
            --history FILE   the history.jsonl to draw
            --today DATE     the grid's last day; defaults to today on this machine
  sync      count the transcripts, then push the history and the block to the profile
            repository in one commit if a number changed; prints "pushed" or "unchanged"
            --foreground     run in this process, until the push is done
            --data-dir DIR   config.json and the clone; defaults to $CLAUDE_PLUGIN_DATA
  setup     put the block on the profile README of github.com/USER/USER. Without --yes it prints
            the plan, model names to be published included, and changes nothing
            --repo USER        your GitHub user name: the profile repository is USER/USER
            --data-dir DIR     where config.json and the clone go; defaults to $CLAUDE_PLUGIN_DATA
            --timezone ZONE    the IANA zone that decides each day, such as America/Los_Angeles;
                               defaults to this machine's. On a machine that is set up, it changes
                               config.json only, and the days already recorded stay as they are
            --no-models        publish each day's counts by type only, with no model names. Later
                               runs keep the choice; --models publishes the names again
            --adopt ID         go on as machine ID, whose lines the history holds from an earlier
                               install
            --yes              clone, push one commit by token-heatmap[bot], write config.json
`;
var ASSETS = fileURLToPath(new URL("../assets/", import.meta.url));
var UsageError = class extends Error {
};
async function main(argv) {
  const [command, ...rest] = argv;
  switch (command) {
    case "render":
      return renderCommand(rest);
    case "sync":
      return syncCommand(rest);
    case "setup":
      return setupCommand(rest);
    case "help":
    case "--help":
    case "-h":
      process.stdout.write(USAGE);
      return 0;
    case void 0:
      throw new UsageError("no command given");
    default:
      throw new UsageError(`unknown command ${JSON.stringify(command)}`);
  }
}
function renderCommand(args) {
  const { values } = asUsage(
    () => parseArgs({ args, options: { history: { type: "string" }, today: { type: "string" } }, strict: true })
  );
  if (values.history === void 0) throw new UsageError("render needs --history FILE");
  const today = values.today ?? localToday();
  if (!isDate(today)) throw new UsageError(`--today takes a day written YYYY-MM-DD, such as 2026-11-13, not ${today}`);
  let text;
  try {
    text = readFileSync3(values.history, "utf8");
  } catch (error) {
    throw new Error(`cannot read ${values.history}: ${messageOf(error)}`);
  }
  let history;
  try {
    history = parseHistory(text);
  } catch (error) {
    throw new Error(`${values.history}: ${messageOf(error)}`);
  }
  process.stdout.write(`${render(history, today)}
`);
  return 0;
}
async function syncCommand(args) {
  const { values } = asUsage(
    () => parseArgs({ args, options: { foreground: { type: "boolean" }, "data-dir": { type: "string" } }, strict: true })
  );
  if (!values.foreground) throw new UsageError("sync runs only with --foreground for now");
  const dataDir = values["data-dir"] ?? process.env.CLAUDE_PLUGIN_DATA;
  if (!dataDir) throw new UsageError("sync needs --data-dir DIR, or CLAUDE_PLUGIN_DATA set");
  process.stdout.write(`${await sync({ dataDir, providers, now: /* @__PURE__ */ new Date() })}
`);
  return 0;
}
async function setupCommand(args) {
  const { values } = asUsage(
    () => parseArgs({
      args,
      options: {
        repo: { type: "string" },
        "data-dir": { type: "string" },
        timezone: { type: "string" },
        models: { type: "boolean" },
        "no-models": { type: "boolean" },
        adopt: { type: "string" },
        yes: { type: "boolean" }
      },
      strict: true
    })
  );
  const dataDir = values["data-dir"] ?? process.env.CLAUDE_PLUGIN_DATA;
  if (!dataDir) throw new UsageError("setup needs --data-dir DIR, or CLAUDE_PLUGIN_DATA set");
  if (values.repo === void 0) throw new UsageError("setup needs --repo USER, your GitHub user name");
  const repository = profileRepository(values.repo);
  if (!repository) {
    throw new UsageError(`--repo takes your GitHub user name, such as octocat, not ${JSON.stringify(values.repo)}`);
  }
  if (values.timezone !== void 0 && !isTimeZone(values.timezone)) {
    throw new UsageError(
      `--timezone takes an IANA time zone such as America/Los_Angeles, not ${JSON.stringify(values.timezone)}`
    );
  }
  if (values.models && values["no-models"]) throw new UsageError("--models and --no-models do not go together");
  if (values.adopt !== void 0 && !MACHINE_ID.test(values.adopt)) {
    throw new UsageError(
      `--adopt takes a machine id of lowercase letters and digits, not ${JSON.stringify(values.adopt)}`
    );
  }
  const report = await setup({
    dataDir,
    repository,
    timeZone: values.timezone,
    models: values["no-models"] ? false : values.models ? true : void 0,
    adopt: values.adopt,
    yes: values.yes ?? false,
    providers,
    now: /* @__PURE__ */ new Date(),
    assets: ASSETS
  });
  process.stdout.write(report.text);
  return 0;
}
function asUsage(read) {
  try {
    return read();
  } catch (error) {
    throw new UsageError(messageOf(error));
  }
}
function localToday() {
  const now = /* @__PURE__ */ new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
var messageOf = (error) => error instanceof Error ? error.message : String(error);
main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    if (error instanceof UsageError) {
      process.stderr.write(`token-heatmap: ${error.message}

${USAGE}`);
      process.exitCode = 2;
    } else {
      process.stderr.write(`token-heatmap: ${messageOf(error)}
`);
      process.exitCode = 1;
    }
  }
);
