import type { Octokit } from "@octokit/rest";
import type { Reminder } from "../types";
import { deleteReminder } from "../db";
import { createIssueComment } from "../github";

export async function fireReminders(
  db: D1Database,
  octokit: Octokit,
  owner: string,
  repo: string,
  issueNumber: number,
  reminders: Reminder[]
): Promise<void> {
  for (const reminder of reminders) {
    await createIssueComment(
      octokit,
      owner,
      repo,
      issueNumber,
      `@${reminder.user_login} Reminder: ${reminder.memo}`
    );
    await deleteReminder(db, reminder.id);
  }
}
