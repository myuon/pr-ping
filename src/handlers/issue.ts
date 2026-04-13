import type { IssuesEvent } from "@octokit/webhooks-types";
import { findRemindersByIssue } from "../db";
import { createOctokit } from "../github";
import type { Env } from "../types";
import { getInstallationToken } from "../auth";
import { fireReminders } from "./fire-reminders";

export async function handleIssueClosed(
  payload: IssuesEvent,
  env: Env
): Promise<void> {
  if (payload.action !== "closed") return;
  // Skip PRs — they are handled by the pull_request handler
  if ((payload.issue as unknown as { pull_request?: unknown }).pull_request) return;

  const repoFullName = payload.repository.full_name;
  const issueNumber = payload.issue.number;
  const [owner, repo] = repoFullName.split("/");

  const reminders = await findRemindersByIssue(
    env.DB,
    repoFullName,
    issueNumber
  );
  if (reminders.length === 0) return;

  const token = await getInstallationToken(
    env.GITHUB_APP_ID,
    env.GITHUB_PRIVATE_KEY,
    payload.installation?.id
  );
  const octokit = createOctokit(token);

  await fireReminders(env.DB, octokit, owner, repo, issueNumber, reminders);
}
