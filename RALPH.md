# Ralph Loop

The Ralph loop fetches one Linear task per iteration, runs the selected agent on it,
and updates Linear with the result.

## Prerequisites

- [Bun](https://bun.sh) installed (`curl -fsSL https://bun.sh/install | bash`)
- `.env` file configured (copy `.env.example`)
- One of:
  - `codex` CLI installed and on `$PATH` (or set `CODEX_CMD`)
  - `claude` CLI installed and on `$PATH` (or set `CLAUDE_CMD`)

## Setup

```bash
bun install
cp .env.example .env
# Edit .env: set LINEAR_API_KEY, LINEAR_PROJECT_NAME, and the agent-specific vars you want
chmod +x afk-ralph.sh afk-ralph-claude.sh
```

## Run With Claude

```bash
# Run 1 iteration with Claude defaults
./afk-ralph-claude.sh 1

# Override model and effort for this run
./afk-ralph-claude.sh 5 --model sonnet --effort high

# Or configure via environment variables
CLAUDE_MODEL=sonnet CLAUDE_EFFORT=high ./afk-ralph-claude.sh 1
```

The Claude flow reads `CLAUDE.md` before each run and uses `.claude/skills/`
for task-specific guidance when those skill files are present.

## Run With Codex

```bash
# Run 5 iterations (one Linear task per iteration)
./afk-ralph.sh 5

# Use a custom Codex binary path
CODEX_CMD=/usr/local/bin/codex ./afk-ralph.sh 3

# Pass extra flags (e.g. fully autonomous mode)
CODEX_ARGS="--full-auto -m gpt-5.4" ./afk-ralph.sh 1
```

## Log files

Each iteration writes a timestamped log to `logs/ralph-<timestamp>.log`.

## State files

- `state/current-task.md` — the issue picked for the current iteration
- `state/progress.md`     — append-only agent progress log
- `state/blockers.md`     — append-only blocker log
- `state/ralph.lock`      — PID lock preventing concurrent runs
- `state/agent-status.json` — current agent runtime metadata for the active iteration

## TypeScript scripts

The Linear integration scripts live in `scripts/` and are run via `npx tsx`:

| Script | Purpose |
|---|---|
| `scripts/common-linear.ts` | Shared Linear API utilities |
| `scripts/fetch-linear-task.ts` | Fetch one task from Linear, write `state/current-task.md` |
| `scripts/update-linear-issue.ts` | Update issue state and add comments |

Run scripts directly for testing:
```bash
# Test task fetching
bun scripts/fetch-linear-task.ts

# Test issue update
bun scripts/update-linear-issue.ts comment PROJ-1 "test comment"
```
