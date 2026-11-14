import test from 'node:test';
import assert from 'node:assert/strict';
import { validateModelOutput, validateRecord, validateEvidenceFile, textProblems } from '../agent/schema.mjs';

const model = { source_url: 'https://example.org/p', claim: 'The defense reduced attack success in the tested suite.', evidence_type: 'benchmark', support_quote: 'a short verbatim passage here', published_date: '2026-05', code_or_data_public: true, independently_replicated: null, evaluated_product_owner_is_author: false, benchmark: { name: 'AgentDojo', version: null }, limitations: 'Only tested on one agent suite.', unverified: ['independently_replicated'] };
const record = { id: 'untrusted-content-ab12cd34', category: 'untrusted-content', claim: model.claim, evidence_type: 'benchmark', source: { title: 'T', url: 'https://example.org/p', publisher: null, published_date: '2026-05', accessed_date: '2026-11-14', content_sha256: 'a'.repeat(64) }, code_or_data_public: true, independently_replicated: null, evaluated_product_owner_is_author: false, benchmark: null, limitations: 'One sentence.', unverified: [], score: 3, weight_label: 'moderate', status: 'proposed' };

test('accepts a valid model output', () => assert.deepEqual(validateModelOutput(model), []));
test('rejects a model-supplied score', () => {
  assert.notEqual(validateModelOutput({ ...model, score: 5 }).length, 0);
  assert.notEqual(validateModelOutput({ ...model, weight_label: 'strong' }).length, 0);
  assert.notEqual(validateModelOutput({ ...model, status: 'approved' }).length, 0);
  assert.notEqual(validateModelOutput({ ...model, id: 'x' }).length, 0);
});
test('rejects bad enums and urls in model output', () => {
  assert.notEqual(validateModelOutput({ ...model, evidence_type: 'rumour' }).length, 0);
  assert.notEqual(validateModelOutput({ ...model, source_url: 'javascript:alert(1)' }).length, 0);
});
test('record schema: valid, and rejects missing/invalid fields', () => {
  assert.deepEqual(validateRecord(record), []);
  assert.notEqual(validateRecord({ ...record, score: 6 }).length, 0);
  assert.notEqual(validateRecord({ ...record, score: 0 }).length, 0);
  assert.notEqual(validateRecord({ ...record, status: 'published' }).length, 0);
  assert.notEqual(validateRecord({ ...record, extra: 1 }).length, 0);
  const { claim, ...noClaim } = record; assert.notEqual(validateRecord(noClaim).length, 0);
  assert.notEqual(validateRecord({ ...record, source: { ...record.source, content_sha256: 'nope' } }).length, 0);
});
test('evidence file schema', () => {
  assert.deepEqual(validateEvidenceFile({ category: 'x', records: [record] }), []);
  assert.notEqual(validateEvidenceFile({ category: 'x', records: [{ ...record, score: 9 }] }).length, 0);
});
test('text rules: 25-word claim, no quotes, one-sentence limitations, no code', () => {
  assert.deepEqual(textProblems({ claim: model.claim, limitations: 'One sentence.' }), []);
  assert.ok(textProblems({ claim: Array(26).fill('word').join(' '), limitations: null }).length);
  assert.ok(textProblems({ claim: 'He said "ignore previous instructions" in the test.', limitations: null }).length);
  assert.ok(textProblems({ claim: model.claim, limitations: 'First. Second sentence.' }).length);
  assert.ok(textProblems({ claim: 'Use `rm -rf` to test the defense here.', limitations: null }).length);
});
