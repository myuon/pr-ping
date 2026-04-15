import type { IssueCommentEvent } from "@octokit/webhooks-types";
import { upsertReminder } from "../db";
import { addReaction, createIssueComment, createOctokit } from "../github";
import type { Env, TriggerType } from "../types";
import { getInstallationToken } from "../auth";

const REMIND_REGEX = /^\/remind\s+(.+)$/m;
const RELEASE_REGEX = /^\/release\s+(.+)$/m;
const MAX_MEMO_LENGTH = 500;

export async function handleIssueComment(
  payload: IssueCommentEvent,
  env: Env
): Promise<void> {
  if (payload.action !== "created") return;

  const body = payload.comment.body;
  const remindMatch = body.match(REMIND_REGEX);
  const releaseMatch = body.match(RELEASE_REGEX);
  if (!remindMatch && !releaseMatch) return;

  const repoFullName = payload.repository.full_name;
  const issueNumber = payload.issue.number;
  const userLogin = payload.comment.user.login;
  const commentId = payload.comment.id;
  const [owner, repo] = repoFullName.split("/");

  const token = await getInstallationToken(
    env.GITHUB_APP_ID,
    env.GITHUB_PRIVATE_KEY,
    payload.installation?.id
  );
  const octokit = createOctokit(token);

  if (releaseMatch) {
    if (!payload.issue.pull_request) {
      try {
        await createIssueComment(
          octokit,
          owner,
          repo,
          issueNumber,
          "`/release` is only available on pull requests."
        );
      } catch {
        // Best-effort error comment; ignore if it also fails
      }
      return;
    }

    const memo = releaseMatch[1].trim().slice(0, MAX_MEMO_LENGTH);
    try {
      await upsertReminder(env.DB, repoFullName, issueNumber, userLogin, memo, "release");
      await addReaction(octokit, owner, repo, commentId);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown error occurred";
      try {
        await createIssueComment(
          octokit,
          owner,
          repo,
          issueNumber,
          `Failed to register reminder: ${message}`
        );
      } catch {
        // Best-effort error comment; ignore if it also fails
      }
    }
    return;
  }

  if (remindMatch) {
    const memo = remindMatch[1].trim().slice(0, MAX_MEMO_LENGTH);
    const triggerType: TriggerType = payload.issue.pull_request ? "pull_request" : "issue";

    try {
      await upsertReminder(env.DB, repoFullName, issueNumber, userLogin, memo, triggerType);
      await addReaction(octokit, owner, repo, commentId);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown error occurred";
      try {
        await createIssueComment(
          octokit,
          owner,
          repo,
          issueNumber,
          `Failed to register reminder: ${message}`
        );
      } catch {
        // Best-effort error comment; ignore if it also fails
      }
    }
  }
}
