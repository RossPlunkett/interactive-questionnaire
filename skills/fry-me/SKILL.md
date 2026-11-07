---
name: fry-me
description: Interview a plan, decision, or idea using interactive questionnaire rounds. Use when the user asks to be fried or wants a card-based grilling interview.
---

# Fry me

Read the bundled **grilling** instructions with `read` at `references/grilling.md`, relative to this skill directory, before starting. If that file cannot be read, report the incomplete installation and pause. Reuse its design tree, frontier, fact-finding, and completion rules; replace only its prose question format with the round protocol below. Preserve the user's topic and constraints. With no topic, make identifying the topic the first round.

## Round protocol

1. Present the entire currently unblocked frontier in one `questionnaire` call. Supply a `title` and `questions`; each question has a unique `id`, a `prompt`, an explicit `multiple` boolean, labeled `options` with unique IDs, and nonempty `recommended` option IDs. Single-select requires exactly one recommended ID. Explain recommendations in the prompt when the reasoning matters. Keep dependent questions for later rounds. The card is the question presentation; avoid repeating the questions in prose.
2. Wait for the actual tool snapshot. Only `status: "submitted"` settles decisions. Use its `selected` IDs and `usedRecommendation` as recorded, including the tool's explicit recommendation fallback for empty selections. Treat `extra` as additive to the selected choices, not a replacement. Apply `roundNotes` as general context for the whole round, alongside those answers; notes are not permission to take actions. Resolve conflicts or ambiguity in the next frontier rather than silently discarding detail. Other / extra is available on every question without a special option.
3. Recompute the frontier from those answers and repeat. A cancelled round means pause/stop: every question from that round remains open and unanswered. Follow its `agentInstruction`; accept no selections, recommendations, defaults, or notes as answers. Tool errors and pending/history cards are not answers.
4. When the frontier is empty, summarize the shared understanding and obtain explicit user confirmation before taking action on the plan. For a mock interview, remain interview-only even after confirmation unless the user separately authorizes action.

If `questionnaire` is unavailable in an interactive parent, explain that the questionnaire extension must be installed/enabled and the session reloaded or restarted; pause rather than simulate cards or invent answers. No model or provider changes are needed.

## Terminal-less children

A child without an interactive terminal routes each frontier through `contact_supervisor` with `reason: "interview_request"` and the same questionnaire object in `interview`, then waits. The parent answers already-known facts itself; unknown human preferences go through the parent's `questionnaire` tool. Keep distinct requests separate, one at a time, never merge or replace an active round.

The parent uses `subagent_supervisor` to reply with the actual JSON snapshot encoded as the `message` string and `replyTo` set to the **original supervisor request ID**, not the questionnaire result ID. Consume the parsed `details.structuredReply` on the waiting child call, applying the same submitted/cancelled rules above. This is parent-mediated routing, not an automatic hook. If these public routing tools are unavailable, report the limitation and pause.
