#!/usr/bin/env bash
# afk-ralph.sh — Autonomous Ralph loop using Codex as the coding agent.
#
# Usage:
#   ./afk-ralph.sh <iterations>
#
# Required env vars (set in .env or shell):
#   LINEAR_API_KEY        — Linear personal API key
#   LINEAR_PROJECT_NAME   — Exact project name in Linear (e.g. "My App")
#
# Optional env vars:
#   CODEX_CMD         — Codex CLI binary or path (default: codex)
#   CODEX_ARGS        — Extra flags for Codex (e.g. "--full-auto -m gpt-5.4")
#   CODEX_SUBCOMMAND  — Agent subcommand (default: exec)
#
# Each iteration:
#   1. Fetch one task from Linear (writes state/current-task.md)
#   2. Mark issue as In Progress
#   3. Run Codex on the task
#   4. Parse structured result from agent output
#   5. Update Linear with status and comment

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Load .env if present.
if [ -f "$ROOT_DIR/.env" ]; then
  set -a
  source "$ROOT_DIR/.env"
  set +a
fi

# Codex agent configuration.
CODEX_CMD="${CODEX_CMD:-codex}"
CODEX_ARGS="${CODEX_ARGS:-}"
CODEX_SUBCOMMAND="${CODEX_SUBCOMMAND:-exec}"

# Parse positional argument: number of loop iterations.
ITERATIONS=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    *)
      if [ -z "$ITERATIONS" ]; then
        ITERATIONS="$1"
      else
        echo "Unknown argument: $1"
        exit 1
      fi
      shift
      ;;
  esac
done

if [ -z "$ITERATIONS" ]; then
  echo "Usage: $0 <iterations>"
  echo ""
  echo "Environment variables:"
  echo "  LINEAR_API_KEY        required"
  echo "  LINEAR_PROJECT_NAME   required"
  echo "  CODEX_CMD             Codex binary (default: codex)"
  echo "  CODEX_ARGS            Extra Codex flags (e.g. --full-auto -m gpt-5.4)"
  echo "  CODEX_SUBCOMMAND      Agent subcommand (default: exec)"
  exit 1
fi

LOG_DIR="$ROOT_DIR/logs"
STATE_DIR="$ROOT_DIR/state"
SCRIPTS_DIR="$ROOT_DIR/scripts"
LOCK_FILE="$STATE_DIR/ralph.lock"
AGENT_STATUS_FILE="$STATE_DIR/agent-status.json"

mkdir -p "$LOG_DIR" "$STATE_DIR"

# Prevent concurrent runs via a PID lock file.
if [ -f "$LOCK_FILE" ]; then
  echo "Ralph loop already running: $LOCK_FILE exists"
  exit 1
fi

cleanup() {
  rm -f "$LOCK_FILE" "$AGENT_STATUS_FILE"
}
trap cleanup EXIT

echo "$$" > "$LOCK_FILE"

require_file() {
  local file="$1"
  if [ ! -f "$file" ]; then
    echo "Missing required file: $file"
    exit 1
  fi
}

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing required command: $cmd"
    exit 1
  fi
}

require_file "$ROOT_DIR/AGENT.md"
require_file "$ROOT_DIR/PROMPT.md"
require_file "$SCRIPTS_DIR/fetch-linear-task.ts"
require_file "$SCRIPTS_DIR/update-linear-issue.ts"

require_cmd "$CODEX_CMD"
require_cmd bun

if [ -z "${LINEAR_API_KEY:-}" ]; then
  echo "Missing LINEAR_API_KEY"
  exit 1
fi

if [ -z "${LINEAR_PROJECT_NAME:-}" ]; then
  echo "Missing LINEAR_PROJECT_NAME"
  echo "Example: export LINEAR_PROJECT_NAME='My Project'"
  exit 1
fi

IS_GIT_REPO=0
if git -C "$ROOT_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  IS_GIT_REPO=1
fi

# run_agent <prompt> <log_file>
# Runs Codex with the given task prompt in non-interactive mode.
run_agent() {
  local prompt="$1"
  local log_file="$2"
  local -a codex_cmd=("$CODEX_CMD" "$CODEX_SUBCOMMAND")
  if [[ "$CODEX_ARGS" == *"--full-auto"* ]]; then
    : # --full-auto already implies full sandbox bypass
  else
    codex_cmd+=(--dangerously-bypass-approvals-and-sandbox)
  fi
  codex_cmd+=(--color never -C "$ROOT_DIR")
  local -a extra_args=()
  if [ "$IS_GIT_REPO" -eq 0 ]; then
    codex_cmd+=(--skip-git-repo-check)
  fi
  if [ -n "$CODEX_ARGS" ]; then
    # shellcheck disable=SC2206
    extra_args=($CODEX_ARGS)
  fi
  result="$("${codex_cmd[@]}" "${extra_args[@]}" "$prompt" 2>&1 | tee -a "$log_file")" || true
}

# parse_codex_args — extract model and reasoning-effort from CODEX_ARGS.
parse_codex_args() {
  agent_model=""
  agent_effort=""
  [ -z "$CODEX_ARGS" ] && return
  local -a args
  read -ra args <<< "$CODEX_ARGS"
  local i=0
  while [ $i -lt ${#args[@]} ]; do
    case "${args[$i]}" in
      -m|--model)
        i=$((i+1)); [ $i -lt ${#args[@]} ] && agent_model="${args[$i]}" ;;
      --reasoning-effort)
        i=$((i+1)); [ $i -lt ${#args[@]} ] && agent_effort="${args[$i]}" ;;
    esac
    i=$((i+1))
  done
}

# write_agent_status <running> <issue_id> <issue_title> <started_at>
write_agent_status() {
  local running="$1" issue_id="${2:-}" issue_title="${3:-}" started_at="${4:-}"
  RALPH_RUNNING="$running" \
  RALPH_AGENT_TYPE="$(basename "$CODEX_CMD")" \
  RALPH_MODEL="${agent_model:-}" \
  RALPH_EFFORT="${agent_effort:-}" \
  RALPH_PID="$$" \
  RALPH_ISSUE_ID="$issue_id" \
  RALPH_ISSUE_TITLE="$issue_title" \
  RALPH_STARTED_AT="$started_at" \
  RALPH_COMMAND="$CODEX_CMD $CODEX_SUBCOMMAND${CODEX_ARGS:+ $CODEX_ARGS}" \
  bun -e "
process.stdout.write(JSON.stringify({
  running: process.env.RALPH_RUNNING === 'true',
  agentType: process.env.RALPH_AGENT_TYPE || '',
  model: process.env.RALPH_MODEL || '',
  reasoningEffort: process.env.RALPH_EFFORT || '',
  pid: parseInt(process.env.RALPH_PID || '0'),
  issueId: process.env.RALPH_ISSUE_ID || '',
  issueTitle: process.env.RALPH_ISSUE_TITLE || '',
  startedAt: process.env.RALPH_STARTED_AT || '',
  command: process.env.RALPH_COMMAND || '',
}, null, 2) + '\n');
" > "$AGENT_STATUS_FILE"
}

# extract_linear_comment <text>
extract_linear_comment() {
  printf "%s\n" "$1" | awk '
    BEGIN {capture=0}
    /^LINEAR_COMMENT:/ {capture=1; sub(/^LINEAR_COMMENT:[[:space:]]*/, ""); if (length) print; next}
    capture==1 {print}
  '
}

# extract_acceptance_criteria <text>
extract_acceptance_criteria() {
  printf "%s\n" "$1" | awk '
    BEGIN {capture=0}
    /^ACCEPTANCE_CRITERIA:/ {capture=1; next}
    capture==1 && /^[A-Z_][A-Z_]*:/ {capture=0}
    capture==1 {print}
  '
}

# extract_tests_run <text>
extract_tests_run() {
  printf "%s\n" "$1" | awk '
    BEGIN {capture=0}
    /^TESTS_RUN:/ {capture=1; next}
    capture==1 && /^[A-Z_][A-Z_]*:/ {capture=0}
    capture==1 {print}
  '
}

# extract_commit_message <text>
extract_commit_message() {
  printf "%s\n" "$1" | awk '
    /^COMMIT_MESSAGE:/ {sub(/^COMMIT_MESSAGE:[[:space:]]*/, ""); print; exit}
  '
}

# extract_files_changed <text>
extract_files_changed() {
  printf "%s\n" "$1" | awk '
    BEGIN {capture=0}
    /^FILES_CHANGED:/ {capture=1; next}
    capture==1 && /^[A-Z_][A-Z_]*:/ {capture=0}
    capture==1 {print}
  '
}

# commit_and_push <issue_id> <issue_title> <log_file>
commit_and_push() {
  local issue_id="$1" issue_title="$2" log_file="$3"
  local commit_msg

  commit_msg="$(extract_commit_message "$result")"
  if [ -z "$commit_msg" ] || [ "$commit_msg" = "N/A" ]; then
    local scope
    scope="$(echo "$issue_title" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g' | cut -c1-30)"
    commit_msg="feat($scope): $issue_title ($issue_id)"
  fi

  local files_changed
  files_changed="$(extract_files_changed "$result")"

  if [ -n "$files_changed" ]; then
    echo "$files_changed" | sed 's/^- //' | while IFS= read -r f; do
      [ -n "$f" ] && git -C "$ROOT_DIR" add "$f" 2>/dev/null || true
    done
  fi

  git -C "$ROOT_DIR" add -u 2>/dev/null || true

  if git -C "$ROOT_DIR" diff --cached --quiet 2>/dev/null; then
    echo "No staged changes to commit." | tee -a "$log_file"
    return 0
  fi

  git -C "$ROOT_DIR" commit -m "$commit_msg" 2>&1 | tee -a "$log_file"
  git -C "$ROOT_DIR" push origin main 2>&1 | tee -a "$log_file"
}

# prompt_human_validation <issue_id> <issue_title> <log_file>
prompt_human_validation() {
  local issue_id="$1" issue_title="$2" log_file="$3"

  echo ""
  echo "╔══════════════════════════════════════════════════════════════╗"
  echo "║  HUMAN VALIDATION NEEDED                                    ║"
  echo "╚══════════════════════════════════════════════════════════════╝"
  echo ""
  echo "Issue: $issue_id — $issue_title"
  echo ""

  local files_changed
  files_changed="$(extract_files_changed "$result")"
  if [ -n "$files_changed" ]; then
    echo "Files changed:"
    echo "$files_changed"
    echo ""
  fi

  local tests_run
  tests_run="$(extract_tests_run "$result")"
  if [ -n "$tests_run" ]; then
    echo "Agent suggested these test commands:"
    echo "$tests_run"
    echo ""
  else
    echo "Agent did not specify test commands. Check the log:"
    echo "  $log_file"
    echo ""
  fi

  echo "The agent wrote code but could not run validation (sandbox/network limitation)."
  echo ""
  echo "Options:"
  echo "  [t] Open a shell to test manually, then decide"
  echo "  [d] Mark as DONE (you verified it works)"
  echo "  [b] Mark as BLOCKED (keep in backlog)"
  echo "  [s] Skip (leave in progress, handle later)"
  echo ""

  while true; do
    read -rp "Choice [t/d/b/s]: " choice
    case "$choice" in
      t|T)
        echo ""
        echo "Dropping into a subshell. Run your tests, then type 'exit'."
        echo "Working directory: $ROOT_DIR"
        echo ""
        (cd "$ROOT_DIR" && "${SHELL:-bash}")
        echo ""
        read -rp "Tests done. Mark as [d]one or [b]locked? " post_choice
        case "$post_choice" in
          d|D) return 0 ;;
          *)   return 1 ;;
        esac
        ;;
      d|D) return 0 ;;
      b|B) return 1 ;;
      s|S) return 2 ;;
      *)   echo "Invalid choice. Enter t, d, b, or s." ;;
    esac
  done
}

parse_codex_args

# Main loop — run one task per iteration.
for ((i=1; i<=ITERATIONS; i++)); do
  echo
  echo "===================================================="
  echo "Ralph iteration $i / $ITERATIONS | agent: $CODEX_CMD $CODEX_ARGS"
  echo "===================================================="

  timestamp="$(date +"%Y-%m-%dT%H-%M-%S")"
  run_log="$LOG_DIR/ralph-$timestamp.log"

  echo "[1/5] Fetching next task from Linear..."

  fetch_output="$(bun "$SCRIPTS_DIR/fetch-linear-task.ts")"
  echo "$fetch_output" | tee -a "$run_log"

  if [[ "$fetch_output" == *"NO_TASK_FOUND"* ]]; then
    echo "No eligible task found. Exiting."
    exit 0
  fi

  require_file "$STATE_DIR/current-task.md"

  issue_id="$(grep -E '^Issue:' "$STATE_DIR/current-task.md" | head -n1 | sed 's/^Issue:[[:space:]]*//')"
  issue_title="$(grep -E '^Title:' "$STATE_DIR/current-task.md" | head -n1 | sed 's/^Title:[[:space:]]*//')"

  if [ -z "$issue_id" ]; then
    echo "Could not parse Issue from state/current-task.md"
    exit 1
  fi

  echo "[2/5] Marking issue as In Progress in Linear..."
  bun "$SCRIPTS_DIR/update-linear-issue.ts" start "$issue_id" \
    | tee -a "$run_log"

  echo "[3/5] Running Codex agent for $issue_id ($issue_title)..."
  if [ "$IS_GIT_REPO" -eq 0 ]; then
    echo "Workspace is not a Git repository; running Codex with --skip-git-repo-check." | tee -a "$run_log"
  fi

  agent_prompt="Read AGENT.md, PROMPT.md, and state/current-task.md before doing anything. \
Implement exactly the issue described in state/current-task.md. \
Do not work on any other issue. \
Follow AGENT.md and PROMPT.md strictly. \
At the end, output the structured result block exactly as specified in PROMPT.md, \
starting with STATUS: on its own line. \
The structured block must be the last thing you print."

  started_at="$(date -Iseconds)"
  write_agent_status true "$issue_id" "$issue_title" "$started_at"

  result=""
  run_agent "$agent_prompt" "$run_log"

  echo "[4/5] Parsing agent result..."

  agent_status="$(grep -i "^STATUS:" "$run_log" | tail -1 || true)"

  if echo "$agent_status" | grep -qi "DONE"; then
    echo "Task completed."
    if [ "$IS_GIT_REPO" -eq 1 ]; then
      echo "Committing and pushing agent changes..."
      commit_and_push "$issue_id" "$issue_title" "$run_log"
    fi
    linear_comment="$(extract_linear_comment "$result")"
    [ -z "$linear_comment" ] && linear_comment="Agent completed the task and validation passed."
    echo "[5/5] Updating Linear as In Review..."
    RALPH_ACCEPTANCE_CRITERIA="$(extract_acceptance_criteria "$result")" \
      bun "$SCRIPTS_DIR/update-linear-issue.ts" done "$issue_id" "$linear_comment" \
      | tee -a "$run_log"

  elif echo "$agent_status" | grep -qi "BLOCKED"; then
    echo "Task is blocked."
    linear_comment="$(extract_linear_comment "$result")"
    [ -z "$linear_comment" ] && linear_comment="Agent marked the issue as blocked."

    if [ -t 0 ]; then
      human_result=0
      prompt_human_validation "$issue_id" "$issue_title" "$run_log" || human_result=$?

      if [ "$human_result" -eq 0 ]; then
        if [ "$IS_GIT_REPO" -eq 1 ]; then
          echo "Committing and pushing agent changes..."
          commit_and_push "$issue_id" "$issue_title" "$run_log"
        fi
        echo "[5/5] Human validated. Updating Linear as Done..."
        RALPH_ACCEPTANCE_CRITERIA="$(extract_acceptance_criteria "$result")" \
          bun "$SCRIPTS_DIR/update-linear-issue.ts" done "$issue_id" \
            "Agent wrote code, human validated and confirmed. Original agent note: $linear_comment" \
          | tee -a "$run_log"
      elif [ "$human_result" -eq 2 ]; then
        echo "Skipped — task left in current state."
      else
        bun "$SCRIPTS_DIR/update-linear-issue.ts" blocked "$issue_id" "$linear_comment" \
          | tee -a "$run_log"
      fi
    else
      bun "$SCRIPTS_DIR/update-linear-issue.ts" blocked "$issue_id" "$linear_comment" \
        | tee -a "$run_log"
    fi

  elif echo "$agent_status" | grep -qi "NEEDS_SPLIT"; then
    echo "Task needs split."
    linear_comment="$(extract_linear_comment "$result")"
    [ -z "$linear_comment" ] && linear_comment="Agent marked the issue as too large and needing split."
    bun "$SCRIPTS_DIR/update-linear-issue.ts" needs_split "$issue_id" "$linear_comment" \
      | tee -a "$run_log"

  elif echo "$agent_status" | grep -qi "FAILED"; then
    echo "Task failed."
    linear_comment="$(extract_linear_comment "$result")"
    [ -z "$linear_comment" ] && linear_comment="Agent failed while implementing the issue."
    bun "$SCRIPTS_DIR/update-linear-issue.ts" failed "$issue_id" "$linear_comment" \
      | tee -a "$run_log"

  else
    echo "Unknown agent result format. Raw output saved to: $run_log"
    if [ -t 0 ]; then
      human_result=0
      prompt_human_validation "$issue_id" "$issue_title" "$run_log" || human_result=$?

      if [ "$human_result" -eq 0 ]; then
        if [ "$IS_GIT_REPO" -eq 1 ]; then
          echo "Committing and pushing agent changes..."
          commit_and_push "$issue_id" "$issue_title" "$run_log"
        fi
        echo "[5/5] Human validated. Updating Linear as Done..."
        RALPH_ACCEPTANCE_CRITERIA="$(extract_acceptance_criteria "$result")" \
          bun "$SCRIPTS_DIR/update-linear-issue.ts" done "$issue_id" \
            "Agent output was unparseable but human validated the work." \
          | tee -a "$run_log"
      elif [ "$human_result" -eq 2 ]; then
        echo "Skipped — task left in current state."
      else
        bun "$SCRIPTS_DIR/update-linear-issue.ts" blocked "$issue_id" \
          "Agent produced unrecognized output (no STATUS line found). Raw log: $run_log" \
          | tee -a "$run_log"
      fi
    else
      bun "$SCRIPTS_DIR/update-linear-issue.ts" blocked "$issue_id" \
        "Agent produced unrecognized output (no STATUS line found). Raw log: $run_log" \
        | tee -a "$run_log"
    fi
  fi

  write_agent_status false "$issue_id" "$issue_title" "$started_at"
done

echo
echo "Ralph loop finished after $ITERATIONS iterations."
