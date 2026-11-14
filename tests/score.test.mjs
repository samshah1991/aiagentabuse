import test from 'node:test';
import assert from 'node:assert/strict';
import { computeScore, BASE, LABELS, olderThanMonths } from '../agent/score.mjs';

const RUN = new Date('2026-11-14T00:00:00Z');
const mk = (o = {}) => ({ evidence_type: 'benchmark', code_or_data_public: false, independently_replicated: false, evaluated_product_owner_is_author: false, source: { published_date: '2026-06-01' }, ...o });

test('base scores by evidence_type', () => {
  for (const [type, base] of Object.entries({ peer_reviewed: 4, benchmark: 3, vendor_claim: 2, practitioner: 1 })) {
    assert.equal(computeScore(mk({ evidence_type: type }), RUN).score, base);
    assert.equal(BASE[type], base);
  }
});
test('+1 code_or_data_public', () => assert.equal(computeScore(mk({ code_or_data_public: true }), RUN).score, 4));
test('+1 independently_replicated', () => assert.equal(computeScore(mk({ independently_replicated: true }), RUN).score, 4));
test('-1 evaluated_product_owner_is_author', () => assert.equal(computeScore(mk({ evaluated_product_owner_is_author: true }), RUN).score, 2));
test('-1 when older than 24 months, boundary exact', () => {
  assert.equal(computeScore(mk({ source: { published_date: '2024-01-01' } }), RUN).score, 2);
  assert.equal(computeScore(mk({ source: { published_date: '2024-11-14' } }), RUN).score, 3); // exactly 24 months: not older
  assert.equal(computeScore(mk({ source: { published_date: '2024-11-13' } }), RUN).score, 2);
});
test('partial dates resolve to end of period', () => {
  assert.equal(olderThanMonths('2023', RUN, 24), true);
  assert.equal(olderThanMonths('2024', RUN, 24), false); // resolves to 2024-12-31, inside 24 months
  assert.equal(olderThanMonths('2025', RUN, 24), false);
  assert.equal(olderThanMonths('2024-12', RUN, 24), false);
});
test('unverified (null) booleans give no bonus and no penalty; null date counts as old', () => {
  const r = computeScore(mk({ code_or_data_public: null, independently_replicated: null, evaluated_product_owner_is_author: null }), RUN);
  assert.equal(r.score, 3);
  assert.equal(computeScore(mk({ source: { published_date: null } }), RUN).score, 2);
});
test('clamps to 1..5', () => {
  assert.equal(computeScore(mk({ evidence_type: 'peer_reviewed', code_or_data_public: true, independently_replicated: true }), RUN).score, 5); // would be 6
  assert.equal(computeScore(mk({ evidence_type: 'practitioner', evaluated_product_owner_is_author: true, source: { published_date: '2020-01-01' } }), RUN).score, 1); // would be -1
});
test('labels 5..1', () => {
  assert.deepEqual(LABELS, { 5: 'strong', 4: 'good', 3: 'moderate', 2: 'limited', 1: 'anecdotal' });
  const label = (type, extra = {}) => computeScore(mk({ evidence_type: type, ...extra }), RUN).weight_label;
  assert.equal(label('peer_reviewed', { code_or_data_public: true }), 'strong');
  assert.equal(label('peer_reviewed'), 'good');
  assert.equal(label('benchmark'), 'moderate');
  assert.equal(label('vendor_claim'), 'limited');
  assert.equal(label('practitioner'), 'anecdotal');
});
test('deterministic and rejects unknown type', () => {
  assert.deepEqual(computeScore(mk(), RUN), computeScore(mk(), RUN));
  assert.throws(() => computeScore(mk({ evidence_type: 'rumour' }), RUN));
});
