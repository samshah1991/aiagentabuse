// @ts-ignore - plain JS module shared with the validator
export * from '../../scripts/lib/data.mjs';

export const SITE = {
  name: 'AIagentAbuse',
  promise: 'A sourced record of AI agents gone wrong, and how to stop it happening to you.',
  repo: 'https://github.com/OWNER/REPO', // TODO: set to the real GitHub repository URL
};
export const issueFormUrl = `${SITE.repo}/issues/new?template=incident.yml`;
export const fmtDate = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
