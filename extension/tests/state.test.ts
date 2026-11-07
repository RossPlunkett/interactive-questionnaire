import assert from "node:assert/strict";
import { test } from "node:test";
import { QuestionnaireState, demoQuestionnaire, validateQuestionnaire } from "../state.ts";

const fresh = () => new QuestionnaireState("request-1", structuredClone(demoQuestionnaire));
test("QuestionnaireState preselects only explicit recommendations and copies input", () => {
  const input = structuredClone(demoQuestionnaire);
  const state = new QuestionnaireState("request-1", input);
  input.questions[0].recommended[0] = "full";
  assert.deepEqual(state.snapshot().answers.map(a => a.selected), [["small"], ["tests", "desktop"]]);
  assert.ok(Object.isFrozen(state.questionnaire.questions[0].options));
});
test("QuestionnaireState single replaces, multi toggles independently, unknown IDs do nothing", () => {
  const state = fresh();
  state.toggle("scope", "full");
  state.toggle("proof", "docs");
  state.toggle("proof", "tests");
  assert.deepEqual(state.snapshot().answers.map(a => a.selected), [["full"], ["desktop", "docs"]]);
  assert.equal(state.toggle("missing", "small"), false);
  assert.equal(state.toggle("scope", "missing"), false);
});
test("QuestionnaireState additive extra preserves choices and blank detail is allowed", () => {
  const state = fresh();
  assert.equal(state.setExtra("scope", "Also include 日本語"), true);
  assert.deepEqual(state.finish().answers[0], { id: "scope", selected: ["small"], extra: "Also include 日本語", usedRecommendation: false });
  assert.equal(fresh().setExtra("missing", "no"), false);
  const blank = fresh(); blank.setExtra("scope", "");
  assert.equal(blank.finish().answers[0].extra, "");
});
test("QuestionnaireState permits additive extra even with legacy allowExtra false or omitted", () => {
  const input = structuredClone(demoQuestionnaire);
  input.questions[0].allowExtra = false;
  delete input.questions[1].allowExtra;
  const state = new QuestionnaireState("extra-always", input);
  assert.equal(state.setExtra("scope", "false still permits additive text"), true);
  assert.equal(state.setExtra("proof", "omitted still permits additive text"), true);
});
test("QuestionnaireState empty single and multi selections use recommendations only on submission", () => {
  const state = fresh();
  state.toggle("scope", "small"); state.toggle("proof", "tests"); state.toggle("proof", "desktop");
  assert.deepEqual(state.snapshot().answers.map(a => a.selected), [[], []]);
  const final = state.finish();
  assert.equal(final.status, "submitted");
  assert.deepEqual(final.answers.map(a => a.selected), [["small"], ["tests", "desktop"]]);
  assert.ok(final.answers.every(a => a.usedRecommendation));
});
test("QuestionnaireState final snapshot is deeply frozen, stable and ignores stale actions", () => {
  const state = fresh();
  const pending = state.snapshot();
  const final = state.finish();
  assert.equal(final.requestId, "request-1"); assert.equal(final.resultId, "request-1:result");
  assert.equal(state.toggle("scope", "full"), false);
  assert.equal(state.setExtra("scope", "late"), false);
  assert.equal(state.finish(true), final);
  assert.equal(state.snapshot(), final);
  assert.throws(() => final.answers[0].selected.push("full"), TypeError);
  assert.equal(pending.status, "pending");
});
test("QuestionnaireState cancellation yields no recommendation-as-human-answer and notifies once", () => {
  const state = fresh(); let updates = 0;
  state.listeners.add(() => updates++);
  const final = state.finish(true, "aborted");
  assert.equal(final.status, "cancelled"); assert.equal(final.reason, "aborted");
  assert.deepEqual(final.answers, []);
  assert.equal(state.finish(), final); assert.equal(updates, 1);
});

const invalidCases: [string, (value: typeof demoQuestionnaire) => void][] = [
  ["empty title", v => { v.title = " "; }],
  ["no questions", v => { v.questions = []; }],
  ["blank question ID", v => { v.questions[0].id = " "; }],
  ["duplicate question ID", v => { v.questions[1].id = v.questions[0].id; }],
  ["blank prompt", v => { v.questions[0].prompt = ""; }],
  ["empty options", v => { v.questions[0].options = []; }],
  ["duplicate option ID", v => { v.questions[0].options[1].id = "small"; }],
  ["blank option ID", v => { v.questions[0].options[0].id = " "; }],
  ["blank label", v => { v.questions[0].options[0].label = " "; }],
  ["missing recommendations", v => { v.questions[0].recommended = []; }],
  ["unknown recommendation", v => { v.questions[0].recommended = ["unknown"]; }],
  ["duplicate recommendations", v => { v.questions[1].recommended = ["tests", "tests"]; }],
  ["multiple recommendations on single", v => { v.questions[0].recommended = ["small", "full"]; }],
];
for (const [name, mutate] of invalidCases) test(`validateQuestionnaire rejects ${name}`, () => {
  const input = structuredClone(demoQuestionnaire); mutate(input);
  assert.throws(() => validateQuestionnaire(input));
  assert.throws(() => new QuestionnaireState("invalid", input));
});
