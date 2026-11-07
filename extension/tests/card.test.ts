import assert from "node:assert/strict";
import { test } from "node:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth, type Component, type TUI, type TuiMouseEvent } from "@earendil-works/pi-tui";
import { QuestionnaireCard, QuestionnaireState, demoQuestionnaire } from "../index.ts";

export const theme = { fg: (_color: string, text: string) => text } as Theme;
const fresh = () => new QuestionnaireState("card-test", demoQuestionnaire);
function click(card: QuestionnaireCard, text: string, width = 100) {
  const lines = card.render(width); const y = lines.findIndex(line => line.includes(text));
  assert.notEqual(y, -1, `missing control ${text}`);
  return card.handleMouse({ type: "click", button: "left", x: 3, y, screenX: 3, screenY: y,
    width, height: lines.length, shift: false, alt: false, ctrl: false } satisfies TuiMouseEvent);
}
test("QuestionnaireCard mouse selects, adds detail via fallback and submits once; stale clicks inert", () => {
  const state = fresh(); let fallback = ""; let renders = 0;
  const card = new QuestionnaireCard(state, theme, { refresh: () => renders++, editFallback: id => { fallback = id; } });
  assert.equal(click(card, "Full implementation")?.handled, true);
  click(card, "Other / extra"); assert.equal(fallback, "scope");
  click(card, "Submit round"); assert.equal(state.status, "submitted");
  const final = state.snapshot(); assert.deepEqual(final.answers[0].selected, ["full"]);
  assert.equal(click(card, "Small native prototype"), undefined);
  assert.equal(state.snapshot(), final); assert.ok(renders > 0);
});
test("QuestionnaireCard colors only selected option lines with the live theme accent", () => {
  const state = fresh();
  const colored = { fg: (color: string, text: string) => `\x1b[${color === "accent" ? 36 : 37}m${text}\x1b[0m` } as Theme;
  const card = new QuestionnaireCard(state, colored, { refresh() {} });
  const accented = (label: string) => card.render(120).find(line => line.includes(label))!.includes("\x1b[36m");
  assert.equal(accented("Small native prototype"), true);
  assert.equal(accented("Full implementation"), false);
  click(card, "Full implementation");
  assert.equal(accented("Full implementation"), true);
  assert.equal(accented("Small native prototype"), false);
  click(card, "Full implementation"); assert.equal(accented("Full implementation"), false);
  click(card, "Usage notes");
  assert.equal(accented("Usage notes"), true); assert.equal(accented("Desktop interaction"), true);
  click(card, "Deterministic tests"); assert.equal(accented("Deterministic tests"), false);
  card.theme = { fg: (color: string, text: string) => `\x1b[${color === "accent" ? 35 : 37}m${text}\x1b[0m` } as Theme;
  card.invalidate();
  assert.ok(card.render(120).find(line => line.includes("Usage notes"))!.includes("\x1b[35m"));
});
test("QuestionnaireCard extra preview wraps and changes color while typing, clearing, saving and discarding", () => {
  const state = fresh();
  const colored = { fg: (color: string, text: string) => `\x1b[${color === "accent" ? 36 : 37}m${text}\x1b[0m` } as Theme;
  const card = new QuestionnaireCard(state, colored, { keyboard: true, refresh() {} });
  const extraLine = () => card.render(100).find(line => line.includes("Other / extra"))!;
  assert.ok(!extraLine().includes("\x1b[36m"));
  click(card, "Other / extra");
  const detail = "A long additive note with 日本語 and enough words to wrap across several narrow lines.";
  card.handleInput(detail);
  assert.ok(extraLine().includes("\x1b[36m"));
  const lines = card.render(32);
  const start = lines.findIndex(line => line.includes("Other / extra"));
  const editor = lines.findIndex((line, i) => i > start && line.startsWith("> "));
  assert.ok(editor > start + 1, "draft preview wraps above the single-line editor");
  assert.ok(lines.slice(start, editor).every(line => line.includes("\x1b[36m")));
  assert.ok(lines.every(line => visibleWidth(line) <= 32));
  assert.equal(state.extra.get("scope"), undefined, "preview does not save a draft");
  card.handleInput("\r"); assert.equal(state.extra.get("scope"), detail);
  click(card, "Other / extra"); card.handleInput("\x01"); card.handleInput("\x0b");
  assert.ok(!extraLine().includes("\x1b[36m"));
  card.handleInput("\x1b"); assert.ok(extraLine().includes("\x1b[36m"));
  click(card, "Other / extra"); card.handleInput("\x01"); card.handleInput("\x0b"); card.handleInput("\r");
  assert.equal(state.extra.get("scope"), ""); assert.ok(!extraLine().includes("\x1b[36m"));
});
test("QuestionnaireCard offers additive detail for every question regardless of legacy allowExtra", () => {
  const input = structuredClone(demoQuestionnaire);
  input.questions[0].allowExtra = false; delete input.questions[1].allowExtra;
  const card = new QuestionnaireCard(new QuestionnaireState("always-extra", input), theme, { refresh() {} });
  assert.equal(card.render(100).filter(line => line.includes("Other / extra")).length, 2);
});
test("QuestionnaireCard round thoughts are separate, wrapped, accented, and saved with Submit", () => {
  const input = structuredClone(demoQuestionnaire); input.questions[0].id = "round-notes";
  const state = new QuestionnaireState("round-notes", input);
  state.setExtra("round-notes", "Question-specific detail");
  const colored = { fg: (color: string, text: string) => `\x1b[${color === "accent" ? 36 : 37}m${text}\x1b[0m` } as Theme;
  const card = new QuestionnaireCard(state, colored, { keyboard: true, refresh() {} });
  click(card, "[Add general thoughts]");
  const note = "General thoughts about the whole round, with 日本語 and enough context to wrap across several narrow lines.";
  card.handleInput(note);
  assert.equal(state.roundNotes, "", "a preview is not saved yet");
  const lines = card.render(32);
  const heading = lines.findIndex(line => line.includes("Round thoughts"));
  const start = lines.findIndex(line => line.includes("Notes:"));
  const editor = lines.findIndex((line, i) => i > start && line.startsWith("> "));
  assert.ok(start > heading && editor > start + 1);
  assert.ok(lines.slice(start, editor).every(line => line.includes("\x1b[36m")));
  assert.ok(lines.every(line => visibleWidth(line) <= 32));
  click(card, "Submit round");
  assert.equal(state.snapshot().roundNotes, note);
  assert.equal(state.snapshot().answers[0].extra, "Question-specific detail");
  assert.deepEqual(state.snapshot().answers[0].selected, ["small"]);
  assert.ok(card.render(120).some(line => line.includes("General thoughts about the whole round")));
  assert.equal(state.setRoundNotes("late"), false);
});
test("QuestionnaireCard round thoughts save, clear, discard and use the editor fallback independently", () => {
  const state = fresh();
  const card = new QuestionnaireCard(state, theme, { keyboard: true, refresh() {} });
  click(card, "[Add general thoughts]"); card.handleInput("Saved round note"); card.handleInput("\r");
  click(card, "Notes: Saved round note"); card.handleInput("\x01"); card.handleInput("\x0b"); card.handleInput("\x1b");
  assert.equal(state.roundNotes, "Saved round note");
  click(card, "Notes: Saved round note"); card.handleInput("\x01"); card.handleInput("\x0b"); card.handleInput("\r");
  assert.equal(state.roundNotes, "");
  let fallback = 0;
  const fallbackCard = new QuestionnaireCard(state, theme, { refresh() {}, editRoundNotesFallback: () => { fallback++; } });
  click(fallbackCard, "[Add general thoughts]"); assert.equal(fallback, 1);
  const old = structuredClone(state.snapshot()); delete old.roundNotes;
  const history = new QuestionnaireCard(old, theme, { refresh() {} });
  assert.ok(history.render(100).some(line => line.includes("Notes: None")));
});
test("QuestionnaireCard dashed button separator cannot submit or cancel, and Cancel accepts no draft", () => {
  const state = fresh(); const card = new QuestionnaireCard(state, theme, { keyboard: true, refresh() {} });
  click(card, "[Add general thoughts]"); card.handleInput("Do not accept this cancelled draft");
  const lines = card.render(100);
  const submit = lines.findIndex(line => line.includes("Submit round"));
  const cancel = lines.findIndex(line => line.includes("Cancel round"));
  assert.equal(cancel, submit + 2); assert.match(lines[submit + 1], /^-{100}$/);
  assert.equal(card.handleMouse({ type: "click", button: "left", x: 3, y: submit + 1 } as TuiMouseEvent), undefined);
  assert.equal(state.status, "pending");
  click(card, "Cancel round");
  assert.deepEqual(state.snapshot().answers, []); assert.equal(state.snapshot().roundNotes, "");
  assert.match(state.snapshot().agentInstruction!, /Every question.*open and unanswered/);
});
test("QuestionnaireCard mouse Submit saves unsaved inline detail before freezing", () => {
  const state = fresh();
  const card = new QuestionnaireCard(state, theme, { keyboard: true, refresh() {} });
  card.focused = true; card.render(100);
  card.handleInput("\t"); card.handleInput("\t"); card.handleInput("\r");
  card.handleInput("unsaved 日本語 detail"); click(card, "Submit round");
  assert.equal(state.snapshot().answers[0].extra, "unsaved 日本語 detail");
  assert.equal(state.status, "submitted");
});
test("QuestionnaireCard keyboard navigation, native Input save/discard, Escape closes without submitting", () => {
  const state = fresh(); let closed = 0;
  const card = new QuestionnaireCard(state, theme, { keyboard: true, refresh() {}, close: () => closed++ });
  card.focused = true; card.render(100);
  card.handleInput("\t"); card.handleInput(" "); // full
  card.handleInput("\t"); card.handleInput("\r"); // scope extra
  card.handleInput("additive detail"); card.handleInput("\r");
  assert.equal(state.extra.get("scope"), "additive detail");
  assert.deepEqual(state.snapshot().answers[0].selected, ["full"]);
  card.handleInput("\r"); card.handleInput("not saved"); card.handleInput("\x1b");
  assert.equal(state.extra.get("scope"), "additive detail");
  card.handleInput("\x1b"); assert.equal(closed, 1); assert.equal(state.status, "pending");
  card.render(100);
  card.handleInput("\x1b[Z"); // Shift-Tab back to full
  card.handleInput(" "); assert.deepEqual(state.snapshot().answers[0].selected, []);
});
test("QuestionnaireCard transcript native Input restores previous editor focus on save and cancellation", () => {
  const state = fresh(); const editor: Component = { render: () => [] , invalidate() {} };
  let focused: Component | null = editor;
  const tui = { getFocusedComponent: () => focused, setFocus: (c: Component | null) => {
    focused = c; if (c && "focused" in c) (c as QuestionnaireCard).focused = true;
  } } as unknown as TUI & { getFocusedComponent(): Component | null };
  const card = new QuestionnaireCard(state, theme, { tui, refresh() {} });
  click(card, "Other / extra"); assert.equal(focused, card);
  card.handleInput("detail"); card.handleInput("\r");
  assert.equal(focused, editor); assert.equal(state.extra.get("scope"), "detail");
  click(card, "Other / extra"); state.finish(true, "shutdown");
  assert.equal(focused, editor); assert.equal(state.status, "cancelled");
});
test("QuestionnaireCard keyboard reaches clipped submit and cancel controls", () => {
  for (const cancel of [false, true]) {
    const state = fresh(); let closed = false;
    const card = new QuestionnaireCard(state, theme, { keyboard: true, refresh() {}, maxHeight: () => 5, close: () => { closed = true; } });
    card.render(40);
    // Two single options + extra, three multi options + extra, round notes, submit, cancel.
    for (let i = 0; i < (cancel ? 9 : 8); i++) { card.handleInput("\x1b[B"); card.render(40); }
    assert.ok(card.render(40).some(line => line.includes(cancel ? "Cancel round" : "Submit round")));
    card.handleInput("\r");
    assert.equal(state.status, cancel ? "cancelled" : "submitted"); assert.equal(closed, true);
  }
});
test("QuestionnaireCard pending history snapshots and completed cards are inert", () => {
  const state = fresh();
  for (const snapshot of [state.snapshot(), state.finish(), fresh().finish(true, "cancel")]) {
    const card = new QuestionnaireCard(snapshot, theme, { refresh() { assert.fail("history refresh"); } });
    const before = JSON.stringify(snapshot);
    assert.equal(click(card, "Full implementation"), undefined);
    card.handleInput(" "); assert.equal(JSON.stringify(snapshot), before);
    assert.ok(!card.render(80).some(line => line.includes("Submit round")));
  }
});
test("QuestionnaireCard line widths are safe across resize, Unicode, themes and inline Input", () => {
  const input = structuredClone(demoQuestionnaire);
  input.title = "漢字🙂".repeat(10); input.questions[0].prompt = "long-word".repeat(12);
  input.questions[0].options[0].label = "e\u0301漢字🙂".repeat(8);
  const state = new QuestionnaireState("width", input);
  state.setExtra("scope", "日本語🙂".repeat(8));
  const card = new QuestionnaireCard(state, theme, { keyboard: true, refresh() {} });
  for (const width of [0, 1, 2, 4, 10, 40, 100, 20]) {
    card.invalidate(); const lines = card.render(width);
    assert.ok(lines.every(line => visibleWidth(line) <= width), `width ${width}`);
  }
  card.theme = { fg: (_c: string, text: string) => `\x1b[31m${text}\x1b[0m` } as Theme;
  card.render(40); card.handleInput("\t"); card.handleInput("\t"); card.handleInput("\r");
  card.handleInput("more text");
  for (const width of [4, 10, 40, 80]) assert.ok(card.render(width).every(line => visibleWidth(line) <= width), `input width ${width}`);
});

test("QuestionnaireCard dispose detaches listeners, discards drafts and makes stale controls inert", () => {
  const state = fresh(); let renders = 0;
  const card = new QuestionnaireCard(state, theme, { keyboard: true, refresh: () => renders++ });
  card.render(100); card.handleInput("\t"); card.handleInput("\t"); card.handleInput("\r");
  card.handleInput("discarded draft");
  assert.equal(state.listeners.size, 1);
  card.dispose(); card.dispose();
  assert.equal(state.listeners.size, 0);
  const afterDispose = renders;
  card.handleInput("\r"); click(card, "Full implementation");
  state.toggle("proof", "docs");
  assert.equal(renders, afterDispose);
  assert.equal(state.extra.get("scope"), undefined);
  assert.deepEqual(state.snapshot().answers[0].selected, ["small"]);
  assert.equal(state.status, "pending");
});
test("QuestionnaireCard settlement releases listeners even for transcript cards", () => {
  const state = fresh();
  new QuestionnaireCard(state, theme, { refresh() {} });
  assert.equal(state.listeners.size, 1);
  state.finish(); assert.equal(state.listeners.size, 0);
});
test("QuestionnaireCard detail editors isolate undo history across questions", () => {
  const state = fresh();
  const card = new QuestionnaireCard(state, theme, { keyboard: true, refresh() {} });
  click(card, "Other / extra");
  for (const key of "abc def") card.handleInput(key);
  card.handleInput("\r");
  const lines = card.render(100); const y = lines.findLastIndex(line => line.includes("Other / extra"));
  card.handleMouse({ type: "click", button: "left", x: 3, y } as TuiMouseEvent);
  card.handleInput("\x1f"); card.handleInput("\r");
  assert.equal(state.extra.get("scope"), "abc def");
  assert.equal(state.extra.get("proof"), "");
});
test("QuestionnaireCard forwards native Input press events for cursor positioning", () => {
  const state = fresh();
  const card = new QuestionnaireCard(state, theme, { keyboard: true, refresh() {} });
  click(card, "Other / extra"); card.handleInput("abcd");
  const y = card.render(100).findIndex(line => line.startsWith("> abcd"));
  assert.notEqual(y, -1);
  assert.equal(card.handleMouse({ type: "press", button: "left", x: 4, y } as TuiMouseEvent)?.handled, true);
  card.handleInput("X"); card.handleInput("\r");
  assert.equal(state.extra.get("scope"), "abXcd");
});
test("QuestionnaireCard does not steal focus from a newer dialog on cancellation", () => {
  const state = fresh(); const editor = {} as Component; const dialog = {} as Component;
  let focused: Component | null = editor;
  const tui = { getFocusedComponent: () => focused, setFocus: (value: Component | null) => { focused = value; } } as unknown as TUI;
  const card = new QuestionnaireCard(state, theme, { tui, refresh() {} });
  click(card, "Other / extra"); assert.equal(focused, card);
  focused = dialog; state.finish(true);
  assert.equal(focused, dialog);
});
test("QuestionnaireCard switching extras then Escape saves prior detail and restores editor focus", () => {
  const state = fresh(); const editor = {} as Component;
  let focused: Component | null = editor;
  const tui = { getFocusedComponent: () => focused, setFocus: (value: Component | null) => { focused = value; } } as unknown as TUI;
  const card = new QuestionnaireCard(state, theme, { tui, refresh() {} });
  click(card, "Other / extra"); card.handleInput("first detail");
  const y = card.render(100).findLastIndex(line => line.includes("Other / extra"));
  card.handleMouse({ type: "click", button: "left", x: 3, y } as TuiMouseEvent);
  assert.equal(focused, card);
  card.handleInput("discard second"); card.handleInput("\x1b");
  assert.equal(focused, editor);
  assert.equal(state.extra.get("scope"), "first detail");
  assert.equal(state.extra.get("proof"), undefined);
});
