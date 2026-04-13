import type { PullRequestEvent } from "@octokit/webhooks-types";
import { deleteRemindersByIssue, findRemindersByIssue } from "../db";
import { createIssueComment, createOctokit } from "../github";
import type { Env } from "../types";
import { getInstallationToken } from "../auth";

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

  await Promise.all(
    reminders.map((reminder) =>
      createIssueComment(
        octokit,
        owner,
        repo,
        prNumber,
        `@${reminder.user_login} Reminder: ${reminder.memo}`
      )
    )
  );

  await deleteRemindersByIssue(env.DB, repoFullName, prNumber);
}
