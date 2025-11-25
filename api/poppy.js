// api/poppy.js — zero-dependency server (uses fetch, no SDK)
// UK English, personas, kit.json / book.json grounding, kid-safe tone.

function baseUrlFrom(req) {
  const proto = (req.headers["x-forwarded-proto"] || "https").toString();
  const host = (req.headers.host || "").toString();
  const ref = (req.headers.referer || "").toString();
  try { if (ref) { const u = new URL(ref); return `${u.protocol}//${u.host}`; } } catch {}
  return host ? `${proto}://${host}` : "";
}

// ---- kit helpers ----
let KIT_CACHE = null;
async function loadKit(req){
  if (KIT_CACHE) return KIT_CACHE;
  const url = `${baseUrlFrom(req).replace(/\/$/, "")}/kit.json`;
  try { const r = await fetch(url, { cache: "no-store" }); if (r.ok) KIT_CACHE = await r.json(); } catch {}
  return KIT_CACHE;
}
function looksLikeKitQ(q=""){
  const s=(q||"").toLowerCase();
  return /what(?:'| i)?s.*(in|inside|included).*kit/.test(s)
      || /kit contents/.test(s)
      || /what.*do i get/.test(s)
      || /what.*included/.test(s);
}

// ---- book helpers ----
let BOOK_CACHE = null;
async function loadBook(req){
  if (BOOK_CACHE) return BOOK_CACHE;
  const url = `${baseUrlFrom(req).replace(/\/$/, "")}/book.json`;
  try { const r = await fetch(url, { cache: "no-store" }); if (r.ok) BOOK_CACHE = await r.json(); } catch {}
  return BOOK_CACHE;
}
function findBookSnippets(book,q=""){
  if (!book || !Array.isArray(book.sections)) return [];
  const toks=(q||"").toLowerCase().split(/\W+/).filter(Boolean);
  if (!toks.length) return [];
  const out=[];
  for (const sec of book.sections){
    const hay = `${sec.title||""} ${sec.text||""}`.toLowerCase();
    let hits=0; for (const t of toks) if (hay.includes(t)) hits++;
    if (hits>=Math.min(2,toks.length)) { out.push((sec.text||"").slice(0,400)); if (out.length>=3) break; }
  }
  return out;
}

export default async function handler(req,res){
  // CORS
  const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || "*";
  res.setHeader("Access-Control-Allow-Origin", ALLOW_ORIGIN);
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try{
    const { q = "", history = [], character = "" } = req.body || {};

    // Safety/moderation (best-effort)
    try{
      const m = await fetch("https://api.openai.com/v1/moderations",{
        method:"POST",
        headers:{ "Content-Type":"application/json", "Authorization":`Bearer ${process.env.OPENAI_API_KEY}` },
        body: JSON.stringify({ model:"omni-moderation-latest", input:q })
      }).then(r=>r.json());
      if (m?.results?.[0]?.flagged){
        return res.json({ reply:"I can’t help with that, but I’m happy to answer questions about growing microgreens safely." });
      }
    }catch{}

    // Personas (UK tone)
    const PERSONAS = {
      max:    "Speak as Max: energetic, adventurous, hands-on. Keep it upbeat, short, and encouraging. Use UK English.",
      harvey: "Speak as Harvey: thoughtful, fact-loving, calm. Share concise facts and clear steps. Use UK English.",
      aurora: "Speak as Aurora: kind, curious, imaginative. Gentle guidance, sensory words, warm tone. Use UK English."
    };

    let SYSTEM = `
You are Poppy, the friendly guide for Mini Green Growers.
Use UK English. Keep replies short (2–4 sentences), warm, and child-safe.
Avoid medical advice; share only neutral nutrition facts (e.g., “vitamin C contributes to normal immune function”).
Don’t collect personal data. Only include links explicitly provided by us.
Prefer concise bullet points only if the user asks for steps or a list.
`.trim();

    if (character && PERSONAS[character]) {
      SYSTEM += `

When replying, adopt this style:
${PERSONAS[character]}
`.trim();
    }

    // Shortcut: kit
    if (looksLikeKitQ(q)){
      const kit = await loadKit(req);
      if (kit && Array.isArray(kit.items)){
        const lines = kit.items.map(it => `• ${it}`);
        const extra = kit.note ? `\n\n${kit.note}` : "";
        return res.json({ reply: `Here’s what’s in the kit:\n${lines.join("\n")}${extra}` });
      }
    }

    // Book snippets (light retrieval)
    const book = await loadBook(req);
    const bits = findBookSnippets(book, q);
    const BOOK_CTX = bits.length
      ? `\n\nHelpful notes from our booklet:\n- ${bits.join("\n- ")}\n\nUse these only if helpful; keep the answer short.`
      : "";

    const messages = [{ role:"system", content: SYSTEM + BOOK_CTX }];
    for (const m of Array.isArray(history)?history:[]) { if (m?.role && m?.content) messages.push(m); }
    messages.push({ role:"user", content:q });

    // Chat with fetch (no SDK)
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method:"POST",
      headers:{
        "Content-Type":"application/json",
        "Authorization":`Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model:"gpt-4o-mini",
        temperature:0.4,
        max_tokens:400,
        messages
      })
    });

    if (!resp.ok){
      const text = await resp.text();
      console.error("OpenAI error:", resp.status, text);
      return res.status(500).json({ error:"Upstream error", detail:text });
    }

    const data = await resp.json();
    const reply = data?.choices?.[0]?.message?.content?.trim() || "Sorry, I didn’t catch that.";
    return res.status(200).json({ reply });

  }catch(err){
    console.error("Poppy server error:", err);
    return res.status(500).json({ error:"Server error" });
  }
}
