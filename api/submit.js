/**
 * SDE-I Assessment → Notion relay (Vercel Serverless Function)
 * -----------------------------------------------------------
 * The static form cannot write to Notion directly (you must never expose a
 * Notion token in client code). This function is the tiny secure middle layer:
 * the form POSTs JSON to /api/submit, and this creates the Notion row using a
 * server-side token. Form and function share an origin on Vercel, so no CORS.
 *
 * Required environment variables (Vercel → Project → Settings → Env Vars):
 *   NOTION_TOKEN = <your Notion integration secret>   (ntn_… / secret_…)
 *   NOTION_DB_ID = dea24b82d5484f2eae194be2ed8d4513
 */

export default async function handler(req, res) {
  if (req.method !== "POST")
    return res.status(405).json({ ok: false, error: "POST only" });

  let d = req.body;
  if (typeof d === "string") {
    try { d = JSON.parse(d); }
    catch { return res.status(400).json({ ok: false, error: "Invalid JSON" }); }
  }

  if (!d || !d.engineer || !d.answers)
    return res.status(400).json({ ok: false, error: "Missing engineer or answers" });

  const properties = {
    "Engineer Name": { title: [{ text: { content: String(d.engineer).slice(0, 2000) } }] },
    "Reviewer":      { rich_text: [{ text: { content: String(d.reviewer || "") } }] },
    "Review Date":   { date: { start: d.submittedAt || new Date().toISOString() } },
    "Answers":       { rich_text: [{ text: { content: String(d.answersText || "").slice(0, 2000) } }] },
  };
  for (let i = 1; i <= 20; i++) {
    const v = d.answers["Q" + i];
    if (typeof v === "number") properties["Q" + i] = { number: v };
  }

  const notionRes = await fetch("https://api.notion.com/v1/pages", {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + process.env.NOTION_TOKEN,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      parent: { database_id: process.env.NOTION_DB_ID },
      properties,
    }),
  });

  const out = await notionRes.json().catch(() => ({}));
  if (!notionRes.ok) return res.status(502).json({ ok: false, error: out });
  return res.status(200).json({ ok: true, url: out.url });
}
