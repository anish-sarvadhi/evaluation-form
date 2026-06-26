/**
 * Reviewer password check (Vercel serverless).
 * The form calls this before revealing the reviewer questions. The real
 * password lives only in the REVIEWER_PASSWORD env var (never in page source).
 * Enforcement is also repeated in api/submit.js so reviewer rows can't be
 * written without it even if the UI is bypassed.
 */
export default async function handler(req, res) {
  if (req.method !== "POST")
    return res.status(405).json({ ok: false, error: "POST only" });

  let d = req.body;
  if (typeof d === "string") {
    try { d = JSON.parse(d); }
    catch { return res.status(400).json({ ok: false, error: "Invalid JSON" }); }
  }

  const expected = process.env.REVIEWER_PASSWORD || "";
  const given = String((d && d.password) || "");
  if (expected && given === expected) return res.status(200).json({ ok: true });
  return res.status(401).json({ ok: false, error: "Invalid password" });
}
