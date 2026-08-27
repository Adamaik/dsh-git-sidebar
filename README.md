# dsh-git-sidebar

A draggable right-side Git sidebar for DeepSeek Harness Web. It follows the active workspace, lists changed files, generates commit messages with the model you are already using, and runs commit / push / pull.

## Features

- **Follows the active workspace** — the panel switches to the workspace of the conversation you select, resolving the git root automatically (walking up from the workspace path, or one level down for nested checkouts).
- **Draggable right-edge entry** — a vertical tab on the right edge of the window; drag it anywhere along the edge, click to toggle the panel.
- **Change list** — staged / unstaged groups with status badges (M/A/D/R/?), click a file to stage or unstage, stage-all toggle.
- **Branch switching** — a branch dropdown listing local and remote branches; checkout with a dirty-workspace warning before switching.
- **AI commit message** — ✨ generates a Conventional Commits style message (Chinese subject) from `git status` + `git diff HEAD` using the current session's default model via the harness `llm` service, then fills the message box for editing.
- **Actions** — commit (optionally with all changes), push, pull, refresh.

## Install

```sh
dsh plugin --profile web add dsh-git-sidebar
```

Or install from this repository:

```sh
dsh plugin --profile web add "github:adamaik/dsh-git-sidebar#main"
```

## Usage

The Git tab appears on the right edge of the window. Click it to open the panel; drag it to reposition. Select a conversation in the left sidebar to point the panel at that workspace.

## How it works

- Host half (`lib/index.js`) registers JSON routes on the `webServer` service and runs git commands through the `shell` service; the AI commit message endpoint calls `llm.stream` with the current default model selection.
- Browser half (`lib/client.js`) is a `dsh.client` module registered into `shell.overlay`; it fetches the host routes and renders the React UI.

## Development

```sh
node --check lib/index.js
node --check lib/client.js
```

## License

MIT