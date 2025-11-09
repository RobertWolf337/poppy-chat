// api/poppy.js — one-file server for Poppy (no installs needed)
export default async function handler(req, res) {
  const allowOrigin = process.env.ALLOW_ORIGIN || "*";
  res.setHeader("Access-Control-Allow-Origin", allowOrigin);
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { q = "", history = [] } = req.body || {};
// ---- kit helpers (no DB needed) ----
let KIT = null;

async function loadKit(baseUrl = "") {
  if (KIT) return KIT;
  try {
    const url = `${baseUrl.replace(/\/$/, "")}/kit.json`;
    const resp = await fetch(url, { cache: "no-store" });
    if (resp.ok) KIT = await resp.json();
  } catch {}
  return KIT;
}

function looksLikeKitQuestion(q = "") {
  const s = q.toLowerCase();
  return (
    /what(?:'| i)?s.*(in|inside|included).*kit/.test(s) ||
    /kit contents/.test(s) ||
    /what.*do i get/.test(s) ||
    /what.*included/.test(s)
  );
}

    // 1) Safety check
    const modResp = await fetch("https://api.openai.com/v1/moderations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({ model: "omni-moderation-latest", input: q })
    });
    const mod = await modResp.json();
    if (mod?.results?.[0]?.flagged) {
      return res.json({ reply: "I can’t help with that, but I’m happy to answer questions about growing microgreens safely." });
    }

    // 2) Poppy’s rules
    const SYSTEM_PROMPT = (process.env.POPPY_SYSTEM_PROMPT || `
You are Poppy, the friendly guide for Mini Green Growers.
Speak in 2–4 short, warm sentences.
Help with: growing steps, kit contents, child supervision, allergens, shipping/returns.
Never ask for or store names, emails, ages, or addresses.
If asked for medical advice, say you can’t give medical advice and suggest asking a grown-up or professional.
If something seems unsafe or adult, gently refuse and suggest a safe alternative.
    `).trim();

    // 3) Ask OpenAI (Chat Completions)
    const chatResp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.3,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          ...history,
          { role: "user", content: q }
        ],
        max_tokens: 400
      })
    });

    if (!chatResp.ok) {
      const errText = await chatResp.text();
      return res.status(500).json({ reply: "Server error from AI service.", detail: errText });
    }

    const data = await chatResp.json();
    const reply = data?.choices?.[0]?.message?.content || "Sorry, I didn’t catch that.";
    return res.status(200).json({ reply });
  } catch (e) {
    return res.status(200).json({ reply: "Oops—something went wrong. Please try again." });
  }
}
