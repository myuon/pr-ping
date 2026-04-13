export interface Env {
  DB: D1Database;
  GITHUB_APP_ID: string;
  GITHUB_PRIVATE_KEY: string;
  GITHUB_WEBHOOK_SECRET: string;
}

export interface Reminder {
  id: number;
  repo_full_name: string;
  issue_number: number;
  user_login: string;
  memo: string;
  created_at: string;
  updated_at: string;
}
