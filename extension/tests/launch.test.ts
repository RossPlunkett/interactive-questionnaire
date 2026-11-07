import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const launch = fileURLToPath(new URL("../launch.sh", import.meta.url));
const entrypoint = fileURLToPath(new URL("../index.ts", import.meta.url));
test("launch.sh demo requests native fullscreen and forwards explicit overrides without starting Pi", () => {
  const directory = mkdtempSync(join(tmpdir(), "questionnaire-launch-test-"));
  try {
    const executable = join(directory, "pi");
    writeFileSync(executable, '#!/bin/sh\nprintf "%s\\n" "$@"\n');
    chmodSync(executable, 0o755);
    const invoke = (...args: string[]) => execFileSync("bash", [launch, ...args], {
      env: { ...process.env, PATH: `${directory}:${process.env.PATH}` }, encoding: "utf8",
    }).trimEnd().split("\n");
    const defaults = ["--offline", "--no-session", "-e", entrypoint, "--tui-mode", "fullscreen"];
    assert.deepEqual(invoke("demo"), defaults);
    assert.deepEqual(invoke(), defaults);
    assert.deepEqual(invoke("demo", "--tui-mode", "regular"), [...defaults, "--tui-mode", "regular"]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
