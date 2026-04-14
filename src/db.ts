import type { Reminder } from "./types";

export async function isDeliveryProcessed(
  db: D1Database,
  deliveryId: string
): Promise<boolean> {
  const row = await db
    .prepare(`SELECT 1 FROM processed_deliveries WHERE delivery_id = ?`)
    .bind(deliveryId)
    .first();
  return row !== null;
}

export async function markDeliveryProcessed(
  db: D1Database,
  deliveryId: string
): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT OR IGNORE INTO processed_deliveries (delivery_id, processed_at) VALUES (?, ?)`
    )
    .bind(deliveryId, now)
    .run();
}

export async function cleanOldDeliveries(
  db: D1Database
): Promise<void> {
  await db
    .prepare(
      `DELETE FROM processed_deliveries WHERE processed_at < datetime('now', '-1 day')`
    )
    .run();
}

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

export async function deleteReminder(
  db: D1Database,
  id: number
): Promise<void> {
  await db
    .prepare(`DELETE FROM reminders WHERE id = ?`)
    .bind(id)
    .run();
}

export async function findRemindersByUser(
  db: D1Database,
  userLogin: string
): Promise<Reminder[]> {
  const result = await db
    .prepare(
      `SELECT * FROM reminders WHERE user_login = ? ORDER BY updated_at DESC`
    )
    .bind(userLogin)
    .all<Reminder>();
  return result.results;
}
