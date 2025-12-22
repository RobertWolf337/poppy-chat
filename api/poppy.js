// api/poppy.js — Mini Green Growers (full persona + kid-safe + Slack alerts + brand grounding)
// Expects POST body: { q: string, history?: Array<{role:'user'|'assistant', content:string}> }

import fs from "fs/promises";
import path from "path";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Optional: env override; falls back to your provided channel ID
const DEFAULT_SLACK_CHANNEL_ID = "C0A4WE56K19";

async function notifySlack({ title = "Poppy alert", text = "" }) {
  const token = process.env.SLACK_BOT_TOKEN;
  const channel = process.env.SLACK_CHANNEL_ID;
  if (!token || !channel) return;

  try {
    await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        channel,
        text: `*${title}*\n${text}`.slice(0, 2900),
        mrkdwn: true,
      }),
    });
  } catch {}
}


// ---------------------- FULL INSTRUCTOR PERSONA ----------------------
const SYSTEM = `
You are Poppy, a friendly microgreen character who chats with children on the Mini Green Growers website.

Personality and role:
- Soft, patient UK classroom-teacher vibe. Warm and steady. Loves gardening and nature.
- Help with microgreens, the Mini Green Growers kit, and simple, age-appropriate nature and food questions.
- Assume the user is a child unless they clearly say they are a parent or carer.

Style:
- UK English. Short, clear sentences. Natural and human.
- Do not use em dashes or en dashes. Use full stops, commas, or the word "and".
- Avoid AI-sounding filler like "let's dive in", "in this guide", "furthermore", "moreover", "overall", "in conclusion".
- Avoid overly formal words such as "perhaps". Avoid over-enthusiastic tones.
- Use gentle phrases: "That sounds like a good idea." "We can work it out together." "I am glad you told me."

Name handling:
- Do not ask for a name.
- If the user gives a name (e.g., "my name is sam"), use it sometimes, not in every sentence. Capitalise only the first letter if it was typed in lowercase.

Greetings:
- If the user only says "hi", "hello", or similar, reply with one short friendly line and one simple question. Do not add extra paragraphs.
- You may vary greetings. Use short sentences from the greetings list when available.

Teaching style:
- Explain in a few clear steps or short paragraphs.
- Ask gentle follow-up questions such as "What have you tried so far" "What do you notice about your plants" "Where are you keeping them, by a window or somewhere darker".
- Correct misunderstandings kindly.

Stay on topic:
- Main world: Mini Green Growers, microgreens, nature, gentle learning, creativity.
- Briefly answer safe off-topic questions, then guide back to growing and the kit.

Boundaries and safety:
- Never request or keep personal data. If personal details appear, remind the user to keep details private and steer back to the topic.
- No medical advice, diagnosis, dosing, cures or treatment plans. You may share general nutrition information about microgreens for education only.
- If the user mentions self-harm or severe distress, respond with a short, kind safety message and suggest talking to a trusted adult. If urgent, mention calling 999 in the UK and Childline 0800 1111.

Brand grounding (prefer these facts when relevant):
- Characters: Max, Harvey, Rosie.
- Use the current Kit contents and sections from the brand data provided.
- Use the Microgreens list and quick facts from brand data when helpful.

Tone polish:
- Keep replies friendly and brief. Vary wording so replies do not feel identical.
- Do not include off-site links unless they point to minigreengrowers.co.uk pages.
`.trim();

// ---------------------- Load local brand context (cached) ----------------------
let KIT = null;
let BOOK = null;

async function loadContext() {
  if (!KIT) {
    try {
      const p = path.join(process.cwd(), "data", "kit.json");
      KIT = JSON.parse(await fs.readFile(p, "utf8"));
    } catch {
      KIT = {
        name: "Mini Green Growers Kit",
        contents: [
          "2 × Natural reusable coconut shells",
          "10 × Natural coco coir (soil) portions",
          "3 × Reusable tins — with selected seeds",
          "10 × Wooden plant labels + 1 pencil",
          "1 × Misting bottle",
          "\"Save the Bees\" planting paper",
          "Adventure Book — how-to, growing journal & fun facts",
          "Mini Green Growers Quest + printable certificate"
        ]
      };
    }
  }
  if (!BOOK) {
    try {
      const p = path.join(process.cwd(), "data", "book.json");
      BOOK = JSON.parse(await fs.readFile(p, "utf8"));
    } catch {
      BOOK = {
        meta: { uk_english: true },
        characters: [{ name: "Max" }, { name: "Harvey" }, { name: "Rosie" }],
        sections: [],
        microgreens: [],
        templates: { greetings: ["Hello. Ready to grow together"] }
      };
    }
  }
}

// ---------------------- Helpers & fast paths ----------------------
function isKitQuery(q) {
  const s = q.toLowerCase();
  return (
    s.includes("what's in the kit") ||
    s.includes("whats in the kit") ||
    s.includes("what is in the kit") ||
    s.includes("kit contents") ||
    s.includes("what do i get") ||
    s.includes("what comes in the kit")
  );
}
function kitAnswer() {
  const list = (KIT?.contents || []).map((x) => `• ${x}`).join("\n");
  const mgList = Array.isArray(BOOK?.microgreens)
    ? BOOK.microgreens.map((m) => `- ${typeof m === "string" ? m : m.name}`).join("\n")
    : "";
  return [
    "Here is what is in your Mini Green Growers kit:",
    list,
    mgList ? "\nMicrogreens you can choose from:\n" + mgList : ""
  ].join("\n");
}
function randomGreeting() {
  const g = BOOK?.templates?.greetings;
  return Array.isArray(g) && g.length ? g[Math.floor(Math.random() * g.length)] : "Hello. Ready to grow together";
}

// ---------------------- Safety patterns ----------------------
const PII_PATTERNS = [
  // UK phones incl. mobiles
  /\b(\+?44\s?7\d{3}|\(?0\)?\s?\d{3,4})[\s\-]?\d{3}[\s\-]?\d{3,4}\b/i,
  // Email
  /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/i,
  // Postcodes
  /\b([A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2})\b/,
  // Street addresses heuristic
  /\b(\d{1,4}\s+\w+(?:\s\w+){0,4}\s(road|rd|street|st|lane|ln|avenue|ave|close|cl|court|ct|drive|dr|terrace|crescent|place|way|gardens))\b/i,
  // Social handles
  /(@[a-z0-9_]{2,})/i,
  // DOB like 12/09/2012 or 12-09-2012
  /\b(0?[1-9]|[12][0-9]|3[01])[\/\-](0?[1-9]|1[012])[\/\-](19|20)\d\d\b/,
  // "I am 9 years old", "I'm 10"
  /\b(i\s*am|i'm)\s*(\d{1,2})\s*(years?\s*old)?\b/i,
  // School / teacher mention (coarse)
  /\b(my\s+school|at\s+school|primary\s+school|teacher|headteacher|head\s*teacher)\b/i
];
const PROFANITY = /(fuck|shit|bitch|cunt|wanker|twat|dickhead|prick|slag|slut)/i;
const DANGERS = /(self\s*harm|suicide|kill\s*myself|end\s*my\s*life|hurt\s*myself)/i;
const MEDICAL = /(diagnose|treat|cure|dosage|dose|prescribe|side\s*effects|contraindication)/i;

// ---------------------- Link whitelist (keep replies on brand) ----------------------
const WHITELIST = ["minigreengrowers.co.uk"];
function stripUnsafeLinks(text) {
  return text.replace(/\bhttps?:\/\/[^\s)]+/gi, (url) =>
    WHITELIST.some((d) => url.includes(d)) ? url : "[link removed]"
  );
}

// ---------------------- Slack alerts (optional) ----------------------
async function notifySlack(title, userText) {
  try {
    const token = process.env.SLACK_BOT_TOKEN;
    const channel = process.env.SLACK_CHANNEL_ID || DEFAULT_SLACK_CHANNEL_ID;
    if (!token || !channel) return;

    const blocks = [
      { type: "header", text: { type: "plain_text", text: title } },
      {
        type: "section",
        text: { type: "mrkdwn", text: "*User message:*\n```" + String(userText || "").slice(0, 1500) + "```" }
      }
    ];

    await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ channel, text: title, blocks })
    });
  } catch {
    // stay silent; do not log user content
  }
}

// ---------------------- System prompt wrapper ----------------------
function buildSystemPrompt() {
  return SYSTEM;
}

// ---------------------- OpenAI call ----------------------
async function askOpenAI(messages) {
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.6,
      max_tokens: 600,
      messages
    })
  });
  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    throw new Error(`Upstream error ${resp.status}: ${t.slice(0, 600)}`);
  }
  const data = await resp.json();
  return data?.choices?.[0]?.message?.content?.trim() || "";
}

// ---------------------- Output polish to remove “AI dash” look ----------------------
function polish(text) {
  return stripUnsafeLinks(
    text.replace(/[—–]/g, " ").replace(/\s-\s/g, ". ").replace(/\s{2,}/g, " ").trim()
  );
}

// ---------------------- HTTP handler ----------------------
export default async function handler(req, res) {
  // CORS for WordPress frontend
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!OPENAI_API_KEY) return res.status(500).json({ error: "Server not configured" });

  try {
    await loadContext();

    const body = req.body || {};
    const q = (body.q || "").toString().trim();
    const history = Array.isArray(body.history) ? body.history : [];
    if (!q) return res.status(400).json({ error: "Missing q in request body" });

    // Optional: allow frontend to fetch a greeting to display on load
    if (q === "__greeting") return res.status(200).json({ reply: randomGreeting() });

    // ---------------- Safety screening BEFORE the model ----------------
    if (PII_PATTERNS.some((rx) => rx.test(q))) {
      notifySlack("⚠️ PII blocked in Poppy", q);
      return res.status(200).json({
        reply:
          "Let us keep personal details private. Please do not share phone numbers, emails, postcodes, addresses, schools, teacher names or social handles online. How can I help with your microgreens question instead?"
      });
    }
    if (PROFANITY.test(q)) {
      return res.status(200).json({
        reply: "Let us keep things kind. I can help with microgreens and your kit. What would you like to know?"
      });
    }
    if (DANGERS.test(q)) {
      notifySlack("🚨 Self-harm language detected", q);
      return res.status(200).json({
        reply:
          "I am sorry you feel like that. Please speak to a trusted adult now. If you are in danger call 999. You can also call Childline on 0800 1111."
      });
    }
    if (MEDICAL.test(q)) {
      notifySlack("ℹ️ Medical request refused", q);
      return res.status(200).json({
        reply:
          "I cannot give medical advice. I can share general nutrition information about microgreens and how families enjoy them."
      });
    }

    // Fast path for kit contents
    if (isKitQuery(q)) {
      return res.status(200).json({ reply: kitAnswer() });
    }

    // ---------------- Build messages with persona + light brand context ----------------
    const brandNotes = [
      `Kit contents:\n- ${(KIT?.contents || []).join("\n- ")}`,
      Array.isArray(BOOK?.microgreens) && BOOK.microgreens.length
        ? `Microgreens:\n- ${BOOK.microgreens.map((m) => (typeof m === "string" ? m : m.name)).join("\n- ")}`
        : "",
      Array.isArray(BOOK?.sections) && BOOK.sections.length
        ? "Topics: " + BOOK.sections.slice(0, 12).map((s) => s.title).join(" | ")
        : ""
    ]
      .filter(Boolean)
      .join("\n\n");

    const messages = [
      { role: "system", content: buildSystemPrompt() },
      brandNotes ? { role: "assistant", content: `Context notes for accuracy:\n${brandNotes}` } : null,
      ...history
        .map((m) => {
          if (!m || typeof m !== "object") return null;
          const role = m.role === "assistant" ? "assistant" : "user";
          const content = (m.content || "").toString().slice(0, 2000);
          return content ? { role, content } : null;
        })
        .filter(Boolean),
      { role: "user", content: q }
    ].filter(Boolean);

    let reply = await askOpenAI(messages);

    // Final polish and PII sweep in case the model echoes something
    reply = polish(reply);
    if (PII_PATTERNS.some((rx) => rx.test(reply))) {
      notifySlack("⚠️ Model reply contained PII (masked)", reply);
      reply =
        "Let us keep details private. I can help with growing tips, kit info and fun ideas for your microgreens.";
    }

    return res.status(200).json({ reply });
  } catch (err) {
    console.error("Poppy server error:", err);
    return res.status(500).json({ error: "Server error" });
  }
}
