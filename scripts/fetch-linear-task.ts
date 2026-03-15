#!/usr/bin/env tsx
/**
 * Fetch one suitable task from Linear for the Ralph loop.
 *
 * Selection rules (in order):
 * 1. Resume first: if any issue is already "In Progress" (state type: started)
 *    and NOT labelled "blocked", pick that one (lowest issue number wins).
 * 2. Otherwise pick from backlog/unstarted (state type: backlog or unstarted).
 * 3. Sort all issues by issue number (ascending).
 * 4. For each issue in order:
 *    - If it is a leaf (no children) and not blocked → pick it.
 *    - If it is a parent (has children) → find its lowest-numbered eligible
 *      child (backlog/unstarted, not blocked, not itself a parent) and pick that.
 * 5. Issues labelled "blocked" are skipped. If their Linear "blocked by"
 *    relations are all completed, the "blocked" label is auto-removed first.
 *
 * Writes state/current-task.md and prints a machine-readable result line.
 */

import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { getProjectName, graphql } from "./common-linear.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_DIR = join(__dirname, "..", "state");

interface IssueLabel {
  id?: string;
  name: string;
}

interface IssueState {
  name: string;
  type: string;
}

interface ChildIssue {
  id: string;
  identifier: string;
  title: string;
  description?: string;
  priority?: number;
  priorityLabel?: string;
  url?: string;
  labels: { nodes: IssueLabel[] };
  state: IssueState;
  children: { nodes: Array<{ id: string }> };
}

interface Issue {
  id: string;
  identifier: string;
  title: string;
  description?: string;
  priority?: number;
  priorityLabel?: string;
  url?: string;
  labels: { nodes: IssueLabel[] };
  state: IssueState;
  createdAt?: string;
  children: { nodes: ChildIssue[] };
}

const ISSUE_FIELDS = `
  id
  identifier
  title
  description
  priority
  priorityLabel
  url
  labels { nodes { name } }
  state { name type }
  createdAt
  children {
    nodes {
      id
      identifier
      title
      description
      priority
      priorityLabel
      url
      labels { nodes { name } }
      state { name type }
      children { nodes { id } }
    }
  }
`;

async function findProjectId(projectName: string): Promise<string | null> {
  const data = await graphql(
    `
    query($filter: ProjectFilter) {
      projects(filter: $filter) {
        nodes { id name }
      }
    }
    `,
    { filter: { name: { eq: projectName } } }
  );
  const nodes = ((data.projects as any)?.nodes ?? []) as Array<{
    id: string;
    name: string;
  }>;
  for (const node of nodes) {
    if (node.name === projectName) return node.id;
  }
  return null;
}

async function fetchInProgressIssues(projectId: string): Promise<Issue[]> {
  const data = await graphql(
    `
    query($projectId: ID!) {
      issues(
        filter: {
          project: { id: { eq: $projectId } }
          state: { type: { in: ["started"] } }
        }
        orderBy: createdAt
        first: 100
      ) {
        nodes { ${ISSUE_FIELDS} }
      }
    }
    `,
    { projectId }
  );
  return ((data.issues as any)?.nodes ?? []) as Issue[];
}

async function fetchCandidateIssues(projectId: string): Promise<Issue[]> {
  const data = await graphql(
    `
    query($projectId: ID!) {
      issues(
        filter: {
          project: { id: { eq: $projectId } }
          state: { type: { in: ["backlog", "unstarted"] } }
        }
        orderBy: createdAt
        first: 100
      ) {
        nodes { ${ISSUE_FIELDS} }
      }
    }
    `,
    { projectId }
  );
  return ((data.issues as any)?.nodes ?? []) as Issue[];
}

function issueNumber(issue: { identifier: string }): number {
  try {
    return parseInt(issue.identifier.split("-")[1], 10);
  } catch {
    return 999999;
  }
}

function isParent(issue: Issue | ChildIssue): boolean {
  return (issue.children?.nodes ?? []).length > 0;
}

function isBlocked(issue: Issue | ChildIssue): boolean {
  return (issue.labels?.nodes ?? []).some(
    (label) => label.name.toLowerCase() === "blocked"
  );
}

function pickBestIssue(issues: Issue[]): Issue | null {
  for (const issue of [...issues].sort(
    (a, b) => issueNumber(a) - issueNumber(b)
  )) {
    if (!isParent(issue)) {
      if (!isBlocked(issue)) return issue;
    } else {
      const children = issue.children?.nodes ?? [];
      const eligible = children.filter(
        (c) =>
          !isParent(c) &&
          !isBlocked(c) &&
          ["backlog", "unstarted"].includes(c.state?.type ?? "")
      );
      if (eligible.length > 0) {
        return eligible.reduce((best, c) =>
          issueNumber(c) < issueNumber(best) ? c : best
        ) as unknown as Issue;
      }
    }
  }
  return null;
}

function writeCurrentTask(issue: Issue): void {
  mkdirSync(STATE_DIR, { recursive: true });
  const labels = (issue.labels?.nodes ?? []).map((l) => l.name);
  const desc = issue.description ?? "(no description)";

  const content = `# Current Task

Issue: ${issue.identifier}
Title: ${issue.title}
Priority: ${issue.priorityLabel ?? "None"}
State: ${issue.state?.name ?? "Unknown"}
Labels: ${labels.length > 0 ? labels.join(", ") : "none"}
URL: ${issue.url ?? ""}

## Description

${desc}

## Notes

- This file was auto-generated by fetch-linear-task.ts.
- The agent must implement exactly this issue.
- Follow AGENT.md and PROMPT.md for execution rules.
`;
  writeFileSync(join(STATE_DIR, "current-task.md"), content);
}

async function fetchBlockedIssuesWithRelations(
  projectId: string
): Promise<any[]> {
  const data = await graphql(
    `
    query($projectId: ID!) {
      issues(
        filter: {
          project: { id: { eq: $projectId } }
          state: { type: { in: ["backlog", "unstarted", "started"] } }
          labels: { name: { eq: "blocked" } }
        }
        first: 100
      ) {
        nodes {
          id
          identifier
          labels { nodes { id name } }
          inverseRelations(first: 50) {
            nodes {
              type
              issue {
                id
                identifier
                state { type }
              }
            }
          }
        }
      }
    }
    `,
    { projectId }
  );
  return ((data.issues as any)?.nodes ?? []);
}

async function removeLabel(
  issueId: string,
  labelIds: string[]
): Promise<void> {
  await graphql(
    `
    mutation($id: String!, $labelIds: [String!]!) {
      issueUpdate(id: $id, input: { labelIds: $labelIds }) {
        success
      }
    }
    `,
    { id: issueId, labelIds }
  );
}

async function autoUnblock(projectId: string): Promise<string[]> {
  const COMPLETED_STATE_TYPES = new Set(["completed", "cancelled"]);
  const blockedIssues = await fetchBlockedIssuesWithRelations(projectId);
  const unblocked: string[] = [];

  for (const issue of blockedIssues) {
    const relations = (issue.inverseRelations?.nodes ?? []) as any[];
    const blockers = relations
      .filter((r: any) => r.type === "blocks")
      .map((r: any) => r.issue);

    if (blockers.length === 0) continue;

    const allResolved = blockers.every((b: any) =>
      COMPLETED_STATE_TYPES.has(b.state?.type)
    );

    if (allResolved) {
      const labels = (issue.labels?.nodes ?? []) as Array<{
        id: string;
        name: string;
      }>;
      const remainingIds = labels
        .filter((lb) => lb.name.toLowerCase() !== "blocked")
        .map((lb) => lb.id);
      await removeLabel(issue.id, remainingIds);
      unblocked.push(issue.identifier);
    }
  }

  return unblocked;
}

function filterEligible(issues: Issue[]): Issue[] {
  return issues.filter((i) => !isParent(i) && !isBlocked(i));
}

async function main(): Promise<void> {
  const projectName = getProjectName();

  const projectId = await findProjectId(projectName);
  if (!projectId) {
    console.log(`NO_TASK_FOUND: project '${projectName}' not found in Linear.`);
    process.exit(0);
  }

  // Phase 0: auto-unblock issues whose blockers are all done
  const unblocked = await autoUnblock(projectId);
  if (unblocked.length > 0) {
    console.log(`AUTO_UNBLOCKED: ${unblocked.join(", ")}`);
  }

  // Phase 1: resume any in-progress work first
  const inProgress = await fetchInProgressIssues(projectId);
  const resumable = filterEligible(inProgress);
  if (resumable.length > 0) {
    const best = resumable.reduce((a, b) =>
      issueNumber(a) <= issueNumber(b) ? a : b
    );
    writeCurrentTask(best);

    const blockedWip = inProgress.filter(isBlocked).map((i) => i.identifier);
    if (blockedWip.length > 0) {
      console.log(`SKIPPED_BLOCKED_WIP: ${blockedWip.join(", ")}`);
    }

    console.log(`TASK_RESUMED: ${best.identifier} | ${best.title}`);
    return;
  }

  // Phase 2: pick from backlog/unstarted
  const issues = await fetchCandidateIssues(projectId);
  if (issues.length === 0) {
    console.log(
      `NO_TASK_FOUND: no open issues in project '${projectName}'.`
    );
    process.exit(0);
  }

  const best = pickBestIssue(issues);
  if (!best) {
    console.log(
      "NO_TASK_FOUND: all open issues are parent/epic containers, blocked, or have no open leaf tasks."
    );
    process.exit(0);
  }

  writeCurrentTask(best);

  const blocked = issues.filter(isBlocked).map((i) => i.identifier);
  if (blocked.length > 0) {
    console.log(`SKIPPED_BLOCKED: ${blocked.join(", ")}`);
  }

  console.log(`TASK_FOUND: ${best.identifier} | ${best.title}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
