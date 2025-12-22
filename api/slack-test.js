export default async function handler(req, res) {
  try {
    const token = process.env.SLACK_BOT_TOKEN;
    const channel = process.env.SLACK_CHANNEL_ID;
    if (!token || !channel) {
      return res.status(500).json({ ok: false, error: "Missing env vars" });
    }

    const r = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        channel,
        text: "Poppy Slack test 🌱 — if you see this in #poppy-alerts, we're connected.",
      }),
    });
    const data = await r.json();
    res.status(200).json(data);
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || "unknown" });
  }
}
