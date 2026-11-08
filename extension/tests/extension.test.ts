import assert from "node:assert/strict";
import { test } from "node:test";
import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import questionnaireExtension, { QuestionnaireCard, demoQuestionnaire, type Snapshot } from "../index.ts";

// Only the extension's registration/UI boundary is mocked; execute and renderers are real.
function harness(mode = "tui") {
  const events = new Map<string, (...args: any[]) => any>();
  const commands = new Map<string, { handler: (...args: any[]) => Promise<void> }>();
  const entries: any[] = [];
  let branch: any[] = entries;
  const messages: any[] = []; const widgets: any[] = []; const notifications: any[] = [];
  let tool: any; let renderer: any; let customCard: QuestionnaireCard | undefined; let done: (() => void) | undefined;
  const theme = { fg: (_color: string, text: string) => text } as Theme;
  const tui = { requestRender() {}, terminal: { rows: 24 } };
  const ctx = { mode, sessionManager: { getBranch: () => branch }, ui: {
    setWidget: (...args: any[]) => { widgets.push(args); if (typeof args[1] === "function") args[1](tui); },
    notify: (...args: any[]) => notifications.push(args), editor: async () => "fallback detail",
    custom: (factory: any) => new Promise<void>(resolve => { done = resolve; customCard = factory(tui, theme, {}, resolve); }),
  } };
  questionnaireExtension({
    on: (name: string, handler: any) => { events.set(name, handler); },
    registerCommand: (name: string, command: any) => { commands.set(name, command); },
    registerEntryRenderer: (_name: string, handler: any) => { renderer = handler; },
    appendEntry: (customType: string, data: any) => entries.push({ type: "custom", customType, data }),
    registerTool: (definition: any) => { tool = definition; }, sendMessage: (message: any) => messages.push(message),
  } as unknown as ExtensionAPI);
  const execute = (id = "tool-1", signal?: AbortSignal, onUpdate?: (result: any) => void) =>
    tool.execute(id, structuredClone(demoQuestionnaire), signal, onUpdate, ctx) as Promise<{ details: Snapshot; content: { type: string; text: string }[] }>;
  const emit = (name: string, event: any = {}) => events.get(name)!(event, ctx);
  return { ctx, theme, tui, tool, execute, emit, messages, entries, widgets, notifications,
    setBranch: (value: any[]) => { branch = value; },
    get displayEntries() { return entries.filter(entry => entry.customType === "questionnaire-prototype:card"); },
    get results() { return entries.filter(entry => entry.customType === "questionnaire-prototype:result"); },
    command: (name: string) => commands.get(name)!.handler("", ctx),
    renderer: (...args: any[]) => renderer(...args), get customCard() { return customCard; }, closeCustom: () => done?.() };
}
test("questionnaire execute guards non-TUI with parent-routing guidance", async () => {
  for (const mode of ["rpc", "json", "print"]) await assert.rejects(harness(mode).execute(), /parent session.*correlated JSON/);
});
test("questionnaire exact interactive OK submits while other input/images/sources pass through", async () => {
  const h = harness(); const updates: Snapshot[] = [];
  assert.equal(h.emit("input", { source: "interactive", text: "OK" }).action, "continue");
  const pending = h.execute("busy", undefined, r => updates.push(r.details));
  assert.equal(updates[0].status, "pending");
  for (const event of [
    { source: "interactive", text: "OK please continue" }, { source: "interactive", text: "/answers" },
    { source: "extension", text: "OK" }, { source: "rpc", text: "OK" },
    { source: "interactive", text: "OK", images: [{ type: "image" }] },
  ]) assert.equal(h.emit("input", event).action, "continue");
  assert.equal(h.emit("input", { source: "interactive", text: "  oK  " }).action, "handled");
  const result = await pending;
  assert.equal(result.details.status, "submitted"); assert.equal(result.details.requestId, "busy");
  assert.deepEqual(result.details.answers[0].selected, ["small"]);
  assert.equal(h.widgets.at(-1)[1], undefined);
  assert.equal(h.emit("input", { source: "interactive", text: "OK" }).action, "continue");
});
test("main editor OK commits an open transcript draft into the same tool result", async () => {
  for (const notes of [true, false]) {
    const h = harness(); let focused: any = null;
    Object.assign(h.tui, { getFocusedComponent: () => focused, setFocus: (component: any) => { focused = component; } });
    const pending = h.execute("draft-ok");
    const card = h.renderer(h.displayEntries[0], {}, h.theme) as QuestionnaireCard;
    click(card, notes ? "[Add general thoughts]" : "Other / extra"); card.handleInput("Unsubmitted draft 日本語");
    assert.equal(h.displayEntries[0].data.roundNotes, "");
    assert.equal(h.emit("input", { source: "interactive", text: "OK" }).action, "handled");
    const result = await pending;
    assert.equal(notes ? result.details.roundNotes : result.details.answers[0].extra, "Unsubmitted draft 日本語");
    assert.deepEqual(JSON.parse(result.content[0].text), JSON.parse(JSON.stringify(result.details)));
    assert.equal(h.results[0].data, result.details);
  }
});
test("Cancel tool content explicitly leaves every question open, with no accepted notes or answers", async () => {
  const h = harness(); const pending = h.execute("cancel-notes");
  const card = h.renderer(h.displayEntries[0], {}, h.theme) as QuestionnaireCard;
  click(card, "[Add general thoughts]"); await Promise.resolve();
  click(card, "Full implementation"); click(card, "Cancel round");
  const result = JSON.parse((await pending).content[0].text);
  assert.equal(result.status, "cancelled"); assert.equal(result.roundNotes, "");
  assert.deepEqual(result.answers, []);
  assert.match(result.agentInstruction, /Every question.*open and unanswered/);
  assert.match(result.agentInstruction, /Do not treat.*recommendations.*defaults.*notes/);
});
test("questionnaire rejects a concurrent cross-entry request without replacing the active one", async () => {
  const h = harness(); const first = h.execute("first");
  await assert.rejects(h.execute("second"), /first.*still active/);
  await h.command("questionnaire-demo"); assert.equal(h.displayEntries.length, 1);
  h.emit("input", { source: "interactive", text: "OK" });
  assert.equal((await first).details.requestId, "first");
});
test("questionnaire abort, pre-abort and shutdown settle cancellation without answers, allowing next request", async () => {
  for (const method of ["abort", "pre-abort", "shutdown"]) {
    const h = harness(); const controller = new AbortController();
    if (method === "pre-abort") controller.abort();
    const pending = h.execute("cancelled", controller.signal);
    if (method === "abort") controller.abort();
    const entriesBeforeShutdown = h.entries.length;
    if (method === "shutdown") h.emit("session_shutdown");
    const result = await pending;
    if (method === "shutdown") assert.equal(h.entries.length, entriesBeforeShutdown);
    assert.equal(result.details.status, "cancelled"); assert.deepEqual(result.details.answers, []);
    assert.match(result.details.reason!, method === "shutdown" ? /shutdown or reload/ : /aborted/);
    h.emit("session_start");
    const next = h.execute("next"); h.emit("input", { source: "interactive", text: "OK" });
    assert.equal((await next).details.status, "submitted");
  }
});
test("questionnaire tool renderer stays compact; live entry reuses the same card", async () => {
  const h = harness(); let update: any;
  assert.ok(h.tool.renderResult({}, {}, h.theme, {}).render(30).length);
  assert.ok(h.tool.renderCall({}, h.theme).render(30).length);
  const pending = h.execute("render", undefined, r => { update = r; });
  assert.equal(h.displayEntries.length, 1); assert.equal(h.messages.length, 0);
  assert.ok(!(h.tool.renderResult(update, {}, h.theme, {}) instanceof QuestionnaireCard));
  const entry = h.displayEntries[0]; const card = h.renderer(entry, {}, h.theme);
  assert.ok(card instanceof QuestionnaireCard);
  assert.equal(h.renderer(entry, {}, h.theme), card);
  h.emit("input", { source: "interactive", text: "OK" }); await pending;
  assert.equal(h.displayEntries.length, 1); assert.equal(h.results.length, 1);
  assert.ok(card.render(100).some((line: string) => line.includes("submitted")));
  assert.ok(card.render(100).some((line: string) => line.includes("[ Submit round ]")));
  assert.equal(entry.data.status, "pending");
});
test("the extension briefs the agent through a system prompt section", () => {
  const h = harness(); const options = { sections: {} as Record<string, string> };
  h.emit("before_agent_start", { systemPromptOptions: options });
  assert.match(options.sections["interactive-questionnaire"], /questionnaire` rounds/);
});
test("/answers opens the same card, can close without settling, and closes on submission", async () => {
  const h = harness(); await h.command("answers"); assert.equal(h.notifications.length, 1);
  const pending = h.execute(); const sheet = h.command("answers");
  assert.ok(h.customCard instanceof QuestionnaireCard); h.customCard.render(80);
  h.customCard.handleInput("\x1b"); await sheet;
  const reopened = h.command("answers"); h.customCard!.render(80);
  h.emit("input", { source: "interactive", text: "OK" });
  await reopened; assert.equal((await pending).details.status, "submitted");
});
test("/questionnaire-demo keeps one visible entry; shutdown never appends stale final data", async () => {
  const h = harness(); await h.command("questionnaire-demo");
  assert.equal(h.displayEntries.length, 1); const initial = h.displayEntries[0];
  const component = h.renderer(initial, {}, h.theme);
  assert.equal(h.renderer(initial, {}, h.theme), component);
  h.emit("input", { source: "interactive", text: "OK" }); await Promise.resolve();
  assert.equal(h.displayEntries.length, 1); assert.equal(h.results[0].data.status, "submitted");
  assert.equal(initial.data.status, "pending");
  await h.command("questionnaire-demo"); assert.equal(h.displayEntries.length, 2);
  const length = h.entries.length;
  h.emit("session_shutdown"); await Promise.resolve(); assert.equal(h.entries.length, length);
  await assert.rejects(h.execute("stale"), /inactive/);
  const reloaded = harness();
  assert.ok(reloaded.renderer(initial, {}, reloaded.theme).render(100).some((line: string) => line.includes("inactive history")));
});

test("stale questionnaire commands never use an invalidated UI context after shutdown", async () => {
  for (const mode of ["tui", "rpc"]) {
    const h = harness(mode);
    h.emit("session_shutdown");
    const entries = h.entries.length;
    h.ctx.ui.notify = () => { assert.fail("shutdown context must not notify"); };
    h.ctx.ui.custom = () => { assert.fail("shutdown context must not open a sheet"); };
    await h.command("answers");
    await h.command("questionnaire-demo");
    await assert.rejects(h.execute("stale"), /inactive/);
    assert.equal(h.entries.length, entries);
  }
});

test("history navigation persists cancellation on the original branch and stale callbacks are inert", async () => {
  const h = harness(); await h.command("questionnaire-demo");
  const initial = h.displayEntries[0]; const card = h.renderer(initial, {}, h.theme);
  h.emit("session_before_tree");
  assert.equal(h.results[0].data.status, "cancelled");
  assert.deepEqual(h.results[0].data.answers, []);
  assert.match(h.results[0].data.reason, /History navigation/);
  card.handleInput(" ");
  assert.ok(!card.render(100).some((line: string) => line.includes("Submit round")));
  assert.equal(h.emit("input", { source: "interactive", text: "OK" }).action, "continue");
  h.emit("session_tree");
  await h.command("questionnaire-demo");
  assert.notEqual(h.displayEntries[1].data.requestId, initial.data.requestId);
  h.emit("session_shutdown");
});

function click(card: QuestionnaireCard, label: string) {
  const lines = card.render(100); const y = lines.findIndex(line => line.includes(label));
  assert.notEqual(y, -1, `missing ${label}`);
  card.handleMouse({ type: "click", button: "left", x: 3, y, screenX: 3, screenY: y,
    width: 100, height: lines.length, shift: false, alt: false, ctrl: false });
}
test("real execute entry mouse choices and button submit return the changed human answer exactly once", async () => {
  const h = harness(); const pending = h.execute("button");
  const card = h.renderer(h.displayEntries[0], {}, h.theme);
  click(card, "Full implementation"); click(card, "Other / extra"); await Promise.resolve();
  click(card, "Submit round");
  const answer = (await pending).details;
  assert.deepEqual(answer.answers[0].selected, ["full"]);
  assert.equal(answer.answers[0].extra, "fallback detail");
  card.handleInput(" "); h.emit("session_before_tree");
  assert.equal(h.displayEntries.length, 1); assert.equal(h.results.length, 1);
  assert.equal(h.results[0].data, answer); assert.ok(Object.isFrozen(answer));
});

test("branch replay restores frozen submitted/cancelled answers, excludes abandoned results, pending stays inactive", async () => {
  for (const cancelled of [false, true]) {
    const original = harness(); const pending = original.execute("replay");
    const card = original.renderer(original.displayEntries[0], {}, original.theme);
    click(card, "[Add general thoughts]"); await Promise.resolve();
    click(card, "Full implementation"); click(card, cancelled ? "Cancel round" : "Submit round");
    const final = (await pending).details;
    assert.equal(final.roundNotes, cancelled ? "" : "fallback detail");
    const reloaded = harness();
    const branch = structuredClone(original.entries);
    reloaded.setBranch(branch); reloaded.emit("session_start");
    const restored = reloaded.renderer(branch[0], {}, reloaded.theme) as QuestionnaireCard;
    assert.deepEqual(restored.source, final); assert.notEqual(restored.source, branch[1].data);
    const restoredSnapshot = restored.source as Snapshot;
    assert.ok(Object.isFrozen(restoredSnapshot)); assert.ok(Object.isFrozen(restoredSnapshot.answers));
    assert.throws(() => { restoredSnapshot.answers.push({} as any); }, TypeError);
    clickInert(restored);
    assert.deepEqual(restored.source, final);
    reloaded.setBranch([branch[0]]); reloaded.emit("session_tree");
    const inactive = reloaded.renderer(branch[0], {}, reloaded.theme);
    assert.ok(inactive.render(100).some((line: string) => line.includes("inactive history")));
    assert.notEqual(inactive, restored);
    reloaded.setBranch(branch); reloaded.emit("session_tree");
    assert.deepEqual(reloaded.renderer(branch[0], {}, reloaded.theme).source, final);
  }
});
function clickInert(card: QuestionnaireCard) {
  const submitted = (card.source as Snapshot).status === "submitted";
  assert.equal(card.render(100).some(line => line.includes("Submit round")), submitted);
  card.handleInput(" ");
  card.handleMouse({ type: "click", button: "left", x: 0, y: 0, screenX: 0, screenY: 0,
    width: 100, height: 30, shift: false, alt: false, ctrl: false });
}
