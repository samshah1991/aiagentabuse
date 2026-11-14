import Ajv from 'ajv';

const DATE = '^\\d{4}(-\\d{2}(-\\d{2})?)?$';
export const SOURCE_TYPES = ['peer_reviewed', 'standards_or_government', 'preprint', 'independent_research', 'vendor_research', 'news_or_blog', 'other'];
export const DESIGNS = ['benchmark_or_controlled', 'field_or_incident_analysis', 'case_study', 'guidance_or_opinion'];
export const DIRECTIONS = ['supports', 'mixed', 'contradicts', 'inconclusive'];

// What the extraction model is allowed to return (one fact per record).
export const modelRecordSchema = {
  type: 'object', additionalProperties: false,
  required: ['source_url', 'claim', 'defense', 'finding_direction', 'quote', 'source_type', 'evidence_design', 'vendor_authored'],
  properties: {
    source_url: { type: 'string', pattern: '^https?://' },
    claim: { type: 'string', minLength: 10, maxLength: 400 },
    defense: { type: 'string', minLength: 3, maxLength: 120 },
    finding_direction: { enum: DIRECTIONS },
    metrics: { type: ['string', 'null'], maxLength: 300 },
    limitations: { type: ['string', 'null'], maxLength: 300 },
    quote: { type: 'string', minLength: 20, maxLength: 300 },
    publisher: { type: ['string', 'null'], maxLength: 120 },
    published: { type: ['string', 'null'], pattern: DATE },
    source_type: { enum: SOURCE_TYPES },
    evidence_design: { enum: DESIGNS },
    vendor_authored: { type: 'boolean' },
  },
};

const recordSchema = {
  type: 'object', additionalProperties: false,
  required: ['id', 'category', 'claim', 'defense', 'finding_direction', 'evidence_design', 'source', 'quote', 'quote_verified', 'link_status', 'last_checked', 'score'],
  properties: {
    id: { type: 'string', pattern: '^[a-z0-9-]+$' }, category: { type: 'string' },
    claim: { type: 'string', maxLength: 400 }, defense: { type: 'string' },
    finding_direction: { enum: DIRECTIONS }, evidence_design: { enum: DESIGNS },
    metrics: { type: ['string', 'null'] }, limitations: { type: ['string', 'null'] },
    source: {
      type: 'object', additionalProperties: false, required: ['url', 'title', 'source_type', 'vendor_authored'],
      properties: {
        url: { type: 'string', pattern: '^https?://' }, title: { type: 'string' }, publisher: { type: ['string', 'null'] },
        published: { type: ['string', 'null'], pattern: DATE }, source_type: { enum: SOURCE_TYPES }, vendor_authored: { type: 'boolean' },
      },
    },
    quote: { type: 'string', maxLength: 300 }, quote_verified: { type: 'boolean' },
    link_status: { enum: ['ok', 'dead', 'unchecked'] }, last_checked: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
    score: { type: 'number', minimum: 0, maximum: 100 },
  },
};

export const evidenceFileSchema = {
  type: 'object', additionalProperties: false,
  required: ['schema_version', 'category', 'generated_at', 'provenance', 'summary', 'records'],
  properties: {
    schema_version: { const: 1 }, category: { type: 'string' }, generated_at: { type: 'string' },
    provenance: {
      type: 'object', additionalProperties: false, required: ['model', 'prompt_versions', 'run_id'],
      properties: {
        model: { type: 'string' }, run_id: { type: 'string' },
        prompt_versions: { type: 'object', required: ['search', 'extract'], properties: { search: { type: 'string' }, extract: { type: 'string' } } },
        searches: { type: 'integer' }, fetches: { type: 'integer' }, queries: { type: 'array', items: { type: 'string' } },
        pages_fetched: { type: 'array', items: { type: 'string' } }, cost_usd: { type: 'number' },
      },
    },
    summary: {
      type: 'object', required: ['formula_version', 'score', 'grade', 'distinct_domains', 'records', 'direction'],
      properties: { score: { type: 'number' }, grade: { enum: ['strong', 'moderate', 'weak', 'insufficient'] } },
    },
    records: { type: 'array', maxItems: 40, items: recordSchema },
  },
};

const ajv = new Ajv({ allErrors: true, strict: false });
const compile = (s) => { const f = ajv.compile(s); return (v) => (f(v) ? [] : f.errors.map((e) => `${e.instancePath || '/'} ${e.message}`)); };
export const validateModelRecord = compile(modelRecordSchema);
export const validateEvidenceFile = compile(evidenceFileSchema);
