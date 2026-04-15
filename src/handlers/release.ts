import type { PushEvent } from "@octokit/webhooks-types";
import { findReleaseReminders, getReleaseBranch } from "../db";
import { createOctokit } from "../github";
import type { Env } from "../types";
import { getInstallationToken } from "../auth";
import { fireReminders } from "./fire-reminders";

export async function handlePush(
  payload: PushEvent,
  env: Env
): Promise<void> {
  // Skip new branch creation (before is all zeros)
  if (payload.before === "0000000000000000000000000000000000000000") return;

  // Skip force pushes
  if (payload.forced) return;

  const repoFullName = payload.repository.full_name;
  const [owner, repo] = repoFullName.split("/");
  const pushedRef = payload.ref; // e.g. "refs/heads/main"

  const token = await getInstallationToken(
    env.GITHUB_APP_ID,
    env.GITHUB_PRIVATE_KEY,
    payload.installation?.id
  );
  const octokit = createOctokit(token);

  // Compare commits between before and after
  const { data: comparison } = await octokit.repos.compareCommitsWithBasehead({
    owner,
    repo,
    basehead: `${payload.before}...${payload.after}`,
  });

  // Collect unique PR numbers from all commits in this push
  const prNumbers = new Set<number>();
  for (const commit of comparison.commits) {
    const { data: prs } =
      await octokit.repos.listPullRequestsAssociatedWithCommit({
        owner,
        repo,
        commit_sha: commit.sha,
      });
    for (const pr of prs) {
      prNumbers.add(pr.number);
    }
  }

  if (prNumbers.size === 0) return;

  const reminders = await findReleaseReminders(
    env.DB,
    repoFullName,
    Array.from(prNumbers)
  );
  if (reminders.length === 0) return;

  // Filter reminders: only fire for users whose configured release branch matches the pushed branch
  for (const reminder of reminders) {
    const userBranch = await getReleaseBranch(env.DB, reminder.user_login);
    const expectedRef = `refs/heads/${userBranch}`;
    if (pushedRef !== expectedRef) continue;

    await fireReminders(
      env.DB,
      octokit,
      owner,
      repo,
      reminder.issue_number,
      [reminder]
    );
  }
}
