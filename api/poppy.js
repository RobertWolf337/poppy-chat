// api/poppy.js — Poppy.ai server (Vercel + OpenAI)
// - Uses kit.json + book.json (simple helpers)
// - Persona support: max / harvey / aurora (plus default Poppy)
// - UK English, kid-safe tone, short answers
// - Returns JSON: { reply }

import OpenAI from "openai";

// ---------- tiny utils ----------
function baseUrlFrom(req) {
  // Prefer the site where the widget lives (referer); fallback to this Vercel host
  const proto = (req.headers["x-forwarded-proto"] || "https").toString();
  const host = (req.headers.host || "").toString();
  const ref = (req.headers.referer || "").toString();
  try {
    if (ref) {
      const u = new URL(ref);
      return `${u.protocol}//${u.host}`;
    }
  } catch {}
  return host ? `${proto}://${host}` : "";
}

// ---------- KIT: load kit.json and detect “what’s in the kit?” ----------
let KIT_CACHE = null;

async function loadKit(req) {
  if (KIT_CACHE) return KIT_CACHE;
  const url = `${baseUrlFrom(req).replace(/\/$/, "")}/kit.json`;
  try {
    const resp = await fetch(url, { cache: "no-store" });
    if (resp.ok) KIT_CACHE = await resp.json();
  } catch {}
  return KIT_CACHE;
}

function looksLikeKitQuestion(q = "") {
  const s = (q || "").toLowerCase();
  return (
    /what(?:'| i)?s.*(in|inside|included).*kit/.test(s) ||
    /kit contents/.test(s) ||
    /what.*do i get/.test(s) ||
    /what.*included/.test(s)
  );
}

// ---------- BOOK: load book.json + tiny keyword search ----------
let BOOK_CACHE = null;

async function loadBook(req) {
  if (BOOK_CACHE) return BOOK_CACHE;
  const url = `${baseUrlFrom(req).replace(/\/$/, "")}/book.json`;
  try {
    const resp = await fetch(url, { cache: "no-store" });
    if (resp.ok) BOOK_CACHE = await resp.json();
  } catch {}
  return BOOK_CACHE;
}

function findBookSnippets(book, q = "") {
  if (!book || !Array.isArray(book.sections)) return [];
  const tokens = (q || "")
    .toLowerCase()
    .split(/\W+/)
    .filter(Boolean);
  if (!tokens.length) return [];

  // very light match: keep passages that contain at least 2 tokens
  const out = [];
  for (const sec of book.sections) {
    const hay = `${sec.title || ""} ${sec.text || ""}`.toLowerCase();
    let hits = 0;
    for (const t of tokens) if (hay.includes(t)) hits++;
    if (hits >= Math.min(2, tokens.length)) {
      out.push((sec.text || "").slice(0, 400));
      if (out.length >= 3) break;
    }
  }
  return out;
}

// ---------- handler ----------
export default async function handler(req, res) {
  // CORS
  const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || "*";
  res.setHeader("Access-Control-Allow-Origin", ALLOW_ORIGIN);
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // ---- request body
    const { q = "", history = [], character = "" } = req.body || {};

    // ---- super quick safety check (OpenAI moderation)
    // (Optional; if you don’t want this, you can remove this block)
    try {
      const mod = await fetch("https://api.openai.com/v1/moderations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({ model: "omni-moderation-latest", input: q }),
      }).then((r) => r.json());
      if (mod?.results?.[0]?.flagged) {
        return res.json({
          reply:
            "I can’t help with that, but I’m happy to answer questions about growing microgreens safely.",
        });
      }
    } catch {
      // ignore moderation errors; continue
    }

    // ---- persona styles (UK English)
    const PERSONAS = {
      max: "Speak as Max: energetic, adventurous, hands-on. Keep it upbeat, short, and encouraging. Use UK English.",
      harvey:
        "Speak as Harvey: thoughtful, fact-loving, calm. Share concise facts and clear steps. Use UK English.",
      aurora:
        "Speak as Aurora: kind, curious, imaginative. Gentle guidance, sensory words, warm tone. Use UK English.",
      // default (Poppy) applied in base prompt
    };

    // ---- base system prompt
    let SYSTEM_PROMPT = `
You are Poppy, the friendly guide for Mini Green Growers.
Use UK English. Keep replies short (2–4 sentences), warm, and child-safe.
Avoid medical advice; you may share neutral nutrition facts (e.g., “vitamin C contributes to normal immune function”).
Don’t collect personal data. Only include links explicitly provided by us.
Prefer concise bullet points only when the user asks for steps or a list.
`.trim();

    if (character && PERSONAS[character]) {
      SYSTEM_PROMPT += `

When replying, adopt this style:
${PERSONAS[character]}
`.trim();
    }

    // ---- Shortcut: kit answers from JSON
    if (looksLikeKitQuestion(q)) {
      const kit = await loadKit(req);
      if (kit && kit.items && Array.isArray(kit.items)) {
        const lines = kit.items.map((it) => `• ${it}`);
        const extra = kit.note ? `\n\n${kit.note}` : "";
        return res.json({
          reply: `Here’s what’s in the kit:\n${lines.join("\n")}${extra}`,
        });
      }
    }

    // ---- Book snippets (very light grounding)
    const book = await loadBook(req);
    const bookBits = findBookSnippets(book, q);
    const BOOK_CONTEXT = bookBits.length
      ? `\n\nHelpful notes from our booklet:\n- ${bookBits.join(
          "\n- "
        )}\n\nUse these notes only if they help; keep the answer short.`
      : "";

    // ---- build messages
    const messages = [{ role: "system", content: SYSTEM_PROMPT + BOOK_CONTEXT }];
    for (const m of Array.isArray(history) ? history : []) {
      if (m && m.role && m.content) messages.push(m);
    }
    messages.push({ role: "user", content: q });

    // ---- OpenAI call
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.4,
      max_tokens: 400,
      messages,
    });

    const reply =
      completion.choices?.[0]?.message?.content?.trim() ||
      "Sorry, I didn’t catch that.";

    return res.status(200).json({ reply });
  } catch (err) {
    console.error("Poppy server error:", err);
    return res.status(500).json({ error: "Server error" });
  }
}
