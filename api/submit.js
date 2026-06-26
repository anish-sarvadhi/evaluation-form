/**
 * SDE-I Assessment intake (Vercel serverless relay → Notion)
 * ----------------------------------------------------------
 * The static form POSTs JSON here; this creates/updates a Notion row using a
 * server-side token. One paired row per (Engineer Email + Cycle): a self
 * submission and a reviewer submission for the same engineer+cycle land in the
 * SAME row (whoever submits second fills in the other half), so the DB's gap
 * formulas can compare them.
 *
 * Env (Vercel → Settings → Environment Variables):
 *   NOTION_TOKEN = <integration secret>
 *   NOTION_DB_ID = dea24b82d5484f2eae194be2ed8d4513
 */

const NOTION_VERSION = "2022-06-28";

export default async function handler(req, res) {
  if (req.method !== "POST")
    return res.status(405).json({ ok: false, error: "POST only" });

  let d = req.body;
  if (typeof d === "string") {
    try { d = JSON.parse(d); }
    catch { return res.status(400).json({ ok: false, error: "Invalid JSON" }); }
  }
  if (!d || !d.answers)
    return res.status(400).json({ ok: false, error: "Missing answers" });

  const role = d.role === "self" ? "self" : "reviewer";
  const email = String(d.engineerEmail || "").trim().toLowerCase();
  const cycle = String(d.cycle || "").trim();
  if (!email) return res.status(400).json({ ok: false, error: "Missing engineer email" });
  if (!cycle) return res.status(400).json({ ok: false, error: "Missing cycle" });

  const token = process.env.NOTION_TOKEN;
  const dbId = process.env.NOTION_DB_ID;
  const headers = {
    "Authorization": "Bearer " + token,
    "Notion-Version": NOTION_VERSION,
    "Content-Type": "application/json",
  };

  // ---- role-specific properties (the half being submitted now) ----
  const props = {};
  const when = d.submittedAt || new Date().toISOString();
  const answersText = String(d.answersText || "").slice(0, 2000);
  if (role === "self") {
    props["Self Review Date"] = { date: { start: when } };
    props["Self Answers"] = { rich_text: [{ text: { content: answersText } }] };
    for (let i = 1; i <= 20; i++) {
      const v = d.answers["Q" + i];
      if (typeof v === "number") props["SQ" + i] = { number: v };
    }
  } else {
    props["Reviewer"] = { rich_text: [{ text: { content: String(d.reviewer || "") } }] };
    props["Review Date"] = { date: { start: when } };
    props["Answers"] = { rich_text: [{ text: { content: answersText } }] };
    for (let i = 1; i <= 20; i++) {
      const v = d.answers["Q" + i];
      if (typeof v === "number") props["Q" + i] = { number: v };
    }
  }

  // ---- find existing row for this Engineer Email + Cycle ----
  const queryRes = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      filter: {
        and: [
          { property: "Engineer Email", email: { equals: email } },
          { property: "Cycle", select: { equals: cycle } },
        ],
      },
      page_size: 1,
    }),
  });
  const queryOut = await queryRes.json().catch(() => ({}));
  if (!queryRes.ok) return res.status(502).json({ ok: false, error: queryOut });

  const existing = queryOut.results && queryOut.results[0];

  // ---- update the matched row, or create a new one ----
  let pageRes;
  if (existing) {
    pageRes = await fetch(`https://api.notion.com/v1/pages/${existing.id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ properties: props }),
    });
  } else {
    props["Engineer Email"] = { email };
    props["Cycle"] = { select: { name: cycle } };
    props["Engineer Name"] = { title: [{ text: { content: String(d.engineer || email).slice(0, 2000) } }] };
    pageRes = await fetch("https://api.notion.com/v1/pages", {
      method: "POST",
      headers,
      body: JSON.stringify({ parent: { database_id: dbId }, properties: props }),
    });
  }

  const pageOut = await pageRes.json().catch(() => ({}));
  if (!pageRes.ok) return res.status(502).json({ ok: false, error: pageOut });
  return res.status(200).json({ ok: true, url: pageOut.url, updated: !!existing });
}
