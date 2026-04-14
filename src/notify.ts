import type { Octokit } from "@octokit/rest";
import { getNotificationSettings } from "./db";
import { createIssueComment } from "./github";

export async function notifyUser(
  db: D1Database,
  userLogin: string,
  message: string,
  octokit: Octokit,
  owner: string,
  repo: string,
  issueNumber: number
): Promise<void> {
  const settings = await getNotificationSettings(db, userLogin);

  // Default to GitHub comment only if no settings configured
  if (settings.length === 0) {
    await createIssueComment(octokit, owner, repo, issueNumber, message);
    return;
  }

  for (const setting of settings) {
    if (!setting.enabled) continue;

    switch (setting.channel) {
      case "github": {
        await createIssueComment(octokit, owner, repo, issueNumber, message);
        break;
      }
      case "slack": {
        const config = JSON.parse(setting.config) as { webhook_url?: string };
        if (config.webhook_url) {
          await sendSlackNotification(
            config.webhook_url,
            message,
            owner,
            repo,
            issueNumber
          );
        }
        break;
      }
    }
  }
}

async function sendSlackNotification(
  webhookUrl: string,
  message: string,
  owner: string,
  repo: string,
  issueNumber: number
): Promise<void> {
  const issueUrl = `https://github.com/${owner}/${repo}/issues/${issueNumber}`;
  const payload = {
    text: `${message}\n<${issueUrl}|${owner}/${repo}#${issueNumber}>`,
  };

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    console.error(
      `Slack notification failed: ${response.status} ${response.statusText}`
    );
  }
}
