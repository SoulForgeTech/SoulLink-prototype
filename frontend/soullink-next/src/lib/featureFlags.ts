/**
 * Feature flags for gradual rollout.
 * Check user eligibility for beta features.
 */

// Users who can access the expression/animated character feature
const EXPRESSION_BETA_EMAILS = [
  's229178291@gmail.com',  // Bling
  'alphonse@soulforgetech.com',  // Alphonse
];

export function canAccessExpressions(email: string | undefined): boolean {
  if (!email) return false;
  return EXPRESSION_BETA_EMAILS.includes(email.toLowerCase());
}
