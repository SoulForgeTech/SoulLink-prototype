/**
 * Feature flags for gradual rollout.
 * Check user eligibility for beta features.
 */

export function canAccessExpressions(email: string | undefined): boolean {
  // Live Portrait is now available to all logged-in users
  return !!email;
}
