---
name: interactive-questionnaire
description: Use when working on the interactive-questionnaire Pi package (this repo): the questionnaire card UI, the questionnaire tool, round state and snapshots, the session brief, the fry-me skill that ships with it, tests, and packaging.
---

# interactive-questionnaire (development)

This is the source repo for a personal Pi package. Its user-facing guide is `README.md`. This skill is for changing the code.

## Layout

- `extension/index.ts`: the `QuestionnaireCard` component, the `questionnaire` tool, commands (`/answers`, `/fry-me`, `/questionnaire-demo`), session restore, the agent brief (`before_agent_start`).
- `extension/state.ts`: `QuestionnaireSchema`, `validateQuestionnaire`, `QuestionnaireState` (toggle, extra, round notes, finish), `Snapshot`, `demoQuestionnaire`.
- `extension/test-provider.ts`, `extension/launch.sh`: synthetic provider for `npm run test-provider*`. Development only, never registered globally.
- `extension/tests/`: `state`, `card`, `extension`, `test-provider`, `fry-me`, `launch`, `package` tests.
- `skills/fry-me/`: the shipped skill and its grilling reference. Only `skills/` ships with the package (`files` in `package.json`). Do not put dev-only material there.
- `cli-skills/interactive-questionnaire/`: this file. Not shipped.

## Checks

```sh
npm ci --ignore-scripts   # first time only; no lifecycle scripts needed
npm test                  # node:test, all extension/tests/*.test.ts
npm run typecheck
```

Baseline at the time of writing: 73 tests, all passing; typecheck clean. Run both before reporting work done. Report failing output verbatim.

Visual or interaction changes need a real fullscreen Pi check (`npm run demo`, then `/questionnaire-demo`). The mock tests cover logic, not pixels.

## Rules that are easy to break

- **Card state is the source of truth.** A card is live only while its source `QuestionnaireState` is `pending`. Every interaction path (mouse, keyboard, `/answers`, `OK`) must check `live` first. Submitted or cancelled cards are read-only and must stay so after reload.
- **Submit line.** Live cards show `[ Submit round ]` as a control and `Cancel round` below a dashed line. Submitted cards show only the accent `[ Submit round ]`, with no action. Cancelled cards show neither. Tests in `card.test.ts` and `extension.test.ts` pin this.
- **Hover uses `move` events.** The TUI sends `move` only in fullscreen outside tmux/zellij/screen (all-motion mouse mode). `handleMouse` must handle `move` before its `button !== "left"` guard. Hover recolors the row under the pointer to `borderAccent` (second accent), only while live. Selected rows stay `accent`. Do not add redraws on every move: return a render only when the hovered index changes.
- **Colors come from the theme.** Use `theme.fg("accent" | "text" | "dim" | ...)`. Do not hardcode colors. Tests use a plain theme (`fg` returns text) or a tagging theme (`<accent>text</>`) when they check color.
- **Agent brief.** `before_agent_start` appends a tagged section to `event.systemPromptOptions.sections`. Do not return a whole `systemPrompt`: Pi's claude-bridge refuses replacement prompts. Keep the brief to one or two sentences; it runs every turn.
- **Tool schema.** `QuestionnaireSchema` is the model-facing contract. Changing it changes what agents send, so update the tool description and `validateQuestionnaire` together, and add tests.
- **Packaging.** `package.json` `name` is `interactive-questionnaire`, and the repo is `RossPlunkett/interactive-questionnaire`. Installs use `git:github.com/RossPlunkett/interactive-questionnaire`. Keep the `fry-me` skill and `/fry-me` command names. Changing the skill name breaks `/skill:fry-me` and the trigger.
- **Installed symlinks.** `~/.pi/agent/extensions/interactive-questionnaire` and `~/.agents/skills/fry-me` point into this checkout. Edits take effect after `/reload` or a Pi restart.

## Workflow

1. Read the relevant tests before changing behavior. Add or update tests with the change.
2. Run `npm test` and `npm run typecheck`.
3. Update `README.md` when user-visible behavior changes (hover, submit, brief, commands).
4. Leave changes uncommitted unless the user asks to commit.
