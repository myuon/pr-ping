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
  const settings = await getNotificationSettings(db, userLogin, owner);

  // No account or no settings → skip notification
  if (settings.length === 0) {
    return;
  }

  let notified = false;

  for (const setting of settings) {
    if (!setting.enabled) continue;

    switch (setting.channel) {
      case "github": {
        await createIssueComment(octokit, owner, repo, issueNumber, message);
        notified = true;
        break;
      }
      case "slack": {
        let config: { webhook_url?: string; mention?: string };
        try {
          config = JSON.parse(setting.config) as { webhook_url?: string; mention?: string };
        } catch {
          continue;
        }
        if (config.webhook_url) {
          let slackMessage = message;
          if (config.mention) {
            slackMessage = slackMessage.replace(`@${userLogin}`, config.mention);
          }
          await sendSlackNotification(
            config.webhook_url,
            slackMessage,
            owner,
            repo,
            issueNumber
          );
          notified = true;
        }
        break;
      }
    }
  }

  if (!notified) {
    throw new Error(`All notification channels failed for user ${userLogin}`);
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
    throw new Error(
      `Slack notification failed: ${response.status} ${response.statusText}`
    );
  }
}
