import { loadIncidents } from '../lib/site';

export function GET({ site }: { site: URL }) {
  const paths = ['/', '/incidents/', '/defenses/', '/taxonomy/', '/method/', '/submit/', '/about/',
    '/privacy/', '/license/', '/disclaimer/', ...loadIncidents().map((i: any) => `/incidents/${i.id}/`)];
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${paths
    .map((p) => `  <url><loc>${new URL(p, site).href}</loc></url>`).join('\n')}\n</urlset>\n`;
  return new Response(body, { headers: { 'Content-Type': 'application/xml' } });
}
