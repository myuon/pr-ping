import type { Reminder, NotificationSetting, TriggerType } from "./types";

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
  memo: string,
  triggerType: TriggerType
): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO reminders (repo_full_name, issue_number, user_login, memo, status, trigger_type, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)
       ON CONFLICT (repo_full_name, issue_number, user_login)
       DO UPDATE SET memo = excluded.memo, trigger_type = excluded.trigger_type, status = 'pending', updated_at = excluded.updated_at`
    )
    .bind(repoFullName, issueNumber, userLogin, memo, triggerType, now, now)
    .run();
}

export async function findRemindersByIssue(
  db: D1Database,
  repoFullName: string,
  issueNumber: number
): Promise<Reminder[]> {
  const result = await db
    .prepare(
      `SELECT * FROM reminders WHERE repo_full_name = ? AND issue_number = ? AND status = 'pending'`
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

export async function markReminderNotified(
  db: D1Database,
  id: number
): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare(`UPDATE reminders SET status = 'notified', updated_at = ? WHERE id = ?`)
    .bind(now, id)
    .run();
}

export async function findReleaseReminders(
  db: D1Database,
  repoFullName: string,
  prNumbers: number[]
): Promise<Reminder[]> {
  if (prNumbers.length === 0) return [];

  const placeholders = prNumbers.map(() => "?").join(", ");
  const result = await db
    .prepare(
      `SELECT * FROM reminders WHERE repo_full_name = ? AND issue_number IN (${placeholders}) AND status = 'pending' AND trigger_type = 'release'`
    )
    .bind(repoFullName, ...prNumbers)
    .all<Reminder>();
  return result.results;
}

export async function findRemindersByUser(
  db: D1Database,
  userLogin: string,
  statusFilter?: "pending"
): Promise<Reminder[]> {
  if (statusFilter === "pending") {
    const result = await db
      .prepare(
        `SELECT * FROM reminders WHERE user_login = ? AND status = 'pending' ORDER BY updated_at DESC`
      )
      .bind(userLogin)
      .all<Reminder>();
    return result.results;
  }
  const result = await db
    .prepare(
      `SELECT * FROM reminders WHERE user_login = ? ORDER BY updated_at DESC`
    )
    .bind(userLogin)
    .all<Reminder>();
  return result.results;
}

export async function getNotificationSettings(
  db: D1Database,
  userLogin: string
): Promise<NotificationSetting[]> {
  const result = await db
    .prepare(
      `SELECT * FROM notification_settings WHERE user_login = ?`
    )
    .bind(userLogin)
    .all<NotificationSetting>();
  return result.results;
}

export async function upsertNotificationSetting(
  db: D1Database,
  userLogin: string,
  channel: string,
  config: string,
  enabled: number
): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO notification_settings (user_login, channel, config, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (user_login, channel)
       DO UPDATE SET config = excluded.config, enabled = excluded.enabled, updated_at = excluded.updated_at`
    )
    .bind(userLogin, channel, config, enabled, now, now)
    .run();
}
