import { Hono } from "hono";
import type { Env } from "./types";
import { handleIssueComment } from "./handlers/comment";
import { handleIssueClosed } from "./handlers/issue";
import { handlePullRequestClosed } from "./handlers/pull-request";
import { handlePush } from "./handlers/release";
import { isDeliveryProcessed, markDeliveryProcessed, cleanOldDeliveries, findRemindersByUser, getNotificationSettings, upsertNotificationSetting, getReleaseBranch } from "./db";
import { createSessionCookie, getSessionUser, clearSessionCookie } from "./session";

type HonoEnv = {
  Bindings: Env;
};

const app = new Hono<HonoEnv>();

async function verifySignature(
  secret: string,
  payload: string,
  signature: string
): Promise<boolean> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  const digest = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const expected = `sha256=${digest}`;

  // Constant-time comparison
  if (expected.length !== signature.length) return false;
  let result = 0;
  for (let i = 0; i < expected.length; i++) {
    result |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return result === 0;
}

app.post("/webhook", async (c) => {
  const signature = c.req.header("x-hub-signature-256");
  if (!signature) {
    return c.json({ error: "Missing signature" }, 401);
  }

  const deliveryId = c.req.header("x-github-delivery");
  if (!deliveryId) {
    return c.json({ error: "Missing delivery ID" }, 400);
  }

  const rawBody = await c.req.text();
  const isValid = await verifySignature(
    c.env.GITHUB_WEBHOOK_SECRET,
    rawBody,
    signature
  );
  if (!isValid) {
    return c.json({ error: "Invalid signature" }, 401);
  }

  if (await isDeliveryProcessed(c.env.DB, deliveryId)) {
    return c.json({ ok: true, skipped: "duplicate delivery" });
  }

  const event = c.req.header("x-github-event");
  const payload = JSON.parse(rawBody);

  try {
    switch (event) {
      case "issue_comment":
        await handleIssueComment(payload, c.env);
        break;
      case "issues":
        await handleIssueClosed(payload, c.env);
        break;
      case "pull_request":
        await handlePullRequestClosed(payload, c.env);
        break;
      case "push":
        await handlePush(payload, c.env);
        break;
      default:
        // Ignore unhandled events
        break;
    }

    await markDeliveryProcessed(c.env.DB, deliveryId);
  } catch (error) {
    console.error("Error handling webhook:", error);
    return c.json({ error: "Internal server error" }, 500);
  }

  // Best-effort cleanup of old delivery records
  c.executionCtx.waitUntil(cleanOldDeliveries(c.env.DB));

  return c.json({ ok: true });
});

app.get("/login", (c) => {
  const state = crypto.randomUUID();
  const params = new URLSearchParams({
    client_id: c.env.GITHUB_CLIENT_ID,
    redirect_uri: new URL("/callback", c.req.url).toString(),
    state,
  });
  return c.redirect(`https://github.com/login/oauth/authorize?${params}`);
});

app.get("/callback", async (c) => {
  const code = c.req.query("code");
  if (!code) {
    return c.text("Missing code", 400);
  }

  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      client_id: c.env.GITHUB_CLIENT_ID,
      client_secret: c.env.GITHUB_CLIENT_SECRET,
      code,
    }),
  });
  const tokenData = (await tokenRes.json()) as { access_token?: string; error?: string };
  if (!tokenData.access_token) {
    return c.text("OAuth failed", 400);
  }

  const userRes = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${tokenData.access_token}`,
      "User-Agent": "PRPing",
    },
  });
  const userData = (await userRes.json()) as { login: string };

  // Create default notification settings on first login
  const existing = await getNotificationSettings(c.env.DB, userData.login);
  if (existing.length === 0) {
    await upsertNotificationSetting(c.env.DB, userData.login, "github", "{}", 1);
  }

  const cookie = await createSessionCookie(userData.login, c.env.SESSION_SECRET);
  return new Response(null, {
    status: 302,
    headers: {
      Location: "/me",
      "Set-Cookie": cookie,
    },
  });
});

app.get("/logout", (c) => {
  return new Response(null, {
    status: 302,
    headers: {
      Location: "/",
      "Set-Cookie": clearSessionCookie(),
    },
  });
});

app.get("/me", async (c) => {
  const user = await getSessionUser(c.req.header("cookie"), c.env.SESSION_SECRET);
  if (!user) {
    return c.redirect("/login");
  }

  const showAll = new URL(c.req.url).searchParams.get("show") === "all";
  const reminders = await findRemindersByUser(c.env.DB, user, showAll ? undefined : "pending");
  const notificationSettings = await getNotificationSettings(c.env.DB, user);

  const githubSetting = notificationSettings.find((s) => s.channel === "github");
  const slackSetting = notificationSettings.find((s) => s.channel === "slack");

  // Default: github enabled if no settings exist
  const githubEnabled = notificationSettings.length === 0 || (githubSetting?.enabled === 1);
  const slackEnabled = slackSetting?.enabled === 1;
  let slackWebhookUrl = "";
  let slackMention = "";
  if (slackSetting) {
    try {
      const slackConfig = JSON.parse(slackSetting.config) as { webhook_url?: string; mention?: string };
      slackWebhookUrl = slackConfig.webhook_url ?? "";
      slackMention = slackConfig.mention ?? "";
    } catch {}
  }

  const releaseBranch = await getReleaseBranch(c.env.DB, user);

  const savedParam = new URL(c.req.url).searchParams.get("saved");

  const statusLabel = (s: string) => s === "notified"
    ? `<span style="color:#1a7f37;background:#dafbe1;padding:0.125rem 0.5rem;border-radius:2rem;font-size:0.75rem">Notified</span>`
    : `<span style="color:#9a6700;background:#fff8c5;padding:0.125rem 0.5rem;border-radius:2rem;font-size:0.75rem">Pending</span>`;

  const triggerLabel = (t: string) => {
    if (t === "pull_request") return `<span style="font-size:0.75rem">PR merge</span>`;
    if (t === "release") return `<span style="font-size:0.75rem">Branch push</span>`;
    return `<span style="font-size:0.75rem">Issue close</span>`;
  };

  const rows = reminders.length === 0
    ? `<tr><td colspan="6" style="text-align:center;color:#666;padding:2rem">${showAll ? "No reminders" : "No pending reminders"}</td></tr>`
    : reminders
        .map(
          (r) => `<tr>
            <td><a href="https://github.com/${r.repo_full_name}/issues/${r.issue_number}">${r.repo_full_name}#${r.issue_number}</a></td>
            <td>${escapeHtml(r.memo)}</td>
            <td>${statusLabel(r.status)}</td>
            <td>${triggerLabel(r.trigger_type)}</td>
            <td>${new Date(r.created_at).toLocaleDateString()}</td>
            <td>${new Date(r.updated_at).toLocaleDateString()}</td>
          </tr>`
        )
        .join("");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>PRPing - My Reminders</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f6f8fa; color: #24292f; }
    .container { max-width: 800px; margin: 0 auto; padding: 2rem 1rem; }
    header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 2rem; }
    header h1 { font-size: 1.5rem; }
    .user-info { display: flex; align-items: center; gap: 1rem; }
    .user-info span { color: #57606a; }
    .user-info a { color: #cf222e; text-decoration: none; font-size: 0.875rem; }
    table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #d0d7de; border-radius: 6px; overflow: hidden; }
    th { background: #f6f8fa; text-align: left; padding: 0.75rem 1rem; border-bottom: 1px solid #d0d7de; font-size: 0.875rem; color: #57606a; }
    td { padding: 0.75rem 1rem; border-bottom: 1px solid #d0d7de; font-size: 0.875rem; }
    tr:last-child td { border-bottom: none; }
    a { color: #0969da; text-decoration: none; }
    a:hover { text-decoration: underline; }
    h2 { font-size: 1.25rem; margin: 2rem 0 1rem; }
    .settings-form { background: #fff; border: 1px solid #d0d7de; border-radius: 6px; padding: 1.5rem; }
    .form-group { margin-bottom: 1rem; }
    .form-group label { display: flex; align-items: center; gap: 0.5rem; font-size: 0.875rem; cursor: pointer; }
    .form-group input[type="text"] { width: 100%; padding: 0.5rem 0.75rem; border: 1px solid #d0d7de; border-radius: 6px; font-size: 0.875rem; margin-top: 0.25rem; }
    .form-group .hint { font-size: 0.75rem; color: #57606a; margin-top: 0.25rem; }
    .form-actions { margin-top: 1rem; }
    .form-actions button { background: #2da44e; color: #fff; border: none; padding: 0.5rem 1rem; border-radius: 6px; font-size: 0.875rem; cursor: pointer; font-weight: 500; }
    .form-actions button:hover { background: #218838; }
    .success-message { background: #dafbe1; color: #116329; border: 1px solid #aceebb; padding: 0.75rem 1rem; border-radius: 6px; margin-bottom: 1rem; font-size: 0.875rem; }
    .error-message { background: #ffebe9; color: #82071e; border: 1px solid #ffcecb; padding: 0.75rem 1rem; border-radius: 6px; margin-bottom: 1rem; font-size: 0.875rem; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>PRPing</h1>
      <div class="user-info">
        <span>@${escapeHtml(user)}</span>
        <a href="/logout">Logout</a>
      </div>
    </header>
    <div style="margin-bottom:0.75rem;font-size:0.875rem">
      ${showAll
        ? `Showing all reminders. <a href="/me">Show pending only</a>`
        : `Showing pending only. <a href="/me?show=all">Show all</a>`}
    </div>
    <table>
      <thead>
        <tr>
          <th>Issue / PR</th>
          <th>Memo</th>
          <th>Status</th>
          <th>Trigger</th>
          <th>Created</th>
          <th>Updated</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>

    <h2>Notification Settings</h2>
    ${savedParam === "1" ? `<div class="success-message">Settings saved successfully.</div>` : ""}
    ${savedParam === "error" ? `<div class="error-message">Invalid Slack webhook URL. It must start with https://hooks.slack.com/</div>` : ""}
    ${savedParam === "branch_error" ? `<div class="error-message">Invalid branch name. It must be non-empty, contain no spaces, and be under 200 characters.</div>` : ""}
    <form class="settings-form" method="POST" action="/me/settings">
      <div class="form-group">
        <label>
          <input type="checkbox" name="github_enabled" value="1" ${githubEnabled ? "checked" : ""}>
          GitHub comment notification
        </label>
      </div>
      <div class="form-group">
        <label>
          <input type="checkbox" name="slack_enabled" value="1" ${slackEnabled ? "checked" : ""}>
          Slack notification
        </label>
        <input type="text" name="slack_webhook_url" value="${escapeHtml(slackWebhookUrl)}" placeholder="https://hooks.slack.com/services/...">
        <div class="hint">Enter your Slack Incoming Webhook URL</div>
        <label style="margin-top:0.5rem">Slack mention</label>
        <input type="text" name="slack_mention" value="${escapeHtml(slackMention)}" placeholder="<@U12345678>">
        <div class="hint">Slack user ID for mentions (e.g. &lt;@U12345678&gt;). Leave empty to use GitHub username.</div>
      </div>
      <div class="form-group">
        <label>Release trigger branch</label>
        <input type="text" name="release_branch" value="${escapeHtml(releaseBranch)}" placeholder="main">
        <div class="hint">Branch name that triggers /release reminders when commits are pushed (default: main)</div>
      </div>
      <div class="form-actions">
        <button type="submit">Save settings</button>
      </div>
    </form>
  </div>
</body>
</html>`;

  return c.html(html);
});

app.post("/me/settings", async (c) => {
  const user = await getSessionUser(c.req.header("cookie"), c.env.SESSION_SECRET);
  if (!user) {
    return c.redirect("/login");
  }

  const formData = await c.req.parseBody();
  const githubEnabled = formData["github_enabled"] === "1" ? 1 : 0;
  const slackEnabled = formData["slack_enabled"] === "1" ? 1 : 0;
  const slackWebhookUrl = typeof formData["slack_webhook_url"] === "string" ? formData["slack_webhook_url"].trim() : "";
  const slackMention = typeof formData["slack_mention"] === "string" ? formData["slack_mention"].trim() : "";

  const releaseBranch = typeof formData["release_branch"] === "string" ? formData["release_branch"].trim() : "main";

  if (slackEnabled) {
    if (!slackWebhookUrl || !slackWebhookUrl.startsWith("https://hooks.slack.com/")) {
      return c.redirect("/me?saved=error");
    }
  }

  // Validate release branch name
  if (!releaseBranch || releaseBranch.includes(" ") || releaseBranch.length > 200) {
    return c.redirect("/me?saved=branch_error");
  }

  await upsertNotificationSetting(c.env.DB, user, "github", "{}", githubEnabled);
  await upsertNotificationSetting(
    c.env.DB,
    user,
    "slack",
    JSON.stringify({ webhook_url: slackWebhookUrl, mention: slackMention || undefined }),
    slackEnabled
  );
  await upsertNotificationSetting(
    c.env.DB,
    user,
    "release_trigger",
    JSON.stringify({ branch: releaseBranch }),
    1
  );

  return c.redirect("/me?saved=1");
});

app.get("/", (c) => {
  return c.html(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>PRPing</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; background: #f6f8fa; color: #24292f; }
    .card { text-align: center; background: #fff; padding: 3rem; border-radius: 12px; border: 1px solid #d0d7de; }
    h1 { margin-bottom: 0.5rem; }
    p { color: #57606a; margin-bottom: 1.5rem; }
    a { display: inline-block; background: #24292f; color: #fff; padding: 0.75rem 1.5rem; border-radius: 6px; text-decoration: none; font-weight: 500; }
    a:hover { background: #32383f; }
  </style>
</head>
<body>
  <div class="card">
    <h1>PRPing</h1>
    <p>Never forget your follow-ups on GitHub.</p>
    <a href="/login">Sign in with GitHub</a>
  </div>
</body>
</html>`);
});

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export default app;
