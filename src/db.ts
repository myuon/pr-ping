import type { Reminder } from "./types";

export async function upsertReminder(
  db: D1Database,
  repoFullName: string,
  issueNumber: number,
  userLogin: string,
  memo: string
): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO reminders (repo_full_name, issue_number, user_login, memo, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (repo_full_name, issue_number, user_login)
       DO UPDATE SET memo = excluded.memo, updated_at = excluded.updated_at`
    )
    .bind(repoFullName, issueNumber, userLogin, memo, now, now)
    .run();
}

export async function findRemindersByIssue(
  db: D1Database,
  repoFullName: string,
  issueNumber: number
): Promise<Reminder[]> {
  const result = await db
    .prepare(
      `SELECT * FROM reminders WHERE repo_full_name = ? AND issue_number = ?`
    )
    .bind(repoFullName, issueNumber)
    .all<Reminder>();
  return result.results;
}

export async function deleteRemindersByIssue(
  db: D1Database,
  repoFullName: string,
  issueNumber: number
): Promise<void> {
  await db
    .prepare(
      `DELETE FROM reminders WHERE repo_full_name = ? AND issue_number = ?`
    )
    .bind(repoFullName, issueNumber)
    .run();
}
