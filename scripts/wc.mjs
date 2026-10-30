#!/usr/bin/env node
// `wc`: the Wisconsin Creative CLI for people and AI agents.
// Output is always JSON on stdout; failures print the API's error envelope on
// stderr and exit 1. Times are shown in America/Chicago unless --utc is passed.
// Run `wc commands` for the machine-readable command list.
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";

const CREDENTIALS_PATH = join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "wc", "credentials.json");
const DEFAULT_URL = "https://wisconsincreative.com";
const TIME_ZONE = "America/Chicago";

export const COMMANDS = [
  { name: "login", usage: "login [--url URL] (--token wc_... | --email EMAIL [--scope read|write] [--days N])", writes: false, about: "Save a token. With --email, signs in once with your password (WC_PASSWORD or a prompt) and mints a token." },
  { name: "logout", usage: "logout", writes: false, about: "Forget the saved token on this machine." },
  { name: "whoami", usage: "whoami", writes: false, about: "Show who the token acts as." },
  { name: "schedule list", usage: "schedule list [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--sport CODE] [--q TEXT]", writes: false, about: "Events in a date window with their crew." },
  { name: "schedule show", usage: "schedule show SHIFT_GROUP_ID", writes: false, about: "The working schedule for one event: slots, crew, version and draft id." },
  { name: "schedule assign", usage: "schedule assign SHIFT_GROUP_ID SLOT_KEY USER_ID [--dry-run]", writes: true, about: "Put a person in a slot on the private working schedule." },
  { name: "schedule unassign", usage: "schedule unassign SHIFT_GROUP_ID SLOT_KEY [--dry-run]", writes: true, about: "Empty a slot on the working schedule." },
  { name: "schedule publish", usage: "schedule publish SHIFT_GROUP_ID --yes", writes: true, about: "Release the working schedule. Notifies the crew, so --yes is required." },
  { name: "schedule discard", usage: "schedule discard SHIFT_GROUP_ID --yes", writes: true, about: "Throw away the unpublished working schedule." },
  { name: "mine", usage: "mine [--limit N]", writes: false, about: "Your upcoming shifts." },
  { name: "open-work", usage: "open-work [--area AREA]", writes: false, about: "Open slots and trades anyone can pick up." },
  { name: "trades list", usage: "trades list [--status OPEN|CLAIMED|COMPLETED|CANCELLED]", writes: false, about: "The trade board." },
  { name: "trades post", usage: "trades post SHIFT_ASSIGNMENT_ID [--notes TEXT]", writes: true, about: "Put one of your shifts on the trade board." },
  { name: "trades claim", usage: "trades claim TRADE_ID", writes: true, about: "Claim an open trade." },
  { name: "trades approve", usage: "trades approve TRADE_ID", writes: true, about: "Approve a claimed trade (staff)." },
  { name: "trades cancel", usage: "trades cancel TRADE_ID", writes: true, about: "Cancel a trade you posted." },
  { name: "availability", usage: "availability", writes: false, about: "Every active student's availability (staff)." },
  { name: "api", usage: "api METHOD /api/path [--data JSON] [--dry-run]", writes: true, about: "Call any app endpoint directly. Reaches every action the web app has; roles still apply." },
  { name: "commands", usage: "commands", writes: false, about: "This list as JSON." },
];

// ── Arguments ──────────────────────────────────────────

export function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const [key, inline] = arg.slice(2).split(/=(.*)/s);
    const next = argv[i + 1];
    if (inline !== undefined) flags[key] = inline;
    else if (next !== undefined && !next.startsWith("--")) {
      flags[key] = next;
      i += 1;
    } else flags[key] = true;
  }
  return { positional, flags };
}

// ── Times: ISO instants become America/Chicago ──────────

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const chicagoParts = new Intl.DateTimeFormat("en-US", {
  timeZone: TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  timeZoneName: "longOffset",
});

export function toChicago(iso) {
  const date = new Date(iso);
  const p = Object.fromEntries(chicagoParts.formatToParts(date).map((part) => [part.type, part.value]));
  const offset = p.timeZoneName.replace("GMT", "") || "+00:00";
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}${offset}`;
}

export function localizeTimes(value) {
  if (typeof value === "string") return ISO_INSTANT.test(value) ? toChicago(value) : value;
  if (Array.isArray(value)) return value.map(localizeTimes);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, localizeTimes(v)]));
  }
  return value;
}

// ── Credentials ─────────────────────────────────────────

function readCredentials() {
  const fromEnv = { baseUrl: process.env.WC_URL, token: process.env.WC_TOKEN };
  if (fromEnv.token) return { baseUrl: fromEnv.baseUrl || DEFAULT_URL, token: fromEnv.token };
  if (!existsSync(CREDENTIALS_PATH)) return null;
  return JSON.parse(readFileSync(CREDENTIALS_PATH, "utf8"));
}

function saveCredentials(credentials) {
  mkdirSync(dirname(CREDENTIALS_PATH), { recursive: true });
  writeFileSync(CREDENTIALS_PATH, JSON.stringify(credentials), { mode: 0o600 });
  chmodSync(CREDENTIALS_PATH, 0o600);
}

// ── HTTP ────────────────────────────────────────────────

class CliError extends Error {
  constructor(message, body = { error: message }, status = 0) {
    super(message);
    this.body = body;
    this.status = status;
  }
}

async function request(credentials, method, path, { body, query, headers = {} } = {}) {
  const url = new URL(path, credentials.baseUrl);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== true) url.searchParams.set(key, String(value));
  }
  const response = await fetch(url, {
    method,
    headers: {
      ...(credentials.token ? { Authorization: `Bearer ${credentials.token}` } : {}),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = { error: text.slice(0, 300) };
  }
  if (!response.ok) throw new CliError(parsed.error || `HTTP ${response.status}`, parsed, response.status);
  return { data: parsed, response };
}

function requireCredentials() {
  const credentials = readCredentials();
  if (!credentials?.token) throw new CliError("Not signed in. Run: wc login --token wc_... (or --email you@wisc.edu)");
  return credentials;
}

// ── Commands ────────────────────────────────────────────

async function prompt(question) {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}

async function login({ flags }) {
  const baseUrl = String(flags.url || process.env.WC_URL || DEFAULT_URL).replace(/\/$/, "");
  if (flags.token && flags.token !== true) {
    saveCredentials({ baseUrl, token: String(flags.token) });
    return { saved: CREDENTIALS_PATH, baseUrl };
  }
  if (!flags.email || flags.email === true) {
    throw new CliError("Pass --token wc_... (create one in the app) or --email you@wisc.edu");
  }
  const password = process.env.WC_PASSWORD || (await prompt("Password: "));
  const origin = { Origin: new URL(baseUrl).origin };
  const signIn = await request({ baseUrl }, "POST", "/api/auth/login", {
    body: { email: flags.email, password },
    headers: origin,
  });
  const cookie = signIn.response.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const headers = { ...origin, Cookie: cookie };
  try {
    const scope = String(flags.scope || "write").toUpperCase();
    const days = Number(flags.days || 90);
    const minted = await request({ baseUrl }, "POST", "/api/me/api-tokens", {
      body: { name: `wc on ${process.env.HOSTNAME || "cli"}`, scope, days },
      headers,
    });
    saveCredentials({ baseUrl, token: minted.data.data.secret });
    return { saved: CREDENTIALS_PATH, baseUrl, scope, expiresAt: minted.data.data.expiresAt };
  } finally {
    // The one-time sign-in session is not left behind in the person's Sessions list.
    await request({ baseUrl }, "POST", "/api/auth/logout", { headers }).catch(() => {});
  }
}

function logout() {
  rmSync(CREDENTIALS_PATH, { force: true });
  return { removed: CREDENTIALS_PATH };
}

// Reads the working schedule, then sends one command with the version the read
// returned. A 409 means someone else changed it first: re-read and retry once.
async function workingScheduleCommand(credentials, groupId, command, dryRun) {
  const path = `/api/shift-groups/${groupId}/working-copy`;
  const read = async () => (await request(credentials, "GET", path)).data.data;
  let editor = await read();
  if (dryRun) return { dryRun: true, wouldSend: command, workingVersion: editor.workingVersion, draftId: editor.draftId ?? null };
  for (let attempt = 0; ; attempt += 1) {
    try {
      const body = {
        expectedVersion: editor.workingVersion ?? 0,
        expectedDraftId: editor.draftId ?? null,
        command,
      };
      return (await request(credentials, "PATCH", path, { body })).data.data;
    } catch (error) {
      if (!(error instanceof CliError) || error.status !== 409 || attempt > 0) throw error;
      editor = await read();
    }
  }
}

function need(positional, count, usage) {
  if (positional.length < count) throw new CliError(`Usage: wc ${usage}`);
}

function requireYes(flags, what) {
  if (flags.yes !== true && !flags["dry-run"]) {
    throw new CliError(`${what} affects other people. Re-run with --yes (or --dry-run to preview).`);
  }
}

async function run(argv) {
  const { positional, flags } = parseArgs(argv);
  const [first, second, ...rest] = positional;
  const key = ["schedule", "trades"].includes(first) ? `${first} ${second}` : first;
  const args = ["schedule", "trades"].includes(first) ? rest : [second, ...rest].filter((v) => v !== undefined);

  if (key === "commands") return COMMANDS;
  if (key === "login") return login({ flags });
  if (key === "logout") return logout();

  const credentials = requireCredentials();
  const call = async (method, path, options) => (await request(credentials, method, path, options)).data;

  switch (key) {
    case "whoami":
      return (await call("GET", "/api/me")).user;
    case "schedule list":
      return call("GET", "/api/calendar-events", {
        query: { startDate: flags.from, endDate: flags.to, sportCode: flags.sport, q: flags.q, limit: flags.limit },
      });
    case "schedule show":
      need(args, 1, COMMANDS.find((c) => c.name === key).usage);
      return (await call("GET", `/api/shift-groups/${args[0]}/working-copy`)).data;
    case "schedule assign":
      need(args, 3, COMMANDS.find((c) => c.name === key).usage);
      return workingScheduleCommand(credentials, args[0], { type: "assign", slotKey: args[1], userId: args[2] }, flags["dry-run"]);
    case "schedule unassign":
      need(args, 2, COMMANDS.find((c) => c.name === key).usage);
      return workingScheduleCommand(credentials, args[0], { type: "unassign", slotKey: args[1] }, flags["dry-run"]);
    case "schedule publish":
    case "schedule discard": {
      need(args, 1, COMMANDS.find((c) => c.name === key).usage);
      const publish = key === "schedule publish";
      requireYes(flags, publish ? "Publishing" : "Discarding");
      const path = `/api/shift-groups/${args[0]}/${publish ? "publish" : "working-copy"}`;
      const editor = (await call("GET", `/api/shift-groups/${args[0]}/working-copy`)).data;
      if (flags["dry-run"]) return { dryRun: true, would: publish ? "publish" : "discard", workingVersion: editor.workingVersion, draftId: editor.draftId ?? null };
      return publish
        ? call("POST", path, { body: { expectedVersion: editor.workingVersion, expectedDraftId: editor.draftId ?? null } })
        : call("DELETE", path, { query: { expectedVersion: editor.workingVersion, expectedDraftId: editor.draftId ?? "" } });
    }
    case "mine":
      return call("GET", "/api/my-shifts", { query: { limit: flags.limit } });
    case "open-work":
      return call("GET", "/api/schedule/open-work", { query: { area: flags.area } });
    case "trades list":
      return call("GET", "/api/shift-trades", { query: { status: flags.status } });
    case "trades post":
      need(args, 1, COMMANDS.find((c) => c.name === key).usage);
      return call("POST", "/api/shift-trades", { body: { shiftAssignmentId: args[0], notes: flags.notes === true ? undefined : flags.notes } });
    case "trades claim":
    case "trades approve":
    case "trades cancel":
      need(args, 1, COMMANDS.find((c) => c.name === key).usage);
      return call(second === "claim" ? "POST" : "PATCH", `/api/shift-trades/${args[0]}/${second}`, { body: {} });
    case "availability":
      return call("GET", "/api/availability/team");
    case "api": {
      need(positional.slice(1), 2, COMMANDS.find((c) => c.name === "api").usage);
      const method = second.toUpperCase();
      const body = flags.data ? JSON.parse(flags.data) : undefined;
      if (flags["dry-run"]) return { dryRun: true, method, path: rest[0], body: body ?? null };
      return call(method, rest[0], { body });
    }
    default:
      throw new CliError(`Unknown command${key ? ` "${key}"` : ""}. Run: wc commands`);
  }
}

async function main() {
  const flags = parseArgs(process.argv.slice(2)).flags;
  try {
    const result = await run(process.argv.slice(2));
    const shown = flags.utc ? result : localizeTimes(result);
    process.stdout.write(`${JSON.stringify(shown, null, process.stdout.isTTY ? 2 : 0)}\n`);
  } catch (error) {
    const body = error instanceof CliError ? error.body : { error: error?.message || String(error) };
    process.stderr.write(`${JSON.stringify(body)}\n`);
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
