import { Octokit } from "@octokit/rest";

export function createOctokit(token: string): Octokit {
  return new Octokit({ auth: token });
}

export async function addReaction(
  octokit: Octokit,
  owner: string,
  repo: string,
  commentId: number
): Promise<void> {
  await octokit.reactions.createForIssueComment({
    owner,
    repo,
    comment_id: commentId,
    content: "eyes",
  });
}

export async function createIssueComment(
  octokit: Octokit,
  owner: string,
  repo: string,
  issueNumber: number,
  body: string
): Promise<void> {
  await octokit.issues.createComment({
    owner,
    repo,
    issue_number: issueNumber,
    body,
  });
}
