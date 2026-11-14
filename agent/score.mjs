// Deterministic evidence scoring. NO model involvement: same inputs always give the same score.
// The score measures how strong and well-corroborated the evidence is, NOT whether the defense works.
// Direction (supports / mixed / contradicts / inconclusive) is reported separately.
import { domainOf } from './util.mjs';

export const FORMULA_VERSION = '1';
export const SOURCE_TYPE = { peer_reviewed: 1.0, standards_or_government: 0.8, preprint: 0.7, independent_research: 0.6, vendor_research: 0.5, news_or_blog: 0.3, other: 0.2 };
export const EVIDENCE_DESIGN = { benchmark_or_controlled: 1.0, field_or_incident_analysis: 0.8, case_study: 0.5, guidance_or_opinion: 0.3 };
export const VENDOR_AUTHORED_FACTOR = 0.6; // conflict-of-interest discount
export const GRADES = [['strong', 60], ['moderate', 35], ['weak', 15]]; // below 15: insufficient

const parseDate = (s) => {
  if (!s) return null;
  const [y, m = '07', d = '01'] = s.split('-'); // partial dates are treated as mid-year/month
  const t = Date.parse(`${y}-${m}-${d}T00:00:00Z`);
  return Number.isNaN(t) ? null : t;
};
// 1.0 within 12 months, decaying linearly to 0.5 at 36 months; unknown date = 0.5.
export function recencyFactor(published, now = new Date()) {
  const t = parseDate(published);
  if (t === null) return 0.5;
  const months = (now.getTime() - t) / (30.44 * 86400000);
  if (months <= 12) return 1;
  if (months >= 36) return 0.5;
  return 1 - 0.5 * ((months - 12) / 24);
}

export function recordScore(r, now = new Date()) {
  if (r.link_status === 'dead' || !r.quote_verified) return 0;
  const s = r.source;
  const v = 100 * (SOURCE_TYPE[s.source_type] ?? 0.2) * (EVIDENCE_DESIGN[r.evidence_design] ?? 0.3) *
    recencyFactor(s.published, now) * (s.vendor_authored ? VENDOR_AUTHORED_FACTOR : 1);
  return Math.round(v * 10) / 10;
}

// Category score: best record per distinct domain; mean of the top 3 domains;
// scaled by corroboration = min(1, distinct scoring domains / 3). Fewer than 2 domains caps the grade at "weak".
export function categoryScore(records, now = new Date()) {
  const best = new Map();
  for (const r of records) {
    const sc = recordScore(r, now); const d = domainOf(r.source.url);
    if (sc > 0 && d && sc > (best.get(d) ?? 0)) best.set(d, sc);
  }
  const top = [...best.values()].sort((a, b) => b - a).slice(0, 3);
  const domains = best.size;
  const score = top.length ? Math.round((top.reduce((a, b) => a + b, 0) / top.length) * Math.min(1, domains / 3) * 10) / 10 : 0;
  let grade = (GRADES.find(([, min]) => score >= min) ?? ['insufficient'])[0];
  if (domains < 2 && (grade === 'strong' || grade === 'moderate')) grade = 'weak';
  const count = (k) => records.filter((r) => r.finding_direction === k).length;
  return {
    formula_version: FORMULA_VERSION, score, grade, distinct_domains: domains, records: records.length,
    direction: { supports: count('supports'), mixed: count('mixed'), contradicts: count('contradicts'), inconclusive: count('inconclusive') },
  };
}
