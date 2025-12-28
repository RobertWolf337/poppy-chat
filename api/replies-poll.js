// /api/replies-poll.js
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
  } = process.env;

  const SERVICE_KEY = SUPABASE_SERVICE_KEY || SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY) return res.status(500).json({ error: "Supabase not configured" });

  try {
    const { conversationId } = req.body || {};
    if (!conversationId) return res.status(400).json({ error: "Missing conversationId" });

    const { createClient } = await import("@supabase/supabase-js");
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    const { data, error } = await supabase
      .from("replies")
      .select("*")
      .eq("conversation_id", conversationId)
      .eq("delivered", false)
      .order("created_at", { ascending: true });

    if (error) throw error;

    // mark delivered
    if (data?.length) {
      const ids = data.map(r => r.id);
      await supabase.from("replies").update({ delivered: true }).in("id", ids);
    }

    return res.status(200).json({ ok: true, replies: data || [] });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
}

