import type { Octokit } from "@octokit/rest";
import type { Reminder } from "../types";
import { markReminderNotified } from "../db";
import { notifyUser } from "../notify";

export async function fireReminders(
  db: D1Database,
  octokit: Octokit,
  owner: string,
  repo: string,
  issueNumber: number,
  reminders: Reminder[]
): Promise<void> {
  for (const reminder of reminders) {
    await notifyUser(
      db,
      reminder.user_login,
      `@${reminder.user_login} Reminder: ${reminder.memo}`,
      octokit,
      owner,
      repo,
      issueNumber
    );
    await markReminderNotified(db, reminder.id);
  }
}
