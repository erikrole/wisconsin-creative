#!/usr/bin/env node
// Runs a command and retries it once only for the known Prisma driver-adapter
// teardown crash: every test passed, then the process aborted with a Rust
// panic in libs/driver-adapters (exit 134). Any other failure, including a
// failed test in the same run, is returned as is. A second crash fails.
import { spawn } from "node:child_process";

const SIGNATURE = /driver-adapters\/src\/queryable\.rs/;
const FAILED_TEST = /\bTests?\s+\d+ failed\b|\bTest Files\s+\d+ failed\b/;

const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error("usage: node scripts/retry-prisma-teardown-panic.mjs <command> [args...]");
  process.exit(2);
}

function run() {
  return new Promise((resolve) => {
    let output = "";
    const child = spawn(command, args, { stdio: ["inherit", "pipe", "pipe"], shell: process.platform === "win32" });
    child.stdout.on("data", (chunk) => { output += chunk; process.stdout.write(chunk); });
    child.stderr.on("data", (chunk) => { output += chunk; process.stderr.write(chunk); });
    child.on("close", (code, signal) => resolve({ code: code ?? (signal ? 134 : 1), output }));
  });
}

function isTeardownPanic({ code, output }) {
  return code !== 0 && SIGNATURE.test(output) && !FAILED_TEST.test(output);
}

const first = await run();
if (!isTeardownPanic(first)) process.exit(first.code);

console.log("\n::warning::Known Prisma driver-adapter teardown panic with no failed test. Retrying once.\n");
const second = await run();
process.exit(second.code);
