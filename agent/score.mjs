// Deterministic scoring. NO model involvement: the model never outputs or influences a score.
// Rules (exact):
//   base: peer_reviewed 4, benchmark 3, vendor_claim 2, practitioner 1
//   +1 code_or_data_public, +1 independently_replicated,
//   -1 evaluated_product_owner_is_author, -1 published more than 24 months before the run date
//   clamp to 1..5. Labels: 5 strong, 4 good, 3 moderate, 2 limited, 1 anecdotal.
// Unverified (null) booleans earn no bonus and no penalty. A null published_date counts as "older than 24 months"
// because recency cannot be confirmed (owner decision to review).
export const BASE = { peer_reviewed: 4, benchmark: 3, vendor_claim: 2, practitioner: 1 };
export const LABELS = { 5: 'strong', 4: 'good', 3: 'moderate', 2: 'limited', 1: 'anecdotal' };

// Partial dates resolve to the END of the period, so a vague date is never penalised unfairly.
export function parsePublished(s) {
  if (!s) return null;
  const m = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/.exec(s);
  if (!m) return null;
  const [, y, mo, d] = m;
  if (d) return new Date(Date.UTC(+y, +mo - 1, +d));
  if (mo) return new Date(Date.UTC(+y, +mo, 0));
  return new Date(Date.UTC(+y, 11, 31));
}
export function monthsBefore(runDate, months) {
  const c = new Date(runDate.getTime());
  c.setUTCMonth(c.getUTCMonth() - months);
  return c;
}
export function olderThanMonths(published, runDate, months) {
  const p = parsePublished(published);
  return p === null ? true : p < monthsBefore(runDate, months);
}

export function computeScore(rec, runDate = new Date()) {
  if (!(rec.evidence_type in BASE)) throw new Error(`unknown evidence_type: ${rec.evidence_type}`);
  let s = BASE[rec.evidence_type];
  if (rec.code_or_data_public === true) s += 1;
  if (rec.independently_replicated === true) s += 1;
  if (rec.evaluated_product_owner_is_author === true) s -= 1;
  if (olderThanMonths(rec.source?.published_date, runDate, 24)) s -= 1;
  s = Math.min(5, Math.max(1, s));
  return { score: s, weight_label: LABELS[s] };
}
