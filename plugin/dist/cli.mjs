// src/cli.ts
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

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

// src/providers/provider.ts
var TOKEN_TYPES = ["input", "output", "cache_write", "cache_read"];

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
    const key = JSON.stringify([line.date, line.provider, line.machine]);
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
  const sum = Object.values(line.models).reduce(add, { input: 0, output: 0, cache_write: 0, cache_read: 0 });
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
var add = (a, b) => ({
  input: a.input + b.input,
  output: a.output + b.output,
  cache_write: a.cache_write + b.cache_write,
  cache_read: a.cache_read + b.cache_read
});

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
    let run = 1;
    while (c + run < columns && month(c + run) === month(c)) run++;
    if (run === 1) row += image("gap-14x16");
    else row += image(MONTH_FILES[month(c)]) + (run > 2 ? image(`gap-${14 * (run - 2)}x16`) : "");
    c += run;
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

// src/cli.ts
var USAGE = `usage: token-heatmap render --history FILE [--today YYYY-MM-DD]

commands:
  render    print the README block for a history file
            --history FILE   the history.jsonl to draw
            --today DATE     the grid's last day; defaults to today on this machine
`;
var UsageError = class extends Error {
};
function main(argv) {
  const [command, ...rest] = argv;
  switch (command) {
    case "render":
      return renderCommand(rest);
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
    text = readFileSync(values.history, "utf8");
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
try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
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
