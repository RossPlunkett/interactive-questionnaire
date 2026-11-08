import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { Input, Key, matchesKey, Text, truncateToWidth, wrapTextWithAnsi,
  type Component, type TUI, type TuiMouseEvent, type TuiMouseEventResult } from "@earendil-works/pi-tui";
import { randomUUID } from "node:crypto";
import { QuestionnaireSchema, QuestionnaireState, demoQuestionnaire, type Questionnaire, type Snapshot } from "./state.ts";
export { QuestionnaireSchema, QuestionnaireState, demoQuestionnaire, validateQuestionnaire } from "./state.ts";
export type { Questionnaire, Snapshot, Answer } from "./state.ts";

type FocusTUI = TUI & { getFocusedComponent?: () => Component | null };
const roundNotesTarget = Symbol("round-notes");
type TextTarget = string | typeof roundNotesTarget;
type Action = { kind: "option"; questionId: string; optionId: string } | { kind: "extra"; questionId: string } | { kind: "notes" | "submit" | "cancel" };
interface CardOptions {
  refresh: () => void;
  tui?: FocusTUI;
  keyboard?: boolean;
  maxHeight?: () => number;
  editFallback?: (questionId: string) => void;
  editRoundNotesFallback?: () => void;
  close?: () => void;
}

/** Same native component for transcript cards and the focused /answers sheet. */
export class QuestionnaireCard implements Component {
  private cursor = 0;
  private rows = new Map<number, number>();
  private actions: Action[] = [];
  private input = new Input({ prompt: "> " });
  private editing?: TextTarget;
  private previousFocus: Component | null = null;
  private ownsFocus = false;
  private _focused = false;
  private hovered?: number;
  private inputRow = -1;
  private disposed = false;
  private unsubscribe?: () => void;
  constructor(readonly source: QuestionnaireState | Snapshot, public theme: Theme, private options: CardOptions) {
    if (source instanceof QuestionnaireState && source.status === "pending") {
      const onChange = () => {
        if (source.status !== "pending") {
          this.unsubscribe?.();
          this.unsubscribe = undefined;
          this.endEdit();
          this.options.close?.();
        }
        this.options.refresh();
      };
      source.listeners.add(onChange);
      this.unsubscribe = () => source.listeners.delete(onChange);
    }
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.endEdit();
  }
  get focused(): boolean { return this._focused; }
  set focused(value: boolean) { this._focused = value; this.input.focused = value && !!this.editing; }
  private get live(): QuestionnaireState | undefined {
    return !this.disposed && this.source instanceof QuestionnaireState && this.source.status === "pending" ? this.source : undefined;
  }
  private endEdit(value?: string): void {
    const id = this.editing;
    this.editing = undefined;
    this.input.focused = false;
    if (this.ownsFocus) {
      if (this.options.tui?.getFocusedComponent?.() === this) this.options.tui.setFocus(this.previousFocus);
      this.previousFocus = null;
      this.ownsFocus = false;
    }
    if (id !== undefined && value !== undefined) {
      if (id === roundNotesTarget) this.live?.setRoundNotes(value);
      else this.live?.setExtra(id, value);
    }
    this.options.refresh();
  }
  commitDraft(): void {
    if (this.editing !== undefined) this.endEdit(this.input.getValue());
  }
  private edit(questionId: TextTarget): void {
    const state = this.live;
    if (!state) return;
    const tui = this.options.tui;
    if (!this.options.keyboard && typeof tui?.getFocusedComponent !== "function") {
      if (questionId === roundNotesTarget) this.options.editRoundNotesFallback?.();
      else this.options.editFallback?.(questionId);
      return;
    }
    if (this.editing) this.endEdit(this.input.getValue());
    this.editing = questionId;
    // Each detail editor owns its undo, kill-ring and in-progress paste state.
    this.input = new Input({ prompt: "> " });
    this.input.onSubmit = value => this.endEdit(value);
    this.input.onEscape = () => this.endEdit();
    this.input.setValue(questionId === roundNotesTarget ? state.roundNotes : state.extra.get(questionId) ?? "");
    if (!this.options.keyboard && tui) {
      this.previousFocus = tui.getFocusedComponent!();
      this.ownsFocus = true;
      tui.setFocus(this);
    }
    this.input.focused = this.focused;
    this.options.refresh();
  }
  private activate(index: number): void {
    const state = this.live;
    const action = this.actions[index];
    if (!state || !action) return;
    this.cursor = index;
    if (action.kind === "option") state.toggle(action.questionId, action.optionId);
    else if (action.kind === "extra") this.edit(action.questionId);
    else if (action.kind === "notes") this.edit(roundNotesTarget);
    else {
      if (action.kind === "cancel") this.endEdit();
      else this.commitDraft();
      state.finish(action.kind === "cancel", action.kind === "cancel" ? "User cancelled" : undefined);
    }
    this.options.refresh();
  }
  handleInput(data: string): void {
    if (!this.live) return;
    if (this.editing) { this.input.handleInput(data); this.options.refresh(); return; }
    if (matchesKey(data, Key.escape)) { this.options.close?.(); return; }
    if (matchesKey(data, Key.up) || matchesKey(data, Key.shift("tab"))) this.cursor = (this.cursor - 1 + this.actions.length) % this.actions.length;
    else if (matchesKey(data, Key.down) || matchesKey(data, Key.tab)) this.cursor = (this.cursor + 1) % this.actions.length;
    else if (matchesKey(data, Key.enter) || data === " ") this.activate(this.cursor);
    else return;
    this.options.refresh();
  }
  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    if (!this.live) return;
    if (event.type === "move") {
      const hovered = this.editing && event.y === this.inputRow ? undefined : this.rows.get(event.y);
      if (hovered === this.hovered) return;
      this.hovered = hovered;
      return { handled: true, render: true };
    }
    if (event.button !== "left") return;
    if (this.editing && event.y === this.inputRow) {
      if (event.type === "press") {
        const result = this.input.handleMouse({ ...event, y: 0 });
        return result && { ...result, render: true };
      }
      if (event.type === "click") return { handled: true };
      return;
    }
    if (event.type !== "click") return;
    const index = this.rows.get(event.y);
    if (index === undefined) return;
    this.activate(index);
    return { handled: true, render: true };
  }
  invalidate(): void { this.input.invalidate(); }
  render(width: number): string[] {
    if (width < 1) return [];
    const snapshot = this.source instanceof QuestionnaireState ? this.source.snapshot() : this.source;
    const live = this.live;
    const lines: string[] = [];
    this.rows.clear(); this.actions = []; this.inputRow = -1;
    const add = (text: string) => lines.push(...wrapTextWithAnsi(text, width).map(line => truncateToWidth(line, width)));
    const control = (text: string, action: Action, highlighted = false) => {
      const index = this.actions.push(action) - 1;
      const start = lines.length;
      const label = `${this.options.keyboard && this.cursor === index ? "> " : "  "}${text}`;
      // Hover uses the theme's second accent (borderAccent) so it stays distinct from the selected accent.
      const color = live && this.hovered === index ? "borderAccent" : highlighted ? "accent" : "text";
      add(this.theme.fg(color, label));
      if (live) for (let row = start; row < lines.length; row++) this.rows.set(row, index);
    };
    const renderEditor = () => {
      this.inputRow = lines.length;
      lines.push(...this.input.render(width));
      add(this.theme.fg("dim", "Enter saves detail; Escape discards changes"));
    };
    add(this.theme.fg("accent", `${snapshot.questionnaire.title} — ${live ? "answering" : snapshot.status === "pending" ? "inactive history" : snapshot.status}`));
    add(this.theme.fg("dim", `Request: ${snapshot.requestId}`));
    for (const [index, q] of snapshot.questionnaire.questions.entries()) {
      const prefix = q.prompt.match(/^\s*(?:❓\s*)?(?:\*\*)?Q(\d+)(?:\*\*)?(?:\s*[-—–:]\s*|\s+)/i);
      const number = prefix?.[1] ?? String(index + 1);
      const prompt = prefix ? q.prompt.slice(prefix[0].length) : q.prompt;
      add(`${this.theme.fg("error", "❓")} ${this.theme.fg("text", "Q")}${this.theme.fg("error", this.theme.bold?.(number) ?? number)} — ${this.theme.fg("text", prompt)}`);
      const answer = snapshot.answers.find(a => a.id === q.id);
      const selected = new Set(answer?.selected ?? []);
      for (const o of q.options) control(`${q.multiple ? (selected.has(o.id) ? "[x]" : "[ ]") : (selected.has(o.id) ? "(*)" : "( )")} ${o.label}${q.recommended.includes(o.id) ? " (recommended)" : ""}`, { kind: "option", questionId: q.id, optionId: o.id }, selected.has(o.id));
      const extraText = this.editing === q.id && live ? this.input.getValue() : answer?.extra ?? "";
      control(`Other / extra (additive): ${extraText || "[Add detail]"}`, { kind: "extra", questionId: q.id }, !!extraText.trim());
      if (this.editing === q.id && live) renderEditor();
      if (answer?.usedRecommendation) add(this.theme.fg("dim", "Empty selection used explicit recommendation."));
      add("");
    }
    add(this.theme.fg("text", "Round thoughts"));
    add(this.theme.fg("dim", "Optional context for the whole round, alongside your answers."));
    const notes = this.editing === roundNotesTarget && live ? this.input.getValue() : snapshot.roundNotes ?? "";
    control(`Notes: ${notes || (live ? "[Add general thoughts]" : "None")}`, { kind: "notes" }, !!notes.trim());
    if (this.editing === roundNotesTarget && live) renderEditor();
    add("");
    if (live) {
      add(this.theme.fg("dim", "Empty selections use the marked recommendations on Submit."));
      control("[ Submit round ]", { kind: "submit" });
      add(this.theme.fg("dim", "-".repeat(width)));
      control("[ Cancel round ]", { kind: "cancel" });
      add(this.theme.fg("dim", this.options.keyboard ? "↑/↓ or Tab: move · Space/Enter: activate · Escape: return to editor" : "Click controls in fullscreen · /answers for keyboard · explicit OK submits"));
    } else {
      if (snapshot.status === "submitted") add(this.theme.fg("accent", "[ Submit round ]"));
      if (snapshot.reason) add(this.theme.fg("muted", snapshot.reason));
      if (snapshot.status === "cancelled") add(this.theme.fg("warning", "Cancelled — every question remains open and unanswered."));
    }
    const max = this.options.maxHeight?.();
    if (max && lines.length > max) {
      const selectedRow = this.editing ? this.inputRow : [...this.rows].find(([, action]) => action === this.cursor)?.[0] ?? 0;
      const start = Math.max(0, Math.min(lines.length - max, selectedRow - Math.floor(max / 2)));
      this.rows = new Map([...this.rows].filter(([row]) => row >= start && row < start + max).map(([row, action]) => [row - start, action]));
      this.inputRow -= start;
      return lines.slice(start, start + max);
    }
    return lines;
  }
}

const questionnaireBrief = "The interactive-questionnaire extension is active. When the user asks to be grilled, fried, interviewed or stress-tested on a plan or decision, run the interview as `questionnaire` rounds with clickable cards, not as prose questions.";
const widgetKey = "interactive-questionnaire:guidance";
const cardEntryType = "questionnaire-prototype:card";
const resultEntryType = "questionnaire-prototype:result";
export default function questionnaireExtension(pi: ExtensionAPI): void {
  let tui: FocusTUI | undefined;
  let active: { state: QuestionnaireState; ctx: ExtensionContext } | undefined;
  let keyboardOpen = false;
  let disposed = false;
  const finalResults = new Map<string, Snapshot>();
  const cards = new Map<string, QuestionnaireCard>();
  const refresh = () => tui?.requestRender();
  const guidance = (ctx: ExtensionContext) => ctx.ui.setWidget(widgetKey, (nativeTui) => {
    tui = nativeTui as FocusTUI;
    return new Text("Questionnaire: /answers keyboard sheet · explicit OK submits this round", 0, 0);
  }, { placement: "belowEditor" });
  const editFallback = async (state: QuestionnaireState, ctx: ExtensionContext, id: TextTarget) => {
    const value = await ctx.ui.editor(id === roundNotesTarget ? "Round thoughts" : "Other / extra (additive)",
      id === roundNotesTarget ? state.roundNotes : state.extra.get(id) ?? "");
    if (value !== undefined && active?.state === state) {
      if (id === roundNotesTarget) state.setRoundNotes(value);
      else state.setExtra(id, value);
    }
    refresh();
  };
  const begin = (requestId: string, params: Questionnaire, ctx: ExtensionContext) => {
    if (disposed) throw new Error("Questionnaire runtime is inactive after shutdown or reload");
    if (ctx.mode !== "tui") throw new Error("Questionnaire requires interactive TUI mode. Route the interview to the parent session and relay its correlated JSON answer; do not invent preferences.");
    if (active) throw new Error(`Questionnaire ${active.state.requestId} is still active. Requests must run sequentially, never replace or combine them.`);
    const state = new QuestionnaireState(requestId, params);
    active = { state, ctx };
    guidance(ctx);
    const result = new Promise<Snapshot>(resolve => {
      const onChange = () => {
        refresh();
        if (state.status === "pending") return;
        state.listeners.delete(onChange);
        const snapshot = state.snapshot();
        if (!disposed) {
          finalResults.set(snapshot.requestId, snapshot);
          pi.appendEntry(resultEntryType, snapshot);
        }
        if (active?.state === state) {
          active = undefined;
          if (!disposed) ctx.ui.setWidget(widgetKey, undefined);
        }
        resolve(snapshot);
      };
      state.listeners.add(onChange);
    });
    pi.appendEntry(cardEntryType, state.snapshot());
    return { state, result };
  };
  const card = (source: QuestionnaireState | Snapshot, theme: Theme, ctx?: ExtensionContext) => new QuestionnaireCard(source, theme, {
    tui, refresh,
    editFallback: source instanceof QuestionnaireState && ctx ? id => { void editFallback(source, ctx, id); } : undefined,
    editRoundNotesFallback: source instanceof QuestionnaireState && ctx ? () => { void editFallback(source, ctx, roundNotesTarget); } : undefined,
  });
  const clearCards = () => {
    for (const component of cards.values()) component.dispose();
    cards.clear();
  };
  const restoreBranch = (ctx: ExtensionContext) => {
    clearCards();
    finalResults.clear();
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type !== "custom" || entry.customType !== resultEntryType) continue;
      const snapshot = entry.data as Snapshot | undefined;
      if (!snapshot || (snapshot.status !== "submitted" && snapshot.status !== "cancelled")) continue;
      // Session JSON is mutable; never let an inert historical component mutate it.
      const copy = structuredClone(snapshot);
      const freeze = (value: unknown): void => {
        if (!value || typeof value !== "object") return;
        Object.values(value).forEach(freeze);
        Object.freeze(value);
      };
      freeze(copy);
      finalResults.set(copy.requestId, copy);
    }
    refresh();
  };
  pi.on("session_start", (_event, ctx) => {
    disposed = true;
    active?.state.finish(true, "Session replaced");
    tui = undefined;
    disposed = false;
    restoreBranch(ctx);
  });
  // Persist cancellation synchronously, before navigation changes the current branch.
  pi.on("session_before_tree", () => { active?.state.finish(true, "History navigation requested"); });
  pi.on("session_tree", (_event, ctx) => restoreBranch(ctx));
  pi.on("session_shutdown", () => {
    disposed = true;
    active?.state.finish(true, "Session shutdown or reload");
    clearCards();
    tui = undefined;
    finalResults.clear();
  });
  pi.on("before_agent_start", event => {
    event.systemPromptOptions.sections["interactive-questionnaire"] = questionnaireBrief;
  });
  pi.on("input", event => {
    if (active && event.source === "interactive" && !event.images?.length && /^ok$/i.test(event.text.trim())) {
      const state = active.state;
      for (const component of cards.values()) if (component.source === state) component.commitDraft();
      state.finish();
      return { action: "handled" };
    }
    return { action: "continue" };
  });
  pi.registerCommand("answers", {
    description: "Focus the active questionnaire (keyboard-only route)",
    handler: async (_args, ctx) => {
      if (disposed) return;
      if (ctx.mode !== "tui" || !active) { ctx.ui.notify("No active interactive questionnaire", "info"); return; }
      if (keyboardOpen) return;
      const state = active.state;
      keyboardOpen = true;
      try {
        await ctx.ui.custom<void>((nativeTui, theme, _kb, done) => new QuestionnaireCard(state, theme, {
          keyboard: true, refresh: () => { nativeTui.requestRender(); refresh(); }, close: () => done(),
          maxHeight: () => Math.max(3, nativeTui.terminal.rows - 4),
        }));
      } finally { keyboardOpen = false; refresh(); }
    },
  });
  pi.registerEntryRenderer<Snapshot>(cardEntryType, (entry, _options, theme) => {
    const details = entry.data;
    if (!details) return new Text("Questionnaire snapshot unavailable", 0, 0);
    const state = active?.state.requestId === details.requestId && active.state.snapshot().resultId === details.resultId ? active.state : undefined;
    const final = finalResults.get(details.requestId);
    const source = state ?? (final?.resultId === details.resultId ? final : undefined) ?? details;
    let component = cards.get(details.requestId);
    if (component && component.source !== source) {
      component.dispose();
      component = undefined;
    }
    if (!component) {
      component = card(source, theme, state ? active?.ctx : undefined);
      cards.set(details.requestId, component);
    }
    component.theme = theme;
    return component;
  });
  pi.registerCommand("fry-me", {
    description: "Interview a plan using the fry-me skill and questionnaire rounds",
    handler: async (args, ctx) => {
      if (disposed) return;
      if (active) { ctx.ui.notify("Finish or cancel the active questionnaire first", "warning"); return; }
      pi.sendUserMessage(`/skill:fry-me${args.length ? ` ${args}` : ""}`, {
        expandPromptTemplates: true,
        ...(ctx.isIdle() ? {} : { deliverAs: "followUp" as const }),
      });
    },
  });
  pi.registerCommand("questionnaire-demo", {
    description: "Open one native questionnaire round with two questions, without a model or network",
    handler: async (_args, ctx) => {
      if (disposed) return;
      if (ctx.mode !== "tui") { ctx.ui.notify("Questionnaire demo requires interactive TUI mode", "error"); return; }
      if (active) { ctx.ui.notify("Finish or cancel the active questionnaire first", "warning"); return; }
      // Do not block the command: /answers must remain available while this round is open.
      begin(`demo:${randomUUID()}`, demoQuestionnaire, ctx);
    },
  });
  pi.registerTool({
    name: "questionnaire", label: "Questionnaire", exposure: "model-only", executionMode: "sequential",
    description: "Ask one human grilling round. Supply explicit recommended option IDs for every question. Other text is additive; roundNotes contains general user context. Wait for actual submission. A cancelled round leaves every question open and unanswered: accept no selections, recommendations, defaults, or notes. Route child interviews through their parent. One round at a time.",
    parameters: QuestionnaireSchema,
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const { state, result } = begin(toolCallId, params, ctx);
      const abort = () => state.finish(true, "Questionnaire aborted");
      signal?.addEventListener("abort", abort, { once: true });
      try {
        if (signal?.aborted) abort();
        onUpdate?.({ content: [{ type: "text", text: "Waiting for human questionnaire submission" }], details: state.snapshot() });
        const snapshot = await result;
        return { content: [{ type: "text" as const, text: JSON.stringify(snapshot) }], details: snapshot };
      } finally { signal?.removeEventListener("abort", abort); }
    },
    renderCall(_args, theme) { return new Text(theme.fg("toolTitle", "Questionnaire"), 0, 0); },
    renderResult(result, _options, theme) {
      const details = result.details as Snapshot | undefined;
      return new Text(theme.fg("dim", details
        ? `Questionnaire ${details.status} · ${details.requestId} · answers in transcript card`
        : "Preparing questionnaire…"), 0, 0);
    },
  });
}
