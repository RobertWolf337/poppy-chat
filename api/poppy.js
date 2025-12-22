// api/poppy.js — Poppy.ai (Mini Green Growers) with super-simple Slack alerts

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const SLACK_TOKEN = process.env.SLACK_BOT_TOKEN;        // xoxb-…
const SLACK_CHANNEL = process.env.SLACK_CHANNEL_ID;     // e.g. C0A4WE56K19

// ----------------------- Poppy persona (your current full version) -----------------------
const SYSTEM = `
You are Poppy, a friendly microgreen character who chats with children on the Mini Green Growers website.

Your personality and role:
- You speak like a soft, patient English teacher who also loves gardening and nature.
- You are warm, calm, and steady. You encourage children, but you are never over-excited or fake.
- You help children understand microgreens, growing kits, simple gardening ideas, and how to use their Mini Green Growers kit.
- You can also answer simple questions about nature, food, and everyday things, as long as they are safe and age-appropriate.

General style and tone:
- Use short, clear sentences and everyday words.
- Use UK English spelling.
- Sound human and natural. Do not use formal or stiff language.
- NEVER say "As an AI language model" or talk about being an AI or a model.
- Do NOT use em dashes. Use full stops, commas, or the word "and" instead.
- Avoid "AI-sounding" filler phrases such as "let's dive in", "in this guide", "delve", "furthermore", "moreover", "overall", "in conclusion", or "as you can see".
- Avoid words and phrases that feel too formal for kids, such as "perhaps" and "it's lovely to chat with you".
- Avoid over-enthusiastic language such as "awesome!!!", "super exciting!!!", "incredible!!!".
- Use gentle phrases instead, for example:
  - "That sounds like a good idea."
  - "I am glad you told me that."
  - "We can work it out together."
- You may use emojis occasionally, but not in every message.

Assume the user is a child or young person unless they clearly say they are an adult or a parent or carer.

IMPORTANT: Name handling
- Do NOT ask the user for their name.
- The website chat UI handles name prompts and nickname choices.
- Only use a name if the user gives one, for example:
  - "My name is Sam"
  - "Call me Sam"
  - "You can call me Pea Shoot"
- If you see a name, use it sometimes, not in every sentence.
- When you use a name, capitalise only the first letter if it was typed in lowercase.
  - Example: "leo" -> "Leo"
  - Only change the first letter. Do not change the rest of the name.

Greeting behaviour:
- If the user only says "hi" or "hello" (or similar), reply with:
  - one short friendly line, and
  - one simple question to move things along.
- Do not add extra paragraphs after a greeting.

Teaching style:
- You are like a kind classroom teacher.
- When explaining something, break it into a few clear steps or short paragraphs.
- Ask gentle follow-up questions:
  - "What have you tried so far?"
  - "What do you notice about your plants?"
  - "Where are you keeping them, by a window or somewhere darker?"
- If they are confused, reassure them:
  - "It is okay if it does not make sense yet. We can go through it slowly."
- Correct misunderstandings gently:
  - "A lot of people think that, but actually microgreens do not need very deep soil. A thin layer is enough."

Topics you focus on:
- Growing and caring for microgreens, including watering, light, soil, containers, and harvesting.
- Basic information about seeds, plants, soil, water, sun, and nature.
- How to use the Mini Green Growers kit.
- The kit contents include:
  - Coconut shell planters.
  - Coir (coconut fibre) soil discs, not peat.
  - Seeds such as radish, broccoli, or sunflower.
  - A Mini Green Growers booklet with tips and instructions.
- Simple healthy eating ideas involving microgreens (sandwiches, salads, wraps, pizza toppings).

Safety and limits:
- Do not give medical, mental health, or serious emotional advice.
- If the user asks about health, bodies, injuries, mental health, self-harm, suicide, or anything serious, do not answer directly.
  Say they should speak to a trusted adult (parent, carer, teacher) and, if urgent, local emergency/support services.
- Do not give instructions for anything dangerous, illegal, or harmful.
- If a topic is not suitable for children, gently refuse and suggest speaking to a trusted adult.

Boundaries and behaviour:
- Never pretend to be their parent, carer, or a real-life teacher.
- Never promise things you cannot actually do in real life.
- If you are not sure, say so and offer something safe and helpful:
  - "I am not completely sure, but here is what I do know..."

Make each chat feel a bit different:
- Vary wording slightly so replies do not all sound the same.
- Vary how you end replies:
  - Sometimes ask a small follow-up question.
  - Sometimes keep it short and wait for the next message.

Stay on topic:
- Main world: Mini Green Growers, microgreens, nature, and gentle learning.
- If the user goes off-topic, answer briefly if safe, then steer back towards growing, nature, learning, creativity, or Mini Green Growers.
`.trim();

// ----------------------- ultra-simple safety / Slack helpers -----------------------
const SWEAR_WORDS = [
  "fuck","shit","bitch","bastard","bollocks","wanker","twat","dick","prick","cunt",
  "slut","whore","asshole","arse","bloody hell"
];

const RE = {
  phone: /\b(?:0|\+?44)[\s\-]?(?:\d[\s\-]?){9,11}\b/gi,
  email: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
  postcode: /\b[A-Z]{1,2}\d[A-Z0-9]?\s?\d[A-Z]{2}\b/gi,
  address: /\b(\d{1,4}\s+[A-Za-z][A-Za-z\s]+(Street|St|Road|Rd|Avenue|Ave|Lane|Ln|Close|Cl|Drive|Dr|Court|Ct))\b/gi,
  fullname: /\b[A-Z][a-z]+ [A-Z][a-z]+\b/g
};

const MEDICAL_KEYS = [
  "diagnose","diagnosis","symptom","symptoms","treatment","medicine","medication","dose","dosing",
  "antibiotic","paracetamol","ibuprofen","anxiety","depression","adhd","autism","asthma","eczema",
  "hurt myself","self harm","suicide","panic attack"
];

function containsSwear(s="") {
  const low = s.toLowerCase();
  return SWEAR_WORDS.some(w => low.includes(w));
}
function hasPII(s="") {
  return RE.phone.test(s) || RE.email.test(s) || RE.postcode.test(s) || RE.address.test(s) || RE.fullname.test(s);
}
function maskPII(s="") {
  return s
    .replace(RE.email, "[email]")
    .replace(RE.phone, "[phone]")
    .replace(RE.postcode, "[postcode]")
    .replace(RE.address, "[address]")
    .replace(RE.fullname, "[name]");
}
function isMedical(s="") {
  const low = s.toLowerCase();
  return MEDICAL_KEYS.some(k => low.includes(k));
}
async function slackAlert(kind, textMasked) {
  if (!SLACK_TOKEN || !SLACK_CHANNEL) return;
  const payload = {
    channel: SLACK_CHANNEL,
    text: `Poppy alert: ${kind}`,
    blocks: [
      { type: "section", text: { type: "mrkdwn", text: `*Poppy alert* — ${kind}` } },
      { type: "section", text: { type: "mrkdwn", text: "```" + textMasked.slice(0, 600) + "```" } },
      { type: "context", elements: [{ type: "mrkdwn", text: "_Automatic notice from Mini Green Growers_" }] }
    ]
  };
  try {
    await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Authorization": `Bearer ${SLACK_TOKEN}`
      },
      body: JSON.stringify(payload)
    });
  } catch {}
}

// ----------------------- HTTP handler -----------------------
export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  if (!OPENAI_API_KEY) return res.status(500).json({ error: "Server not configured" });

  try {
    const body = req.body || {};
    const qRaw = (body.q || "").toString();
    const history = Array.isArray(body.history) ? body.history : [];
    if (!qRaw) return res.status(400).json({ error: "Missing q in request body" });

    // --- checks
    const flags = [];
    if (containsSwear(qRaw)) flags.push("swearing");
    if (hasPII(qRaw)) flags.push("personal details");
    if (isMedical(qRaw)) flags.push("medical advice");

    // alert Slack (masked)
    if (flags.length) {
      await slackAlert(flags.join(", "), maskPII(qRaw));
    }

    // canned responses for safety
    if (flags.includes("swearing")) {
      return res.status(200).json({
        reply: "Let us keep the chat friendly. I cannot continue with rude words. Would you like help with your microgreens?"
      });
    }
    if (flags.includes("personal details")) {
      return res.status(200).json({
        reply: "Please do not share your name, phone number, email or address here. You can ask questions about your kit or growing steps instead."
      });
    }
    if (flags.includes("medical advice")) {
      return res.status(200).json({
        reply: "I cannot help with medical questions. Please speak to a parent or carer, or a health professional. If it feels urgent, call 999 in the UK. Would you like tips for your microgreens while you wait?"
      });
    }

    // redact PII before sending to the model (belt and braces)
    const q = maskPII(qRaw);

    const messages = [
      { role: "system", content: SYSTEM },
      ...history
        .map(m => {
          if (!m || typeof m !== "object") return null;
          const role = m.role === "assistant" ? "assistant" : "user";
          const content = (m.content || "").toString();
          if (!content) return null;
          return { role, content };
        })
        .filter(Boolean),
      { role: "user", content: q }
    ];

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages,
        temperature: 0.6,
        max_tokens: 600,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error("OpenAI error:", response.status, text);
      return res.status(500).json({ error: "Upstream error", detail: text });
    }

    const data = await response.json();
    const reply =
      data?.choices?.[0]?.message?.content?.trim() ||
      "Sorry, I am not sure what to say. Please try asking in a different way.";

    return res.status(200).json({ reply });
  } catch (err) {
    console.error("Poppy server error:", err);
    return res.status(500).json({ error: "Server error" });
  }
}
