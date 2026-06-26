# Self vs Reviewer Assessment — Design Spec

**Date:** 2026-06-26
**Status:** Approved (design); pending implementation plan

## Context & Goal

Today the SDE-I assessment form is filled out **only by a reviewer**, scoring an engineer across 20 questions / 8 weighted sections, and each submission becomes one row in the Notion DB `📊 L1 SDE-I Evaluation (Points Engine)` (`dea24b82d5484f2eae194be2ed8d4513`, data source `f44f5690-29bf-45d4-acf5-a8a9013782db`).

We want the **same engineer to also self-assess**, then **compare self-reflection against the reviewer's observation** — automatically, in **one DB**, with a computed **gap** per section and overall. The questions must read in the **right voice**: third-person for the reviewer ("*this engineer*…") and first-person for the engineer ("*I*…").

## Decisions (confirmed)

| Decision | Choice |
|---|---|
| Comparison output | Paired record per engineer; show **both** self & reviewer scores side by side + a **neutral** `Score Difference` (absolute, no higher/lower framing) |
| Engineer identity / match key | **Engineer Email** (email-type field, validated in the form, normalized lowercase) |
| History | **Recurring cycles** — match key includes a **Cycle** label; past cycles preserved |
| Storage | **One DB, one paired row** per `Engineer Email + Cycle` (relay upsert) |
| Mode selection | **First-screen choice**: "Are you assessing yourself or someone on your team?" |
| Wording | Same 20 questions / scores; reviewer = third-person (existing), self = first-person (new) |
| Salary | `Proposed Salary (₹)` stays **reviewer-driven only** (self-scores never affect pay) |

## Architecture

Three pieces: the **form** (one page, two voices), the **Notion DB** (extended schema + formulas), and the **relay** (`api/submit.js`, gains upsert logic). Hosting stays Vercel + the existing integration token.

### 1. Form (`public/index.html`)

- **First screen (new):** a mode picker. Selecting a mode sets `role = "reviewer" | "self"` and reveals the rest of the form with the matching wording.
- **Two wording sets, one structure:** keep the existing `SECTIONS` array as `REVIEWER_SECTIONS` (third-person, unchanged). Add `SELF_SECTIONS` (first-person rewrite of all 20 questions + 100 options). **Both sets are 1:1 identical in section order, question order, option order, and scoring** (best option = 5 … worst = 1) so `SQ_i` and `Q_i` are directly comparable. Only the voice/grammar changes meaning-for-meaning. Option shuffling per question stays (scoring is by intrinsic option score, not position).
- **Meta fields by mode:**
  - **Common:** `Cycle` (dropdown, e.g. `Q1 2026`, `Q2 2026`, extendable), `Engineer ID` (text — email or employee ID).
  - **Reviewer mode:** also `Reviewer` (existing dropdown). Engineer ID is the person being reviewed; optional `Engineer Name` for display.
  - **Self mode:** `Engineer ID` is the submitter's own; `Engineer Name` (their name); no reviewer field.
- **Submit:** unchanged transport — POST JSON to `/api/submit`, show the existing thank-you screen with the "View in Notion" link returned by the relay.
- **Payload (`collect()`):** adds `role`, `engineerId`, `cycle`. Engineer ID normalized client-side (trim + lowercase) — relay normalizes again as source of truth.

### 2. Notion DB schema changes — ✅ DONE & VERIFIED (2026-06-26)

Applied via the Notion REST API using the integration token. Existing reviewer columns/formulas untouched; `Answers` kept as-is (reviewer-side, not renamed) to avoid disturbing existing views.

**Added key/identity columns**
- `Engineer Email` (email type) — match key part 1 (normalized lowercase by the relay).
- `Cycle` (select; seeded `Q1 2026`…`Q4 2026`, extendable) — match key part 2.

**Added self-score columns**
- `SQ1`–`SQ20` (number) — engineer self-scores (mirror of `Q1`–`Q20`).
- `Self Answers` (text) — self answers transcript.
- `Self Review Date` (date) — self submission date.

**Added formulas**
- `Self S1 (25%)`–`Self S8 (5%)` — self section scores (same averaging as reviewer `S1`–`S8`), for side-by-side display.
- `Self Final Score` — mirror of `Final Score`, **inlined from `SQ1`–`SQ20`**.
- `Score Difference` — `abs(SelfFinal − ReviewerFinal)`, **neutral** magnitude (both finals inlined). No directional/over-rating framing.
- `Status` — `Both` / `Self only` / `Reviewer only` / `Empty`, from whether `Q1` / `SQ1` are filled.

> **Formula-engine constraint discovered:** this DB rejects a formula that references *another formula property* via the API ("Type error with formula"). All composite formulas (`Self Final Score`, `Score Difference`) are therefore **inlined from the number columns**, exactly like the original `Final Score`. The `Self S*` section formulas are display-only (not referenced by other formulas).

> Verified with a test row (reviewer all-4s, self all-5s): Final 80, Self Final 100, Score Difference 20, Status Both, Proposed Salary 30000 (unaffected by self). Test row archived.

### 3. Relay upsert (`api/submit.js`)

Replace the single `pages.create` with **find-or-update**:

```
parse: role, engineerId (normalize: trim+lowercase), cycle, answers{Q1..Q20}, answersText,
       reviewer (reviewer mode only), engineerName
build role-specific properties:
   reviewer → Q1..Q20, Reviewer, Review Date, Reviewer Answers
   self     → SQ1..SQ20, Self Review Date, Self Answers
always set on create: Engineer ID, Cycle, Engineer Name (title)
query DB: POST /v1/databases/{id}/query  filter (Engineer ID == engineerId AND Cycle == cycle)
if a row matches → PATCH /v1/pages/{rowId} with this role's properties
else            → POST /v1/pages with key fields + this role's properties
return { ok:true, url }
```

- Uses the same Notion token/version already in place (`2022-06-28`).
- Title (`Engineer Name`) set on create; on update, leave as-is unless empty.

## Data flow

1. Engineer opens form → picks **Self** → enters ID + cycle, answers (first-person) → submit.
2. Relay finds no matching row → **creates** row with `Engineer ID`, `Cycle`, `Engineer Name`, `SQ1–SQ20`, self date/answers. `Status = Self only`.
3. Later, reviewer opens form → picks **Reviewer** → same engineer ID + cycle, answers (third-person) → submit.
4. Relay finds the existing row → **updates** it with `Q1–Q20`, `Reviewer`, `Review Date`, `Reviewer Answers`. `Status = Both`.
5. Gap formulas now show self-vs-reviewer deltas per section + overall, in that one row. (Order of submission doesn't matter — whoever is second completes the pair.)

## Edge cases & error handling

- **ID mismatch / typo:** different normalized `Engineer ID` (or different `Cycle`) → two separate rows instead of a pair. Mitigation: client + server normalization (trim/lowercase); `Cycle` is a fixed dropdown. Future option: switch `Engineer ID` to a dropdown of known engineers for zero-typo matching.
- **Duplicate submission, same role:** second submit overwrites that role's columns (latest wins). Acceptable; note in UI copy if needed.
- **Simultaneous self+reviewer submits (race):** both could miss the other's row and create two rows. Low likelihood given human timing; if observed, dedupe in Notion. Documented, not engineered around in v1 (YAGNI).
- **Relay/Notion failure:** existing behavior — relay returns `{ ok:false, error }`, form shows the error and re-enables submit.

## Out of scope (v1)

- Access control on the form (still public/unguessable, per earlier decision).
- Automated engineer dropdown (kept as ID/email entry for now).
- Trend dashboards across cycles (the data supports it; visualization is a later Notion-view task).

## Verification

1. **Schema:** confirm new columns + formulas via Notion MCP (`notion-fetch` on the data source) — `SQ1–SQ20`, `Engineer ID`, `Cycle`, `Self S1–S8`, `Self Final Score`, `Gap S1–S8`, `Gap Final`, `Status` all present and formula outputs non-error on a test row.
2. **Self-then-reviewer pairing (local, via dev server → `/api/submit`):**
   - POST a **self** payload (`role:self`, `engineerId:test@x.com`, `cycle:Q2 2026`) → one row created, `SQ*` filled, `Status = Self only`.
   - POST a **reviewer** payload with the **same** id+cycle → **same row updated**, `Q*` filled, `Status = Both`, `Gap *` computed.
   - Repeat in reverse order (reviewer first) → identical paired result.
   - Mismatched id → two rows (negative check).
3. **Browser:** run both modes through the UI locally; verify first-person vs third-person wording renders, and rows pair in Notion.
4. **Cleanup:** delete all test rows.

## Open items to resolve during planning

- Fetch and replicate the **exact existing formula expressions** (`S1–S8`, `Final Score`) for the self/gap formulas.
- Decide final `Cycle` option list and initial `Engineer ID` format (email vs employee ID) with the team.
- Confirm whether to rename `Answers` → `Reviewer Answers` (affects the existing view's column).
