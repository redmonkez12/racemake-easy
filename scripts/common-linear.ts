/**
 * Shared utilities for Linear API interaction.
 * Bun automatically loads .env — no dotenv import needed.
 */

const LINEAR_API_URL = "https://api.linear.app/graphql";

export function getApiKey(): string {
  const key = (process.env.LINEAR_API_KEY ?? "").trim();
  if (!key) {
    process.stderr.write("ERROR: LINEAR_API_KEY environment variable is not set.\n");
    process.exit(1);
  }
  return key;
}

export function getProjectName(): string {
  const name = (process.env.LINEAR_PROJECT_NAME ?? "").trim();
  if (!name) {
    process.stderr.write("ERROR: LINEAR_PROJECT_NAME environment variable is not set.\n");
    process.exit(1);
  }
  return name;
}

export async function graphql<T = Record<string, unknown>>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const apiKey = getApiKey();
  const payload: Record<string, unknown> = { query };
  if (variables) payload.variables = variables;

  const response = await fetch(LINEAR_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: apiKey,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    process.stderr.write(`ERROR: Linear API returned ${response.status}: ${errorBody}\n`);
    process.exit(1);
  }

  const body = (await response.json()) as {
    data?: Record<string, unknown>;
    errors?: unknown[];
  };

  if (body.errors) {
    process.stderr.write(`ERROR: Linear GraphQL errors: ${JSON.stringify(body.errors, null, 2)}\n`);
    process.exit(1);
  }

  return (body.data ?? {}) as T;
}
