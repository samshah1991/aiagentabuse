import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { load, CORE_SCHEMA } from 'js-yaml';

export const readYaml = (p) => load(readFileSync(p, 'utf8'), { schema: CORE_SCHEMA });
export const today = (now = new Date()) => now.toISOString().slice(0, 10);
export const domainOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch { return null; } };
export const normUrl = (u) => { try { const x = new URL(u); x.hash = ''; return x.href.replace(/\/$/, ''); } catch { return String(u); } };
export const normText = (s) => String(s).toLowerCase().replace(/[‘’“”]/g, "'").replace(/[^a-z0-9]+/g, ' ').trim();
export const shortHash = (s) => createHash('sha1').update(s).digest('hex').slice(0, 8);
export const quoteInText = (quote, text) => { const q = normText(quote); return q.length >= 20 && normText(text).includes(q); };
