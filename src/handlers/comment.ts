import type { IssueCommentEvent } from "@octokit/webhooks-types";
import { upsertReminder } from "../db";
import { addReaction, createIssueComment, createOctokit } from "../github";
import type { Env } from "../types";
import { getInstallationToken } from "../auth";

const REMIND_REGEX = /^\/remind\s+(.+)$/m;
const MAX_MEMO_LENGTH = 500;

export async function handleIssueComment(
  payload: IssueCommentEvent,
  env: Env
): Promise<void> {
  if (payload.action !== "created") return;

  const body = payload.comment.body;
  const match = body.match(REMIND_REGEX);
  if (!match) return;

  const memo = match[1].trim().slice(0, MAX_MEMO_LENGTH);
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

  try {
    await upsertReminder(env.DB, repoFullName, issueNumber, userLogin, memo);
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
