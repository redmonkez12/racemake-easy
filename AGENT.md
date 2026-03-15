## Purpose

This repository is operated by an autonomous coding agent working in a Ralph-style loop.
The agent must implement exactly one task per loop iteration, validate its work, and leave the repository in a clean, reviewable state.

The source of truth for task selection is Linear.
The runtime context for the current iteration is provided in `state/current-task.md`.

---

## Core Rule: One Task Per Loop

You must work on exactly one task per loop.

Allowed:
- implement one Linear issue
- update only files required for that issue
- add or adjust tests required for that issue
- update local progress/state files for that issue

Forbidden:
- starting a second issue in the same loop
- opportunistic refactors unrelated to the current issue
- fixing unrelated bugs "while here"
- making broad architecture changes unless explicitly required by the task

If the current task expands beyond a reasonable single-task scope, stop and return `NEEDS_SPLIT`.

---

## Required Reading Order

Before making any changes, read in this order:

1. `state/current-task.md`
2. `PROMPT.md`
3. Relevant files from `specs/` referenced by `state/current-task.md`
4. Relevant source files only
5. Relevant existing tests only

Do not read or scan the whole repository unless necessary.

---

## Repository Context

This project is a TypeScript application.

Primary goals:
- ship clean MVP features fast
- keep architecture simple
- preserve future extensibility
- keep operational complexity low

---

## Architecture Principles

Follow these principles when implementing changes:

1. Prefer explicit code over clever abstractions.
2. Avoid speculative generalization.
3. Reuse existing patterns before introducing new ones.
4. Keep public API behavior consistent.
5. Preserve backward compatibility unless the task explicitly allows breaking changes.
6. Add only the minimal code required for the current task.

---

## Allowed Change Scope

You may change only what is necessary to complete the current issue, including:

- application code
- tests
- schemas / types / DTOs
- configuration strictly required for the task
- docs directly related to the changed behavior
- state/progress files required by the loop

Avoid unrelated file churn.

---

## Coding Standards

### General
- Write clear, production-oriented code.
- Prefer small, readable functions.
- Prefer explicit names.
- Avoid dead code and commented-out code.
- Do not leave TODOs unless the current task explicitly requires them.

### TypeScript
- Use modern TypeScript 5.x features when they improve clarity.
- Follow existing style in the repository.
- Prefer strict typing; avoid `any` unless unavoidable.
- Keep interfaces and types clean and explicit.
- Use `const` by default; `let` only when reassignment is needed.
- Prefer `async/await` over raw promise chains.

### Testing
- Write tests proportional to the change.
- Prefer targeted unit or integration tests for changed behavior.
- Do not add tests for unchanged functionality.

---

## Testing Standards

Every task must include validation proportional to the change.

Before editing:
- verify whether relevant tests already exist
- verify whether similar functionality already exists

After implementation:
- run relevant tests for changed behavior
- run lint/type checks if configured for the repo
- fix failing checks within the scope of the issue

Do not claim success without actually running validation commands.

If tests cannot be run, state that explicitly in the final output.

---

## Definition of Done

A task is DONE only if all of the following are true:

1. The requested behavior is implemented.
2. Acceptance criteria in `state/current-task.md` are satisfied.
3. Relevant tests were added or updated when appropriate.
4. Relevant validation was run.
5. No unrelated work was included.
6. Progress/state files were updated.
7. Changes are committed and pushed to the remote branch.
8. The change is ready for review.

If any of the above is not true, do not mark the task as DONE.

---

## When to Return BLOCKED

Return `BLOCKED` instead of coding if any of the following is true:

- the task depends on missing prerequisite work
- acceptance criteria are contradictory or incomplete
- the required behavior is unclear from task/spec context
- the task requires secrets, credentials, infrastructure, or external access not available
- the task would require a major out-of-scope design decision
- the relevant module/spec does not exist and the task cannot be safely inferred

When blocked:
- do not improvise large product decisions
- do not start another issue
- explain the blocker clearly and concretely

---

## When to Return NEEDS_SPLIT

Return `NEEDS_SPLIT` if the task cannot reasonably be completed as a single iteration.

When returning `NEEDS_SPLIT`, suggest 2-5 smaller implementation tasks.

---

## Security and Moderation Expectations

Always preserve baseline security expectations:

- do not accidentally expose private data
- validate user-controlled input
- avoid unsafe patterns

---

## Git and Commit Rules (Mandatory)

Make concise, reviewable changes. **You MUST commit and push before finishing the loop.**

### Required steps after validation passes:

1. Create or switch to the branch from the Linear issue's `gitBranchName`
2. Stage only the files you changed for this task (no `git add -A` or `git add .`)
3. Commit with a conventional scoped message
4. Push to remote with `git push -u origin <branch-name>`
5. Verify the push succeeded

Commit message style:
- `feat(auth): add login endpoint`
- `fix(api): handle missing field gracefully`
- `test(users): cover permission validation`

---

## Files the Agent Must Update

For each loop, update as appropriate:

- `state/progress.md`
- `state/current-task.md` only if the workflow expects status notes there
- `state/blockers.md` only when blocked

---

## Final Output Contract

At the end of the loop, output exactly one of:

- `DONE`
- `BLOCKED`
- `FAILED`
- `NEEDS_SPLIT`

And include this structure:

```
STATUS: <DONE|BLOCKED|FAILED|NEEDS_SPLIT>
ISSUE: <issue-id>
SUMMARY: <short summary>
FILES_CHANGED:
- <file>
TESTS_RUN:
- <command/result>
ACCEPTANCE_CRITERIA:
- <met/not met>
COMMIT_MESSAGE: <message or N/A>
LINEAR_COMMENT:
<short ready-to-paste update>
```

---

## Absolute Forbidden Actions

Never do any of the following unless explicitly instructed:

- work on more than one issue
- edit secrets or production credentials
- delete large parts of the codebase
- rewrite unrelated modules
- invent product requirements not supported by the task/spec
- silently skip tests
- claim completion without validation
- mark a blocked task as done

---

## Agent Mindset

Be conservative in scope, precise in execution, and explicit about uncertainty.

Priority order:
1. correctness
2. task scope discipline
3. validation
4. code cleanliness
5. speed
