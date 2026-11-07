import assert from "node:assert/strict";
import { test } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Api, AssistantMessageEvent, Message, Model, TranscriptContext } from "@earendil-works/pi-ai";
import testProvider, { streamQuestionnaireTest, testApi, testProviderName, testQuestionnaire } from "../test-provider.ts";
import { QuestionnaireState, validateQuestionnaire } from "../state.ts";
import questionnaireExtension, { QuestionnaireCard, type Snapshot } from "../index.ts";

const model: Model<Api> = { id: "local", name: "test", api: testApi, provider: testProviderName,
  baseUrl: "in-process:questionnaire-test", reasoning: false, input: ["text"], contextWindow: 128000,
  maxTokens: 8192, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
// Test fixture supplies an already-normalized message list, without a real provider or credentials.
const context = (messages: Message[] = [{ role: "user", content: "ask", timestamp: 0 }]) => ({ messages }) as TranscriptContext;
async function collect(stream: ReturnType<typeof streamQuestionnaireTest>) {
  const events: AssistantMessageEvent[] = [];
  for await (const event of stream) events.push(structuredClone(event));
  return { events, result: await stream.result() };
}
test("test-provider registers only explicitly loaded local test models", () => {
  let name = ""; let config: any;
  testProvider({ registerProvider: (n: string, c: any) => { name = n; config = c; } } as unknown as ExtensionAPI);
  assert.equal(name, "questionnaire-test"); assert.equal(config.streamSimple, streamQuestionnaireTest);
  assert.deepEqual(config.models.map((m: any) => m.id), ["local", "local-large"]);
  assert.equal(config.apiKey, "test-only-not-a-credential");
});
test("test-provider emits balanced tool events, hooks, zero usage and no fetch", async () => {
  const hooks: string[] = []; let fetches = 0;
  const stream = streamQuestionnaireTest(model, context(), {
    fetch: async () => { fetches++; throw new Error("Network forbidden"); },
    onPayload: payload => { hooks.push("payload"); return payload; },
    onResponse: response => { hooks.push("response"); assert.equal(response.status, 200); },
    onProviderStreamEvent: event => { hooks.push((event as { type: string }).type); },
  });
  const { events, result } = await collect(stream);
  assert.deepEqual(events.map(e => e.type), ["start", "toolcall_start", "toolcall_delta", "toolcall_end", "done"]);
  assert.deepEqual(hooks, ["payload", "response", "start", "toolcall_start", "toolcall_delta", "toolcall_end", "done"]);
  assert.equal(fetches, 0); assert.equal(result.stopReason, "toolUse"); assert.equal(result.usage.totalTokens, 0);
  assert.equal(result.usage.cost.total, 0);
  const block = result.content[0]; assert.equal(block.type, "toolCall");
  if (block.type !== "toolCall") return;
  assert.equal(block.name, "questionnaire"); assert.equal(block.id, "questionnaire-test-1");
  assert.deepEqual(block.arguments, testQuestionnaire());
  // `partial` is deliberately shared live state; queued events need not retain empty arguments.
  const delta = events[2]; assert.equal(delta.type, "toolcall_delta");
  if (delta.type === "toolcall_delta") assert.deepEqual(JSON.parse(delta.delta), testQuestionnaire());
});
test("test-provider echoes the actual submitted, additive, cancelled or error tool result, never invents an answer", async () => {
  for (const cancelled of [false, true]) {
    const state = new QuestionnaireState("correlated-call", testQuestionnaire());
    state.toggle("scope", "full"); state.setExtra("scope", "Actual human detail 日本語🙂");
    const snapshot = state.finish(cancelled, cancelled ? "human cancelled" : undefined);
    const text = JSON.stringify(snapshot);
    const { events, result } = await collect(streamQuestionnaireTest(model, context([
      { role: "toolResult", toolCallId: "correlated-call", toolName: "questionnaire", content: [{ type: "text", text }], isError: cancelled, timestamp: 0 },
    ])));
    assert.deepEqual(events.map(e => e.type), ["start", "text_start", "text_delta", "text_end", "done"]);
    assert.equal(result.stopReason, "stop");
    assert.equal(result.content[0].type, "text");
    if (result.content[0].type === "text") assert.ok(result.content[0].text.endsWith(text));
  }
});
test("test-provider round trip waits for real questionnaire input and echoes its correlated human answer", async () => {
  const { result: request } = await collect(streamQuestionnaireTest(model, context()));
  const call = request.content[0];
  if (call.type !== "toolCall") assert.fail("expected questionnaire tool call");
  const handlers = new Map<string, (...args: any[]) => any>();
  let tool: any; let renderer: any; const entries: any[] = [];
  questionnaireExtension({
    on: (name: string, handler: any) => handlers.set(name, handler),
    registerCommand() {},
    registerEntryRenderer: (_name: string, handler: any) => { renderer = handler; },
    appendEntry: (customType: string, data: any) => { entries.push({ customType, data }); },
    registerTool: (definition: any) => { tool = definition; },
  } as unknown as ExtensionAPI);
  const theme = { fg: (_color: string, text: string) => text };
  const ctx = { mode: "tui", ui: { setWidget() {}, editor: async () => "Round-trip detail 日本語🙂" } };
  const controller = new AbortController();
  let update: any; let settled = false;
  const pending = tool.execute(call.id, call.arguments, controller.signal, (value: any) => { update = value; }, ctx)
    .then((value: { details: Snapshot; content: { type: "text"; text: string }[] }) => { settled = true; return value; });
  try {
    await Promise.resolve();
    assert.equal(settled, false); assert.equal(update.details.status, "pending");
    assert.equal(entries.length, 1);
    const card = renderer(entries[0], {}, theme);
    assert.ok(card instanceof QuestionnaireCard);
    const click = (label: string) => {
      const lines = card.render(100); const y = lines.findIndex(line => line.includes(label));
      assert.notEqual(y, -1, `missing ${label}`);
      card.handleMouse({ type: "click", button: "left", x: 3, y, screenX: 3, screenY: y,
        width: 100, height: lines.length, shift: false, alt: false, ctrl: false });
    };
    click("Full implementation"); click("Other / extra");
    await Promise.resolve(); // The mocked editor resolves through the real additive-detail fallback.
    const input = handlers.get("input")!;
    assert.equal(input({ source: "interactive", text: "unrelated prose" }, ctx).action, "continue");
    await Promise.resolve(); assert.equal(settled, false);
    assert.equal(input({ source: "interactive", text: " OK " }, ctx).action, "handled");
    const answer = await pending;
    assert.equal(answer.details.status, "submitted"); assert.equal(answer.details.requestId, call.id);
    assert.equal(answer.details.resultId, `${call.id}:result`);
    assert.deepEqual(answer.details.answers[0].selected, ["full"]);
    assert.equal(answer.details.answers[0].extra, "Round-trip detail 日本語🙂");
    const { result: echo } = await collect(streamQuestionnaireTest(model, context([
      { role: "user", content: "ask", timestamp: 0 }, request,
      { role: "toolResult", toolCallId: call.id, toolName: call.name, content: answer.content, isError: false, timestamp: 0 },
    ])));
    assert.equal(echo.stopReason, "stop");
    const text = echo.content[0]; if (text.type !== "text") assert.fail("expected answer echo");
    assert.equal(text.text, `TEST ONLY — actual questionnaire tool result:\n${JSON.stringify(answer.details)}`);
  } finally {
    controller.abort();
    await pending;
  }
});
test("test-provider uses large model for 18 unique scroll questions and honors replacement payload", async () => {
  const large = testQuestionnaire(true); validateQuestionnaire(large);
  assert.equal(large.questions.length, 18); assert.equal(new Set(large.questions.map(q => q.id)).size, 18);
  const { result } = await collect(streamQuestionnaireTest({ ...model, id: "local-large" }, context()));
  const block = result.content[0]; assert.equal(block.type, "toolCall");
  if (block.type === "toolCall") assert.deepEqual(block.arguments, large);
  const replacement = testQuestionnaire(); replacement.title = "Hook replacement";
  const replaced = await collect(streamQuestionnaireTest(model, context(), { onPayload: () => ({ questionnaire: replacement }) }));
  const replacedBlock = replaced.result.content[0];
  if (replacedBlock.type !== "toolCall") assert.fail("expected toolCall");
  assert.deepEqual(replacedBlock.arguments, replacement);
});
test("test-provider aborts before/after start and hook failures terminate once without hanging", async () => {
  for (const afterStart of [false, true]) {
    const controller = new AbortController(); if (!afterStart) controller.abort();
    const { events, result } = await collect(streamQuestionnaireTest(model, context(), {
      signal: controller.signal, onProviderStreamEvent: event => { if ((event as { type: string }).type === "toolcall_start") controller.abort(); },
    }));
    assert.equal(result.stopReason, "aborted"); assert.match(result.errorMessage!, /aborted/);
    assert.equal(events.filter(e => e.type === "done" || e.type === "error").length, 1);
    assert.equal(events.at(-1)!.type, "error");
    assert.equal(events[0].type, afterStart ? "start" : "error");
  }
  const { events, result } = await collect(streamQuestionnaireTest(model, context(), { onPayload: () => { throw new Error("synthetic failure"); } }));
  assert.deepEqual(events.map(e => e.type), ["error"]); assert.equal(result.stopReason, "error");
  assert.equal(result.errorMessage, "synthetic failure");
});
