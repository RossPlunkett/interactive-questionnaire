# fry-me

Private Pi package: a grilling interview skill with clickable questions in your conversation.

```text
extension/       Pi extension and its tests
skills/fry-me/   Interview skill, including the underlying grilling instructions
```

The package is self-contained: no separate `grill-me` or `grilling` installation is needed. This is a tested personal prototype, not a production service.

## Install on another machine

Requires Pi 1.4+ and Node 22.19+. The original extension was exercised on Pi 1.4 and 1.5 with the OMP-style Pi presentation plugin; development checks here use Pi 1.5.

Because this repository is private, Git must have permission to read it. For HTTPS with GitHub CLI:

```sh
gh auth login
gh auth setup-git
pi install git:github.com/RossPlunkett/fry-me
```

An existing Git credential helper or GitHub SSH setup works too; use the matching Git URL with Pi. Pi supplies the runtime peer packages; no machine-local dependency symlinks or compiler paths are needed.

Reload an existing **normal Pi session** with `/reload`, or restart Pi. Then enter:

```text
/fry-me Help me plan a weekend trip. Mock interview only—take no actions.
```

`/skill:fry-me` is the canonical skill command; `/fry-me` is a convenient alias. Both accept your topic. The skill is also discoverable by agents. It uses your current model, without changing provider or defaults. A real interview uses model inference before and after questions; waiting on an open questionnaire does not itself generate tokens. Background extensions or separate agents can still have their own activity.

### Already using a local checkout or the original prototype?

Avoid loading two copies of the extension or skill. If you have local `questionnaire`/`fry-me` directory symlinks, inspect their targets first. Remove **only those verified local-install links**, then install this managed Git package and reload. Keep unrelated files and configurations. Installing on a new machine needs none of that cleanup.

## Answering questions

- Click choices in **fullscreen** Pi. Some questions allow several selections.
- Selected lines use your theme's accent color and return to neutral when deselected. No hardcoded cyan: your theme decides the color.
- **Other / extra** adds detail alongside choices. It turns accent-colored as you type, with a wrapped live preview. The native typing field remains single-line; Enter saves and Escape discards edits.
- **Round thoughts** is a separate optional section after the questions. Its notes apply to the whole round and travel with the answers as `roundNotes`. It uses the same accent-colored, wrapped live preview and save/discard behavior as Other / extra.
- **Submit round** sends all answers and round thoughts together. Typing exactly `OK` in the main prompt also submits, saving an open transcript draft first. A non-clickable dashed line separates Submit from Cancel.
- **Cancel round** accepts no answers or notes. The returned `agentInstruction` explicitly tells the agent that every question in the round remains open and unanswered; selections, recommendations and defaults are not agreement.
- Recommendations are visibly selected. Clearing all choices uses that question's explicit recommendation on submission; cancellation never counts as agreement.
- `/answers` opens a keyboard sheet: arrows or Tab move, Space/Enter activates, Escape returns to the prompt without cancelling the round.
- Submitted cards are read-only. Saved answers follow the current session branch. Unfinished rounds are inactive after restart; they do not resume.
- `/questionnaire-demo` opens fixed sample questions without making model requests.

The extension exposes the agent-callable `questionnaire` tool. Its schema supports titles, question/option IDs, single/multiple selection, and explicit recommended option IDs. Additive detail is always available, regardless of the legacy `allowExtra` field.

Regular Pi mode leaves mouse interaction to the terminal; use `/answers` or `OK`. RPC/print/JSON cannot answer these native cards. The OMP-style plugin's editor/footer remain untouched: cards use public custom session entries rather than tool-renderer patches.

## Subagent interviews

Routing is **parent-mediated**, not automatic. A terminal-less child sends the questionnaire object through `contact_supervisor` with `reason: "interview_request"` and `interview: {...}`. The parent answers known facts itself or calls `questionnaire` for human decisions, then replies through `subagent_supervisor` with `replyTo` equal to the original supervisor request ID and `message: JSON.stringify(actualSnapshot)`. The child receives `details.structuredReply`.

Keep distinct interviews separate, oldest first. Normal questionnaire tool calls execute sequentially; cross-entry overlap is rejected, not merged or replaced. There is no general FIFO or automatic supervisor interception. Preserve cancellation as cancellation.

## Update / uninstall

```sh
pi update git:github.com/RossPlunkett/fry-me
pi remove git:github.com/RossPlunkett/fry-me
```

Reload or restart Pi afterwards. Installing a tag/commit pins that revision; an unpinned source follows the repository branch on update. This private repository is not published to npm.

## Development

```sh
git clone https://github.com/RossPlunkett/fry-me.git
cd fry-me
npm ci --ignore-scripts
npm test
npm run typecheck
```

All development dependencies and the compiler are local, pinned through `package-lock.json`. No install lifecycle scripts are required. Runtime packages supplied by Pi are peers, not bundled copies.

```sh
npm run demo                   # then /questionnaire-demo; retains normal extensions
npm run test-provider          # isolated fake provider + actual waiting tool
npm run test-provider:large    # 18 questions for scrolling/resize checks
```

The test provider is synthetic, in-process, and loaded only explicitly by those development commands. It makes no HTTP/model requests and is absent from the Pi resource manifest and runtime package files. Ordinary prompts in a real-model demo session do use the selected model. Do not globally register the test provider.

Tests cover state/defaults, live colors, additive drafts/wrapping, round thoughts, keyboard/mouse/focus behavior, cancellation/history, alias/skill loading, and fake-provider round trips. Mock tests complement rather than replace native terminal testing.

### Showing screenshot receipts

Pi can show an image-capable `read` tool's PNG results inline in supported terminals (Kitty here); this predates Pi 1.5. To request more visual proof, tell agents: “After meaningful UI changes, capture one or two relevant screenshots and show them with the image-capable read tool, not just file paths.” Terminal image detection must be enabled/supported (`terminal.images` normally stays `"auto"`). This is native Pi functionality, not a feature added by this extension. Reading images also sends them to the model, so keep receipts selective.
