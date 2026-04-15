import type { ReleaseEvent } from "@octokit/webhooks-types";
import { findReleaseReminders } from "../db";
import { createOctokit } from "../github";
import type { Env } from "../types";
import { getInstallationToken } from "../auth";
import { fireReminders } from "./fire-reminders";

export async function handleReleasePublished(
  payload: ReleaseEvent,
  env: Env
): Promise<void> {
  if (payload.action !== "published") return;

  const repoFullName = payload.repository.full_name;
  const [owner, repo] = repoFullName.split("/");
  const newTag = payload.release.tag_name;

  const token = await getInstallationToken(
    env.GITHUB_APP_ID,
    env.GITHUB_PRIVATE_KEY,
    payload.installation?.id
  );
  const octokit = createOctokit(token);

  // Find the previous release to compare against
  const { data: releases } = await octokit.repos.listReleases({
    owner,
    repo,
    per_page: 100,
  });

  // Releases are returned newest first; find the one right after the current
  const currentIndex = releases.findIndex(
    (r) => r.tag_name === newTag
  );
  if (currentIndex === -1) return;

  const prevRelease = releases[currentIndex + 1];
  if (!prevRelease) {
    // No previous release — skip since we can't determine which PRs are new
    return;
  }

  const prevTag = prevRelease.tag_name;

  // Compare commits between previous and current release
  const { data: comparison } = await octokit.repos.compareCommitsWithBasehead({
    owner,
    repo,
    basehead: `${prevTag}...${newTag}`,
  });

  // Collect unique PR numbers from all commits in this release
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

  // Group reminders by PR number and fire them
  for (const reminder of reminders) {
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
