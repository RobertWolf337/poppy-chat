// api/poppy.js — one-file server for Poppy (no installs needed)

// ---------- simple helpers available to the whole file ----------

// Load kit.json from your own domain (cached in memory per server instance)
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

// Detect “what’s in the kit?” style questions
function looksLikeKitQuestion(q = "") {
  const s = (q || "").toLowerCase();
  return (
    /what(?:'| i)?s.*(in|inside|included).*kit/.test(s) ||
    /kit contents/.test(s) ||
    /what.*do i get/.test(s) ||
    /what.*included/.test(s)
  );
}

// Pick one at random to keep replies feeling fresh (safe, tiny variations)
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

const STYLE_SEEDS = [
  "Use one friendly emoji at the end.",
  "Start with a warm interjection (e.g., “Great question!”), then answer simply.",
  "Include one kid-friendly tip phrased as a suggestion.",
  "End with a tiny safety reminder if relevant.",
  "Keep it very concise: two sentences max."
];

const ANSWER_SHAPES = [
  "Pattern A: 1) Direct answer. 2) Tiny tip. 3) (optional) Link: <URL>.",
  "Pattern B: 1) Short answer. 2) One sentence cameo from Max/Harvey/Rose.",
  "Pattern C: 1) Quick steps (1–3). 2) Safety note if helpful."
];

// ---------- main handler ----------

export default async function handler(req, res) {
  // CORS
  const allowOrigin = process.env.ALLOW_ORIGIN || "*";
  res.setHeader("Access-Control-Allow-Origin", allowOrigin);
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { q = "", history = [] } = req.body || {};

    // 0) Hard answer for kit contents (no model; avoids hallucinations)
    const host =
      process.env.PUBLIC_BASE_URL ||
      (req?.headers?.host ? `https://${req.headers.host}` : "");
    if (looksLikeKitQuestion(q)) {
      const kit = await loadKit(host);
      if (kit && kit.items) {
        const list = kit.items.map(i => `- ${i}`).join("\n");
        const reply = `${kit.title}\n${list}\n\nNotes: ${kit.notes}`;
        return res.status(200).json({ reply });
      }
    }

    // 1) Safety check (OpenAI moderation)
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

    // 2) Build Poppy’s rules
    const SYSTEM_PROMPT = (process.env.POPPY_SYSTEM_PROMPT || `
You are Poppy, the friendly guide for Mini Green Growers.
Write 2–4 short, warm sentences in UK English.
Help with: growing steps, kit contents, supervision, allergens, basic navigation.
Never collect personal data. No diagnosis or medical advice.

Nutrition mode:
- Share general nutrition facts only (e.g., "Vitamin C contributes to normal immune function").
- Use gentle wording: may support / contributes to / helps with normal …
- No disease claims, diagnosis, or treatment advice.
- Remind users to check allergies and ask a grown-up/health professional for personalised advice.

Language & style:
- Use UK English spelling (colour, organise, litre, programme) and °C, grams, millilitres.
`).trim();

    // Optional knowledge block (nutrition, kit bullets, etc.)
    const KNOWLEDGE = (process.env.POPPY_KNOWLEDGE || "").trim();

    // Optional sitemap: an array of { name, url }. If absent, Poppy should not add links.
    let sitemap = [];
    try {
      sitemap = JSON.parse(process.env.POPPY_SITEMAP || "[]");
    } catch {}
    const SITEMAP_TEXT = sitemap.length
      ? "Here are the only links you may share (use exact URLs):\n" +
        sitemap.map(i => `- ${i.name}: ${i.url}`).join("\n") +
        "\nIf nothing fits, do not include a link."
      : "No sitemap is configured. Do not include any 'Link:' line in answers.";

    // Light variety
    const seed = pick(STYLE_SEEDS);
    const shape = pick(ANSWER_SHAPES);

    // Final prompt sent as the system message
    const FULL_PROMPT = [
      SYSTEM_PROMPT,
      KNOWLEDGE ? "Reference notes:\n" + KNOWLEDGE : "",
      SITEMAP_TEXT,
      "Style seed: " + seed,
      "Use this answer shape: " + shape,
      "If you used a cameo in the previous turn, skip it this time."
    ].filter(Boolean).join("\n\n");

    // 3) Ask OpenAI (chat)
    const MODEL = process.env.POPPY_MODEL || "gpt-4o-mini";
    const temperature = Number(process.env.POPPY_TEMPERATURE ?? 0.5);
    const top_p = Number(process.env.POPPY_TOP_P ?? 0.9);
    const max_tokens = Number(process.env.POPPY_MAX_TOKENS ?? 400);

    const chatBody = {
      model: MODEL,
      temperature,
      top_p,
      max_tokens,
      messages: [
        { role: "system", content: FULL_PROMPT },
        ...(Array.isArray(history) ? history : []),
        { role: "user", content: q }
      ]
    };

    const chatResp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify(chatBody)
    });

    if (!chatResp.ok) {
      const errText = await chatResp.text();
      return res.status(500).json({ reply: "Server error from AI service." , detail: errText });
    }

    const data = await chatResp.json();
    const reply =
      data?.choices?.[0]?.message?.content?.trim() ||
      "Sorry, I didn’t catch that.";

    return res.status(200).json({ reply });

  } catch (e) {
    return res.status(500).json({ reply: "Something went wrong. Please try again." });
  }
}
