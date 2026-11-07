import { Type, type Static } from "typebox";

const OptionSchema = Type.Object({ id: Type.String({ minLength: 1 }), label: Type.String({ minLength: 1 }) });
export const QuestionnaireSchema = Type.Object({
  title: Type.String({ minLength: 1 }),
  questions: Type.Array(Type.Object({
    id: Type.String({ minLength: 1 }), prompt: Type.String({ minLength: 1 }),
    multiple: Type.Boolean(), options: Type.Array(OptionSchema, { minItems: 1 }),
    recommended: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
    allowExtra: Type.Optional(Type.Boolean({ description: "Legacy input; additive Other / extra is always available." })),
  }), { minItems: 1 }),
});
export type Questionnaire = Static<typeof QuestionnaireSchema>;
export interface Answer { id: string; selected: string[]; extra: string; usedRecommendation: boolean }
export interface Snapshot {
  requestId: string;
  resultId: string;
  questionnaire: Questionnaire;
  status: "pending" | "submitted" | "cancelled";
  answers: Answer[];
  roundNotes?: string;
  agentInstruction?: string;
  reason?: string;
}

function frozenCopy<T>(value: T): T {
  const copy = structuredClone(value);
  const freeze = (item: unknown): void => {
    if (item && typeof item === "object") {
      Object.values(item).forEach(freeze);
      Object.freeze(item);
    }
  };
  freeze(copy);
  return copy;
}

export function validateQuestionnaire(value: Questionnaire): void {
  if (!value || typeof value.title !== "string" || !value.title.trim() || !Array.isArray(value.questions) || !value.questions.length)
    throw new Error("A title and at least one question are required");
  const ids = new Set<string>();
  for (const q of value.questions) {
    if (!q || typeof q.id !== "string" || !q.id.trim() || ids.has(q.id)) throw new Error("Question IDs must be nonempty and unique");
    ids.add(q.id);
    if (typeof q.prompt !== "string" || !q.prompt.trim() || typeof q.multiple !== "boolean" || (q.allowExtra !== undefined && typeof q.allowExtra !== "boolean")) throw new Error(`Invalid question ${q.id}`);
    if (!Array.isArray(q.options) || !q.options.length) throw new Error(`Options required for ${q.id}`);
    const options = new Set<string>();
    for (const o of q.options) {
      if (!o || typeof o.id !== "string" || !o.id.trim() || options.has(o.id) || typeof o.label !== "string" || !o.label.trim()) throw new Error(`Invalid or duplicate option in ${q.id}`);
      options.add(o.id);
    }
    if (!Array.isArray(q.recommended) || !q.recommended.length || new Set(q.recommended).size !== q.recommended.length || q.recommended.some(id => !options.has(id)) || (!q.multiple && q.recommended.length !== 1)) throw new Error(`Explicit valid recommendations required for ${q.id}`);
  }
}

export class QuestionnaireState {
  readonly questionnaire: Questionnaire;
  readonly selected = new Map<string, Set<string>>();
  readonly extra = new Map<string, string>();
  readonly listeners = new Set<() => void>();
  status: Snapshot["status"] = "pending";
  private notes = "";
  private final?: Snapshot;
  constructor(readonly requestId: string, questionnaire: Questionnaire) {
    validateQuestionnaire(questionnaire);
    this.questionnaire = frozenCopy(questionnaire);
    for (const q of questionnaire.questions) this.selected.set(q.id, new Set(q.recommended));
  }
  changed(): void { for (const listener of this.listeners) listener(); }
  toggle(questionId: string, optionId: string): boolean {
    if (this.status !== "pending") return false;
    const q = this.questionnaire.questions.find(q => q.id === questionId);
    if (!q?.options.some(o => o.id === optionId)) return false;
    const selection = this.selected.get(questionId)!;
    if (selection.has(optionId)) selection.delete(optionId);
    else { if (!q.multiple) selection.clear(); selection.add(optionId); }
    this.changed();
    return true;
  }
  setExtra(questionId: string, text: string): boolean {
    if (this.status !== "pending" || !this.questionnaire.questions.some(q => q.id === questionId)) return false;
    this.extra.set(questionId, text);
    this.changed();
    return true;
  }
  get roundNotes(): string { return this.notes; }
  setRoundNotes(text: string): boolean {
    if (this.status !== "pending") return false;
    this.notes = text;
    this.changed();
    return true;
  }
  snapshot(): Snapshot {
    if (this.final) return this.final;
    return frozenCopy({ requestId: this.requestId, resultId: `${this.requestId}:result`, questionnaire: this.questionnaire,
      status: this.status, roundNotes: this.notes, answers: this.questionnaire.questions.map(q => ({ id: q.id,
        selected: [...this.selected.get(q.id)!], extra: this.extra.get(q.id) ?? "", usedRecommendation: false })) });
  }
  finish(cancelled = false, reason?: string): Snapshot {
    if (this.final) return this.final;
    this.status = cancelled ? "cancelled" : "submitted";
    const snapshot = this.snapshot();
    this.final = frozenCopy({ ...snapshot, reason, roundNotes: cancelled ? "" : snapshot.roundNotes,
      agentInstruction: cancelled ? "This round was cancelled. Every question in this round remains open and unanswered. Do not treat selections, recommendations, defaults, or notes as accepted answers." : undefined,
      answers: cancelled ? [] : snapshot.answers.map(a => {
      const q = this.questionnaire.questions.find(q => q.id === a.id)!;
      return a.selected.length ? a : { ...a, selected: [...q.recommended], usedRecommendation: true };
    }) });
    this.changed();
    return this.final;
  }
}

export const demoQuestionnaire: Questionnaire = {
  title: "Questionnaire prototype demo",
  questions: [
    { id: "scope", prompt: "Which scope should this prototype use?", multiple: false,
      options: [{ id: "small", label: "Small native prototype" }, { id: "full", label: "Full implementation" }], recommended: ["small"], allowExtra: true },
    { id: "proof", prompt: "Which proof should we collect? (Select several.)", multiple: true,
      options: [{ id: "tests", label: "Deterministic tests" }, { id: "desktop", label: "Desktop interaction" }, { id: "docs", label: "Usage notes" }], recommended: ["tests", "desktop"], allowExtra: true },
  ],
};
