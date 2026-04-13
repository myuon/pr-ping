import { Hono } from "hono";
import type { Env } from "./types";
import { handleIssueComment } from "./handlers/comment";
import { handleIssueClosed } from "./handlers/issue";
import { handlePullRequestClosed } from "./handlers/pull-request";

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

  const rawBody = await c.req.text();
  const isValid = await verifySignature(
    c.env.GITHUB_WEBHOOK_SECRET,
    rawBody,
    signature
  );
  if (!isValid) {
    return c.json({ error: "Invalid signature" }, 401);
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
  } catch (error) {
    console.error("Error handling webhook:", error);
    return c.json({ error: "Internal server error" }, 500);
  }

  return c.json({ ok: true });
});

app.get("/", (c) => {
  return c.text("PRPing is running");
});

export default app;
