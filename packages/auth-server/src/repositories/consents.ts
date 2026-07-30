// Legacy consent-decision overlay. GoTrue grants are authoritative and all
// active grant/revoke operations go through the SupaCloud GoTrue facade.

import { eq } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { oauthConsentDecisions, userConsents } from '../db/schema.js';
import { getCurrentRequestId } from '../auth/request-context.js';

export interface OAuthConsentDecisionInput {
  authorizationId: string;
  userId: string;
  applicationId: string;
  requestedScopes: string[];
  decision: 'approved' | 'denied';
}

export async function recordOAuthConsentDecision(input: OAuthConsentDecisionInput) {
  await getDb().insert(oauthConsentDecisions).values({
    authorizationId: input.authorizationId,
    userId: input.userId,
    applicationId: input.applicationId,
    requestedScopes: input.requestedScopes,
    decision: input.decision,
    requestId: getCurrentRequestId() || null,
    details: { source: 'gotrue_oauth_consent' },
  }).onConflictDoNothing({ target: oauthConsentDecisions.authorizationId });
}

export async function listLegacyUserConsentDecisions(userId: string) {
  const db = getDb();
  return db.select().from(userConsents)
    .where(eq(userConsents.userId, userId))
    .orderBy(userConsents.grantedAt);
}

export async function listLegacyApplicationConsentDecisions(applicationId: string) {
  const db = getDb();
  return db.select().from(userConsents)
    .where(eq(userConsents.applicationId, applicationId))
    .orderBy(userConsents.grantedAt);
}
