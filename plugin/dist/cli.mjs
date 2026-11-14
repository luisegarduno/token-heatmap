// src/cli.ts
import { readFileSync as readFileSync2 } from "node:fs";
import { parseArgs } from "node:util";

// src/providers/claude-code.ts
import { open, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

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
  const lines = [];
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
    lines.push(line);
  });
  return lines;
}
function formatHistory(lines) {
  return [...lines].sort((a, b) => compare(a.date, b.date) || compare(a.provider, b.provider) || compare(a.machine, b.machine)).map(({ date, provider, machine, tokens, models }) => {
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
  const lines = [...history];
  const index = new Map(lines.map((line, i) => [keyOf(line), i]));
  for (const record of records) {
    const recorded = record.models ? { date: record.date, provider: record.provider, machine, ...splitByModel(Object.entries(record.models)) } : { date: record.date, provider: record.provider, machine, tokens: ordered(record.tokens) };
    const key = keyOf(recorded);
    const i = index.get(key);
    if (i === void 0) {
      index.set(key, lines.length);
      lines.push(recorded);
    } else {
      lines[i] = mergeLine(lines[i], recorded);
    }
  }
  return lines;
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
  return join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"), "projects");
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
      const path = join(dir, entry.name);
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
  let row = image("gap-30x16");
  for (let c = 0; c < columns; ) {
    let run2 = 1;
    while (c + run2 < columns && month(c + run2) === month(c)) run2++;
    if (run2 === 1) row += image("gap-14x16");
    else row += image(MONTH_FILES[month(c)]) + (run2 > 2 ? image(`gap-${14 * (run2 - 2)}x16`) : "");
    c += run2;
  }
  return row;
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

// src/config.ts
import { readFileSync } from "node:fs";
import { join as join2 } from "node:path";
var KEYS = ["repository", "timeZone", "machine", "models"];
var ConfigError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "ConfigError";
  }
};
var configPath = (dataDir) => join2(dataDir, "config.json");
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
  const problem = (what) => new ConfigError(`${path}: ${what}`);
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw problem("not JSON");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw problem("not a JSON object");
  for (const key of Object.keys(value)) {
    if (!KEYS.includes(key)) throw problem(`unknown key ${JSON.stringify(key)}`);
  }
  const { repository, timeZone, machine, models } = value;
  if (typeof repository !== "string" || !/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(repository)) {
    throw problem("repository is not a GitHub repository written USER/USER");
  }
  if (typeof timeZone !== "string" || !isTimeZone(timeZone)) {
    throw problem("timeZone is not an IANA time zone such as America/Los_Angeles");
  }
  if (typeof machine !== "string" || !/^[a-z0-9]{1,32}$/.test(machine)) {
    throw problem("machine is not an id of lowercase letters and digits");
  }
  if (typeof models !== "boolean") throw problem("models is not true or false");
  return { repository, timeZone, machine, models };
}
function isTimeZone(zone) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

// src/publish/git-readme.ts
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join as join3 } from "node:path";
var BOT = { name: "token-heatmap[bot]", email: "token-heatmap[bot]@users.noreply.github.com" };
var COMMIT_MESSAGE = "Update token heatmap [skip ci]";
var README = "README.md";
var HISTORY2 = "token-heatmap/history.jsonl";
async function publish(dataDir, update) {
  const repo = join3(dataDir, "repo");
  if (!existsSync(join3(repo, ".git"))) {
    throw new Error(`${repo} is not a clone of the profile repository. Run /token-heatmap:setup in Claude Code first`);
  }
  const env = gitEnv();
  const network = { ...env, GIT_TERMINAL_PROMPT: "0", ...await batchSsh(repo, env) };
  const branch = await defaultBranch(repo, network);
  for (let attempt = 1; ; attempt++) {
    const base = await fetchBranch(repo, branch, network);
    await git(repo, ["reset", "--quiet", "--hard", base], env);
    const current = { history: await readAt(repo, base, HISTORY2, env), readme: await readAt(repo, base, README, env) };
    const next = update(current);
    if (next.history === current.history && next.readme === current.readme) return "unchanged";
    mkdirSync(join3(repo, "token-heatmap"), { recursive: true });
    writeFileSync(join3(repo, HISTORY2), next.history);
    writeFileSync(join3(repo, README), next.readme);
    await git(repo, ["add", "--force", "--", README, HISTORY2], env);
    if ((await run(repo, ["diff", "--cached", "--quiet"], env)).code === 0) return "unchanged";
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
    if (await push(repo, branch, network)) return "pushed";
    if (attempt === 2) {
      throw new Error(
        `the push to ${branch} was refused twice, because the profile repository changed while sync ran. Nothing was forced, and the next sync tries again`
      );
    }
  }
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
  throw new GitError(args, { ...result, stderr: [result.stderr.trim(), ...refused].filter(Boolean).join("\n") });
}
async function batchSsh(repo, env) {
  if (env.GIT_SSH_COMMAND) return { GIT_SSH_COMMAND: `${env.GIT_SSH_COMMAND} -o BatchMode=yes` };
  if (env.GIT_SSH) return {};
  const configured = await run(repo, ["config", "--get", "core.sshCommand"], env);
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
async function git(repo, args, env) {
  const result = await run(repo, args, env);
  if (result.code !== 0) throw new GitError(args, result);
  return result.stdout;
}
function run(repo, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn("git", ["-C", repo, ...args], { env, stdio: ["ignore", "pipe", "pipe"] });
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
  constructor() {
    super(`README.md has no "${START}" line followed by an "${END}" line, so the block has nowhere to go`);
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

// src/sync.ts
async function sync(opts) {
  const config = readConfig(opts.dataDir);
  const records = [];
  for (const provider of opts.providers) {
    for (const record of await provider.collect({ timeZone: config.timeZone })) {
      if (record.provider !== provider.id) {
        throw new Error(`provider ${provider.id} returned a day of ${JSON.stringify(record.provider)}`);
      }
      records.push(config.models ? record : { date: record.date, provider: record.provider, tokens: record.tokens });
    }
  }
  const today = localDate(opts.now, config.timeZone);
  return publish(opts.dataDir, (current) => {
    let history;
    try {
      history = merge(parseHistory(current.history), records, config.machine);
    } catch (error) {
      throw new Error(`token-heatmap/history.jsonl in ${config.repository}: ${error.message}`);
    }
    const text = formatHistory(history);
    try {
      parseHistory(text);
    } catch (error) {
      throw new Error(`the history to publish cannot be read back: ${error.message}`);
    }
    return { history: text, readme: replaceBlock(current.readme, render(history, today)) };
  });
}

// src/cli.ts
var USAGE = `usage: token-heatmap render --history FILE [--today YYYY-MM-DD]
       token-heatmap sync --foreground [--data-dir DIR]

commands:
  render    print the README block for a history file
            --history FILE   the history.jsonl to draw
            --today DATE     the grid's last day; defaults to today on this machine
  sync      count the transcripts, then push the history and the block to the profile
            repository in one commit if a number changed; prints "pushed" or "unchanged"
            --foreground     run in this process, until the push is done
            --data-dir DIR   config.json and the clone; defaults to $CLAUDE_PLUGIN_DATA
`;
var UsageError = class extends Error {
};
async function main(argv) {
  const [command, ...rest] = argv;
  switch (command) {
    case "render":
      return renderCommand(rest);
    case "sync":
      return syncCommand(rest);
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
    text = readFileSync2(values.history, "utf8");
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
