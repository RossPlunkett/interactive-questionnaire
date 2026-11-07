/** TEST ONLY: synthetic in-process events, no HTTP client or real model. Not loaded by index.ts. */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createAssistantMessageEventStream, type Api, type AssistantMessage, type Model,
  type SimpleStreamOptions, type TranscriptContext } from "@earendil-works/pi-ai";
import { demoQuestionnaire, validateQuestionnaire, type Questionnaire } from "./state.ts";

export const testProviderName = "questionnaire-test";
export const testApi = "questionnaire-test-in-process";
export function testQuestionnaire(large = false): Questionnaire {
  if (!large) return structuredClone(demoQuestionnaire);
  return { title: "TEST ONLY — scrolling questionnaire", questions: Array.from({ length: 18 }, (_, i) => ({
    ...structuredClone(demoQuestionnaire.questions[i % 2]), id: `question-${i + 1}`,
    prompt: `Question ${i + 1}: ${demoQuestionnaire.questions[i % 2].prompt}`,
  })) };
}

export function streamQuestionnaireTest(model: Model<Api>, context: TranscriptContext, options?: SimpleStreamOptions) {
  const stream = createAssistantMessageEventStream();
  const message: AssistantMessage = {
    role: "assistant", api: model.api, provider: model.provider, model: model.id,
    timestamp: Date.now(), content: [], stopReason: "stop",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  };
  void (async () => {
    const checkAbort = () => { if (options?.signal?.aborted) throw new Error("Test provider aborted"); };
    try {
      checkAbort();
      const last = context.messages.findLast(item => item.role !== "system");
      const original = { questionnaire: testQuestionnaire(model.id === "local-large") };
      const payload = await options?.onPayload?.(original, model) ?? original;
      // Hooks can replace the synthetic payload, just as with a real request.
      const questionnaire = (payload as typeof original).questionnaire;
      validateQuestionnaire(questionnaire);
      await options?.onResponse?.({ status: 200, headers: {} }, model);
      checkAbort();
      const emit = async (event: Parameters<typeof stream.push>[0]) => {
        await options?.onProviderStreamEvent?.({ type: event.type, testOnly: true }, model);
        checkAbort();
        stream.push(event);
      };
      await emit({ type: "start", partial: message });
      if (last?.role === "toolResult" && last.toolName === "questionnaire") {
        const text = `TEST ONLY — actual questionnaire tool result${last.isError ? " (error)" : ""}:\n${last.content.filter(c => c.type === "text").map(c => c.text).join("\n")}`;
        const block = { type: "text" as const, text: "" };
        message.content.push(block);
        await emit({ type: "text_start", contentIndex: 0, partial: message });
        block.text = text;
        await emit({ type: "text_delta", contentIndex: 0, delta: text, partial: message });
        await emit({ type: "text_end", contentIndex: 0, content: text, partial: message });
        message.stopReason = "stop";
      } else {
        const ordinal = context.messages.filter(item => item.role === "assistant").length + 1;
        const block = { type: "toolCall" as const, id: `questionnaire-test-${ordinal}`, name: "questionnaire", arguments: {} };
        message.content.push(block);
        await emit({ type: "toolcall_start", contentIndex: 0, partial: message });
        block.arguments = structuredClone(questionnaire);
        await emit({ type: "toolcall_delta", contentIndex: 0, delta: JSON.stringify(questionnaire), partial: message });
        await emit({ type: "toolcall_end", contentIndex: 0, toolCall: block, partial: message });
        message.stopReason = "toolUse";
      }
      await emit({ type: "done", reason: message.stopReason, message });
    } catch (error) {
      message.stopReason = options?.signal?.aborted ? "aborted" : "error";
      message.errorMessage = error instanceof Error ? error.message : String(error);
      stream.push({ type: "error", reason: message.stopReason, error: message });
    } finally { stream.end(); }
  })();
  return stream;
}

export default function testProvider(pi: ExtensionAPI): void {
  pi.registerProvider(testProviderName, {
    name: "TEST ONLY — questionnaire (zero network)", api: testApi,
    baseUrl: "in-process:questionnaire-test", apiKey: "test-only-not-a-credential",
    streamSimple: streamQuestionnaireTest,
    models: ["local", "local-large"].map(id => ({
      id, name: `TEST ONLY — questionnaire ${id}`, reasoning: false, input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 8192,
    })),
  });
}
