import { Hono } from "hono";
import type { Env } from "./types";
import { handleIssueComment } from "./handlers/comment";
import { handleIssueClosed } from "./handlers/issue";
import { handlePullRequestClosed } from "./handlers/pull-request";
import { isDeliveryProcessed, markDeliveryProcessed, cleanOldDeliveries, findRemindersByUser } from "./db";
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

  const reminders = await findRemindersByUser(c.env.DB, user);

  const rows = reminders.length === 0
    ? `<tr><td colspan="4" style="text-align:center;color:#666;padding:2rem">No active reminders</td></tr>`
    : reminders
        .map(
          (r) => `<tr>
            <td><a href="https://github.com/${r.repo_full_name}/issues/${r.issue_number}">${r.repo_full_name}#${r.issue_number}</a></td>
            <td>${escapeHtml(r.memo)}</td>
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
    <table>
      <thead>
        <tr>
          <th>Issue / PR</th>
          <th>Memo</th>
          <th>Created</th>
          <th>Updated</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
  </div>
</body>
</html>`;

  return c.html(html);
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
