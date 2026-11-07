import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = fileURLToPath(new URL("../../", import.meta.url));
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

test("package exposes only the extension and self-contained skill, with portable host peers", () => {
  assert.equal(manifest.private, true);
  assert.deepEqual(manifest.pi, { extensions: ["./extension/index.ts"], skills: ["./skills"] });
  assert.deepEqual(readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules")
    .map(entry => entry.name).sort(), ["extension", "skills"]);
  for (const name of ["@earendil-works/pi-ai", "@earendil-works/pi-coding-agent", "@earendil-works/pi-tui", "typebox"]) {
    assert.equal(manifest.peerDependencies[name], "*");
    assert.equal(manifest.dependencies?.[name], undefined);
  }
  assert.equal(manifest.scripts.typecheck, "tsc --noEmit");
  assert.ok(manifest.devDependencies.typescript);
  assert.ok(manifest.files.includes("skills/"));
  assert.ok(!manifest.files.some((file: string) => /test-provider|temporary-handoffs|node_modules/.test(file)));
  const skill = readFileSync(join(root, "skills/fry-me/SKILL.md"), "utf8");
  assert.match(skill, /references\/grilling\.md/);
  assert.doesNotMatch(skill, /~\/\.agents|\/home\//);
  assert.ok(existsSync(join(root, "skills/fry-me/references/grilling.md")));
});

test("Pi discovers a clean package without its node_modules, global skills, or fake provider", () => {
  const scratch = mkdtempSync(join(tmpdir(), "fry-me-package-"));
  try {
    const staged = join(scratch, "package");
    mkdirSync(staged);
    // Only runtime package files; no dependency tree, original checkout or personal skill files.
    for (const file of ["package.json", "extension/index.ts", "extension/state.ts", "skills/"]) {
      mkdirSync(dirname(join(staged, file)), { recursive: true });
      cpSync(join(root, file), join(staged, file), { recursive: true });
    }
    assert.equal(existsSync(join(staged, "node_modules")), false);
    const home = join(scratch, "home");
    mkdirSync(home);
    const script = `
      import assert from 'node:assert/strict';
      import { readFileSync } from 'node:fs';
      import { join } from 'node:path';
      import { DefaultResourceLoader, SettingsManager } from ${JSON.stringify(import.meta.resolve("@earendil-works/pi-coding-agent"))};
      const staged = ${JSON.stringify(staged)};
      const loader = new DefaultResourceLoader({
        cwd: ${JSON.stringify(scratch)}, agentDir: join(${JSON.stringify(home)}, '.pi/agent'),
        settingsManager: SettingsManager.inMemory({ packages: [staged] }),
        noContextFiles: true, noPromptTemplates: true, noThemes: true,
      });
      await loader.reload();
      const result = loader.getExtensions();
      assert.deepEqual(result.errors, []);
      assert.equal(result.extensions.length, 1);
      const extension = result.extensions[0];
      assert.ok(extension.resolvedPath.startsWith(staged));
      assert.deepEqual([...extension.tools.keys()], ['questionnaire']);
      for (const command of ['fry-me', 'answers', 'questionnaire-demo']) assert.ok(extension.commands.has(command));
      assert.ok(!extension.path.includes('test-provider'));
      const { skills, diagnostics } = loader.getSkills();
      assert.deepEqual(diagnostics, []);
      assert.equal(skills.length, 1);
      assert.equal(skills[0].name, 'fry-me');
      assert.equal(skills[0].disableModelInvocation, false);
      assert.ok(skills[0].baseDir.startsWith(staged));
      assert.match(readFileSync(join(skills[0].baseDir, 'references/grilling.md'), 'utf8'), /frontier/);
      console.log('clean-package-discovery: PASS; model requests: 0');
    `;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
      cwd: scratch, env: { ...process.env, HOME: home, PI_OFFLINE: "1" }, encoding: "utf8", timeout: 60_000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /clean-package-discovery: PASS/);
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});
