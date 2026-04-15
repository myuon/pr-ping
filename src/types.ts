export interface Env {
  DB: D1Database;
  GITHUB_APP_ID: string;
  GITHUB_PRIVATE_KEY: string;
  GITHUB_WEBHOOK_SECRET: string;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  SESSION_SECRET: string;
}

export type ReminderStatus = "pending" | "notified";
export type TriggerType = "issue" | "pull_request" | "release";

export interface Reminder {
  id: number;
  repo_full_name: string;
  issue_number: number;
  user_login: string;
  memo: string;
  status: ReminderStatus;
  trigger_type: TriggerType;
  command: string;
  created_at: string;
  updated_at: string;
}

export interface NotificationSetting {
  id: number;
  user_login: string;
  channel: string;
  config: string;
  enabled: number;
  created_at: string;
  updated_at: string;
}
