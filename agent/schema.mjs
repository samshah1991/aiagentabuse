import Ajv from 'ajv';
import { wordCount } from './util.mjs';

export const EVIDENCE_TYPES = ['peer_reviewed', 'benchmark', 'vendor_claim', 'practitioner'];
export const STATUSES = ['proposed', 'approved', 'rejected', 'needs_recheck'];
export const LABEL_VALUES = ['strong', 'good', 'moderate', 'limited', 'anecdotal'];
export const NULLABLE_FIELDS = ['publisher', 'published_date', 'code_or_data_public', 'independently_replicated', 'evaluated_product_owner_is_author', 'limitations'];
const DATE = '^\\d{4}(-\\d{2}(-\\d{2})?)?$';
const nb = { type: ['boolean', 'null'] };
const benchmark = { type: ['object', 'null'], additionalProperties: false, required: ['name'], properties: { name: { type: 'string', maxLength: 120 }, version: { type: ['string', 'null'], maxLength: 40 } } };

// What the extraction model may return. additionalProperties:false means a model-supplied
// score, weight_label, status, or id is rejected outright.
export const modelOutputSchema = {
  type: 'object', additionalProperties: false, required: ['source_url', 'claim', 'evidence_type', 'support_quote'],
  properties: {
    source_url: { type: 'string', pattern: '^https?://' },
    claim: { type: 'string', minLength: 10, maxLength: 300 },
    evidence_type: { enum: EVIDENCE_TYPES },
    publisher: { type: ['string', 'null'], maxLength: 120 },
    published_date: { type: ['string', 'null'], pattern: DATE },
    code_or_data_public: nb, independently_replicated: nb, evaluated_product_owner_is_author: nb,
    benchmark, limitations: { type: ['string', 'null'], maxLength: 300 },
    support_quote: { type: 'string', minLength: 20, maxLength: 200 },
    unverified: { type: 'array', items: { type: 'string' }, maxItems: 10 },
  },
};

export const recordSchema = {
  type: 'object', additionalProperties: false,
  required: ['id', 'category', 'claim', 'evidence_type', 'source', 'code_or_data_public', 'independently_replicated', 'evaluated_product_owner_is_author', 'limitations', 'score', 'weight_label', 'status'],
  properties: {
    id: { type: 'string', pattern: '^[a-z0-9-]+$' }, category: { type: 'string' },
    claim: { type: 'string', minLength: 10, maxLength: 300 }, evidence_type: { enum: EVIDENCE_TYPES },
    source: {
      type: 'object', additionalProperties: false, required: ['title', 'url', 'publisher', 'published_date', 'accessed_date', 'content_sha256'],
      properties: {
        title: { type: 'string' }, url: { type: 'string', pattern: '^https?://' }, publisher: { type: ['string', 'null'] },
        published_date: { type: ['string', 'null'], pattern: DATE }, accessed_date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
        content_sha256: { type: 'string', pattern: '^[0-9a-f]{64}$' },
      },
    },
    code_or_data_public: nb, independently_replicated: nb, evaluated_product_owner_is_author: nb,
    benchmark, limitations: { type: ['string', 'null'], maxLength: 300 },
    unverified: { type: 'array', items: { type: 'string' } },
    score: { type: 'integer', minimum: 1, maximum: 5 }, weight_label: { enum: LABEL_VALUES }, status: { enum: STATUSES },
  },
};
export const evidenceFileSchema = {
  type: 'object', additionalProperties: false, required: ['category', 'records'],
  properties: { category: { type: 'string' }, records: { type: 'array', items: recordSchema } },
};

const ajv = new Ajv({ allErrors: true, strict: false });
const compile = (s) => { const f = ajv.compile(s); return (v) => (f(v) ? [] : f.errors.map((e) => `${e.instancePath || '/'} ${e.message}`)); };
export const validateModelOutput = compile(modelOutputSchema);
export const validateRecord = compile(recordSchema);
export const validateEvidenceFile = compile(evidenceFileSchema);

// Content rules for stored text: claim is one paraphrased sentence, max 25 words, no quotation marks, no code.
export function textProblems({ claim, limitations }) {
  const p = [];
  if (wordCount(claim) > 25) p.push('claim exceeds 25 words');
  if (/["“”]/.test(claim)) p.push('claim contains quotation marks');
  for (const [k, v] of Object.entries({ claim, limitations })) {
    if (v && /`|<script|<\/|\bhttps?:\/\/\S*[?&]\S*=/i.test(v)) p.push(`${k} contains code, markup, or a parameterised URL`);
  }
  if (limitations && (limitations.match(/[.!?](\s|$)/g) ?? []).length > 1) p.push('limitations must be one sentence');
  return p;
}
