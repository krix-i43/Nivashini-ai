import { MongoClient } from "mongodb";

let cachedClient = null;

async function connectDB() {
  if (cachedClient) return cachedClient;
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  cachedClient = client;
  return client;
}

async function callGemini(prompt) {
  const res = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=" +
      process.env.GEMINI_API_KEY,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }]
      })
    }
  );
  const data = await res.json();
  return data.candidates[0].content.parts[0].text;
}

export default async function handler(req, res) {
  try {
    const { ff_id, q } = req.query;
    if (!ff_id || !q) {
      return res.status(400).json({ error: "ff_id and q required" });
    }

    const client = await connectDB();
    const col = client.db("ffai").collection("players");

    const doc = await col.findOne({ ff_id });
    const oldMemory = doc?.memory || {};

    // 🔹 AI reply (75% Tamil 25% English)
    const reply = await callGemini(`
You are a Free Fire assistant.

LANGUAGE RULE:
Reply mostly in Tamil written using English letters (Tanglish).
About 75% Tamil and 25% English.
Use casual gamer tone.
Do not use Tamil script.

Known player info:
${JSON.stringify(oldMemory)}

User question:
${q}
`);

    // 🔹 Memory extract
    let newMemory = {};
    try {
      newMemory = JSON.parse(
        await callGemini(`
Extract ONLY permanent player information.
Return JSON only. If nothing, return {}.

Text:
${reply}
`)
      );
    } catch {}

    await col.updateOne(
      { ff_id },
      {
        $set: {
          ff_id,
          memory: { ...oldMemory, ...newMemory },
          updatedAt: new Date()
        }
      },
      { upsert: true }
    );

    res.status(200).json({
      ff_id,
      reply,
      saved_memory: newMemory
    });

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}