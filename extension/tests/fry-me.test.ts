import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { formatSkillsForPrompt, loadSkillsFromDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import questionnaireExtension, { demoQuestionnaire } from "../index.ts";

// No live session: sendUserMessage records the request, never starts a model.
function harness(idle = true) {
  const commands = new Map<string, any>();
  const events = new Map<string, any>();
  const sent: any[] = []; const notifications: any[] = [];
  let tool: any;
  const ctx = { mode: "tui", isIdle: () => idle, ui: {
    notify: (...args: any[]) => notifications.push(args), setWidget() {},
  } };
  questionnaireExtension({
    on: (name: string, handler: any) => events.set(name, handler),
    registerCommand: (name: string, command: any) => commands.set(name, command),
    registerEntryRenderer() {}, registerTool: (definition: any) => { tool = definition; }, appendEntry() {},
    sendUserMessage: (...args: any[]) => sent.push(args),
  } as unknown as ExtensionAPI);
  return { ctx, sent, notifications,
    command: (name: string, args = "") => commands.get(name).handler(args, ctx),
    execute: (signal: AbortSignal) => tool.execute("fry-me-active-test", demoQuestionnaire, signal, undefined, ctx),
    shutdown: () => events.get("session_shutdown")({}, ctx),
  };
}

test("/fry-me forwards canonical skill with expansion and preserves exact topic arguments", async () => {
  const h = harness();
  const topic = "  Plan a trip.\nMock only; café /fry-me $ARGUMENTS  ";
  await h.command("fry-me", topic);
  assert.deepEqual(h.sent, [[`/skill:fry-me ${topic}`, { expandPromptTemplates: true }]]);
  await h.command("fry-me");
  assert.deepEqual(h.sent[1], ["/skill:fry-me", { expandPromptTemplates: true }]);
});

test("/fry-me queues a busy session as followUp rather than steering", async () => {
  const h = harness(false); await h.command("fry-me", "topic");
  assert.deepEqual(h.sent, [["/skill:fry-me topic", { expandPromptTemplates: true, deliverAs: "followUp" }]]);
});

test("/fry-me refuses active questionnaire replacement and ignores disposed contexts", async () => {
  const h = harness(); await h.command("questionnaire-demo");
  await h.command("fry-me", "replacement");
  assert.equal(h.sent.length, 0);
  assert.match(h.notifications[0][0], /Finish or cancel/);
  h.shutdown();
  h.ctx.ui.notify = () => assert.fail("stale context must not notify");
  h.ctx.isIdle = () => assert.fail("stale context must not inspect session");
  await h.command("fry-me", "stale");
  assert.equal(h.sent.length, 0);
});

test("/fry-me cannot replace a waiting agent tool round and resumes after cancellation", async () => {
  const h = harness(false);
  const controller = new AbortController();
  const pending = h.execute(controller.signal);
  try {
    await h.command("fry-me", "replacement");
    assert.equal(h.sent.length, 0);
    assert.match(h.notifications[0][0], /Finish or cancel/);
  } finally {
    controller.abort();
  }
  assert.equal((await pending).details.status, "cancelled");
  await h.command("fry-me", "new interview");
  assert.deepEqual(h.sent, [["/skill:fry-me new interview", { expandPromptTemplates: true, deliverAs: "followUp" }]]);
});

test("Pi public skill loader discovers fry-me for model invocation without global installation", () => {
  const dir = fileURLToPath(new URL("../../skills/fry-me/", import.meta.url));
  const { skills, diagnostics } = loadSkillsFromDir({ dir, source: "fry-me-test" });
  assert.deepEqual(diagnostics, []);
  assert.equal(skills.length, 1);
  assert.equal(skills[0].name, "fry-me");
  assert.equal(skills[0].disableModelInvocation, false);
  assert.equal(skills[0].filePath, `${dir}SKILL.md`);
  assert.match(formatSkillsForPrompt(skills, "read"), /<name>fry-me<\/name>/);
});

test("fry-me skill is model-invokable and reads grilling directly with questionnaire safety", () => {
  const skill = readFileSync(new URL("../../skills/fry-me/SKILL.md", import.meta.url), "utf8");
  const frontmatter = skill.match(/^---\n([\s\S]*?)\n---\n/)!;
  assert.ok(frontmatter);
  assert.match(frontmatter[1], /^name: fry-me$/m);
  assert.match(frontmatter[1], /^description: .+/m);
  assert.doesNotMatch(frontmatter[1], /disable-model-invocation/);
  assert.match(skill, /Read.*grilling.*`read`/);
  assert.match(skill, /references\/grilling\.md/);
  const base = readFileSync(new URL("../../skills/fry-me/references/grilling.md", import.meta.url), "utf8");
  assert.match(base, /design tree/);
  assert.match(base, /frontier/);
  assert.doesNotMatch(skill, /~\/\.agents|\/home\//);
  assert.doesNotMatch(skill, /Skill tool|grill-me\/SKILL\.md/);
  for (const requirement of ["questionnaire", "recommended", "multiple", "additive", "cancelled", "confirmation", "interview_request", "structuredReply", "original supervisor request ID"])
    assert.ok(skill.includes(requirement), `missing ${requirement}`);
});
