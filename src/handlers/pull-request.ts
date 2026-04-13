import type { PullRequestEvent } from "@octokit/webhooks-types";
import { findRemindersByIssue } from "../db";
import { createOctokit } from "../github";
import type { Env } from "../types";
import { getInstallationToken } from "../auth";
import { fireReminders } from "./fire-reminders";

export async function handlePullRequestClosed(
  payload: PullRequestEvent,
  env: Env
): Promise<void> {
  if (payload.action !== "closed") return;
  if (!payload.pull_request.merged) return;

  const repoFullName = payload.repository.full_name;
  const prNumber = payload.pull_request.number;
  const [owner, repo] = repoFullName.split("/");

  const reminders = await findRemindersByIssue(
    env.DB,
    repoFullName,
    prNumber
  );
  if (reminders.length === 0) return;

  const token = await getInstallationToken(
    env.GITHUB_APP_ID,
    env.GITHUB_PRIVATE_KEY,
    payload.installation?.id
  );
  const octokit = createOctokit(token);

  await fireReminders(env.DB, octokit, owner, repo, prNumber, reminders);
}
