// /api/handoff-open.js
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const {
    SUPABASE_URL,
    SUPABASE_SERVICE_KEY,
    SUPABASE_SERVICE_ROLE_KEY,
    SLACK_BOT_TOKEN,
    SLACK_ALERTS_CHANNEL,
  } = process.env;

  const SERVICE_KEY = SUPABASE_SERVICE_KEY || SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY) return res.status(500).json({ error: "Supabase not configured" });
  if (!SLACK_BOT_TOKEN || !SLACK_ALERTS_CHANNEL) return res.status(500).json({ error: "Slack not configured" });

  try {
    const { conversationId, summary = "A visitor asked to speak to a grown-up." } = req.body || {};
    if (!conversationId) return res.status(400).json({ error: "Missing conversationId" });

    // 1) ensure conversation exists
    const { createClient } = await import("@supabase/supabase-js");
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    await supabase.from("conversations").upsert({ id: conversationId }).select();

    // 2) post to Slack (parent message becomes the thread)
    const text = `Poppy handoff :seedling:\n*Conversation:* ${conversationId}\n${summary}`;
    const slackResp = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        channel: SLACK_ALERTS_CHANNEL,       // e.g. C0A4WE56K19
        text,
      }),
    });
    const slackData = await slackResp.json();
    if (!slackData.ok) {
      console.error("Slack error:", slackData);
      return res.status(502).json({ error: "Failed to post to Slack", detail: slackData });
    }

    // 3) store the thread mapping
    await supabase.from("handoffs").upsert({
      conversation_id: conversationId,
      slack_channel: slackData.channel,
      slack_thread_ts: slackData.ts,
    });

    return res.status(200).json({
      ok: true,
      conversationId,
      slack: { channel: slackData.channel, thread_ts: slackData.ts },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
}

