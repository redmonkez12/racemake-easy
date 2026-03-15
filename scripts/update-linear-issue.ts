#!/usr/bin/env tsx
/**
 * Update a Linear issue's state and/or add a comment.
 *
 * Usage:
 *   npx tsx scripts/update-linear-issue.ts start       <issue-identifier>
 *   npx tsx scripts/update-linear-issue.ts done        <issue-identifier> [comment]
 *   npx tsx scripts/update-linear-issue.ts blocked     <issue-identifier> [comment]
 *   npx tsx scripts/update-linear-issue.ts failed      <issue-identifier> [comment]
 *   npx tsx scripts/update-linear-issue.ts needs_split <issue-identifier> [comment]
 *   npx tsx scripts/update-linear-issue.ts comment     <issue-identifier> <comment>
 *
 * State transitions:
 *   start       -> moves to "In Progress"
 *   done        -> moves to "In Review" (or "Done" if no review state exists)
 *   blocked     -> adds comment with blocker details, keeps current state
 *   failed      -> adds comment with failure details, keeps current state
 *   needs_split -> adds comment with split suggestion, keeps current state
 *   comment     -> adds a comment without changing state
 */

import { graphql } from "./common-linear.js";

const STATE_TARGETS: Record<string, string[]> = {
  start: ["In Progress"],
  done: ["In Review", "Done", "Closed"],
  blocked: ["Todo", "Backlog"],
  failed: ["Todo", "Backlog"],
};

async function findIssueByIdentifier(identifier: string): Promise<any | null> {
  const data = await graphql(
    `
    query($id: String!) {
      issue(id: $id) {
        id
        identifier
        title
        description
        team { id }
        state { id name type }
      }
    }
    `,
    { id: identifier }
  );
  return (data.issue as any) ?? null;
}

async function getTeamStates(
  teamId: string
): Promise<Array<{ id: string; name: string; type: string }>> {
  const data = await graphql(
    `
    query($teamId: ID!) {
      workflowStates(filter: { team: { id: { eq: $teamId } } }) {
        nodes { id name type }
      }
    }
    `,
    { teamId }
  );
  return ((data.workflowStates as any)?.nodes ?? []);
}

async function transitionIssue(
  issueId: string,
  stateId: string
): Promise<void> {
  await graphql(
    `
    mutation($id: String!, $stateId: String!) {
      issueUpdate(id: $id, input: { stateId: $stateId }) {
        success
      }
    }
    `,
    { id: issueId, stateId }
  );
}

async function addComment(issueId: string, body: string): Promise<void> {
  await graphql(
    `
    mutation($issueId: String!, $body: String!) {
      commentCreate(input: { issueId: $issueId, body: $body }) {
        success
      }
    }
    `,
    { issueId, body }
  );
}

async function resolveTargetState(
  teamId: string,
  action: string
): Promise<{ id: string; name: string } | null> {
  const candidates = STATE_TARGETS[action];
  if (!candidates) return null;

  const states = await getTeamStates(teamId);
  for (const candidate of candidates) {
    const match = states.find(
      (s) => s.name.toLowerCase() === candidate.toLowerCase()
    );
    if (match) return match;
  }
  return null;
}

function normalize(text: string): string {
  return text
    .replace(/[`*_]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function parseMetCriteria(acBlock: string): string[] {
  const met: string[] = [];
  for (const line of acBlock.split("\n")) {
    const m = line.trim().match(/^-\s+(.+?)\s+->\s+met\s*$/i);
    if (m) met.push(normalize(m[1]));
  }
  return met;
}

async function updateDescriptionCheckboxes(
  issueId: string,
  description: string | null | undefined,
  acBlock: string
): Promise<void> {
  if (!description || !description.includes("- [ ]")) return;

  const metCriteria = parseMetCriteria(acBlock);
  const lines = description.split("\n");
  const updatedLines: string[] = [];
  let changed = false;

  for (const line of lines) {
    if (line.includes("- [ ]")) {
      const shouldCheck =
        metCriteria.length === 0 ||
        metCriteria.some((c) => normalize(line).includes(c));
      if (shouldCheck) {
        updatedLines.push(line.replace("- [ ]", "- [x]"));
        changed = true;
        continue;
      }
    }
    updatedLines.push(line);
  }

  if (!changed) return;

  await graphql(
    `
    mutation($id: String!, $description: String!) {
      issueUpdate(id: $id, input: { description: $description }) {
        success
      }
    }
    `,
    { id: issueId, description: updatedLines.join("\n") }
  );
  console.log(`OK: description checkboxes updated for ${issueId}`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.log(
      "Usage: npx tsx scripts/update-linear-issue.ts <action> <issue-identifier> [comment]"
    );
    process.exit(1);
  }

  const action = args[0];
  const identifier = args[1];
  const commentText = args[2] ?? "";

  const validActions = new Set([
    "start",
    "done",
    "blocked",
    "failed",
    "needs_split",
    "comment",
  ]);
  if (!validActions.has(action)) {
    console.error(
      `ERROR: unknown action '${action}'. Valid: ${[...validActions].sort().join(", ")}`
    );
    process.exit(1);
  }

  const issue = await findIssueByIdentifier(identifier);
  if (!issue) {
    console.error(`ERROR: issue '${identifier}' not found in Linear.`);
    process.exit(1);
  }

  const issueId = issue.id as string;
  const teamId = (issue.team as any).id as string;
  const description = issue.description as string | null | undefined;

  // State transition for start/done/blocked/failed
  if (action in STATE_TARGETS) {
    const target = await resolveTargetState(teamId, action);
    if (target) {
      await transitionIssue(issueId, target.id);
      console.log(`OK: ${identifier} -> ${target.name}`);
    } else {
      console.log(
        `WARN: no matching state for action '${action}', skipping transition.`
      );
    }
  }

  // Check off acceptance criteria boxes when the task is done
  if (action === "done") {
    const acBlock = process.env.RALPH_ACCEPTANCE_CRITERIA ?? "";
    await updateDescriptionCheckboxes(issueId, description, acBlock);
  }

  // Comments
  if (action === "start") {
    await addComment(
      issueId,
      "Ralph agent picked up this issue and started working on it."
    );
    console.log(`OK: comment added to ${identifier}`);
  } else if (action === "comment") {
    if (!commentText) {
      console.error("ERROR: 'comment' action requires a comment body.");
      process.exit(1);
    }
    await addComment(issueId, commentText);
    console.log(`OK: comment added to ${identifier}`);
  } else if (commentText) {
    const prefixes: Record<string, string> = {
      done: "Agent completed this task.",
      blocked: "Agent marked this task as BLOCKED.",
      failed: "Agent FAILED on this task.",
      needs_split: "Agent marked this task as NEEDS_SPLIT.",
    };
    const prefix = prefixes[action] ?? "";
    const fullComment = prefix ? `${prefix}\n\n${commentText}` : commentText;
    await addComment(issueId, fullComment);
    console.log(`OK: comment added to ${identifier}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
