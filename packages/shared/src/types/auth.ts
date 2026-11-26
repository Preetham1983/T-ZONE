import { z } from 'zod';

export type AuthState = 'NOT_LOGGED_IN' | 'TOKEN_EXPIRED' | 'LOGGED_IN';

export interface TokenClaimsSummary {
  upn: string;
  objectId: string;
  tenantId: string;
  issuedAt: string;
  expiresAt: string;
  expiresInMinutes: number;
  deviceId: string | null;
  joinType: string | null;
  mdmUrl: string | null;
  authMethods: string[];
  scopes: string[];
}

export interface AuthStatusResponse {
  state: AuthState;
  username: string | null;
  displayName: string | null;
  userId: string | null;
  cacheFile: string;
  callbackPort: number;
  claims: TokenClaimsSummary | null;
}

export interface StartLoginResponse {
  authUrl: string;
  redirectUri: string;
  state: string;
  expiresInSeconds: number;
}

export const completeUrlLoginSchema = z.object({
  redirectedUrl: z.string().url(),
});

export type CompleteUrlLoginRequest = z.infer<typeof completeUrlLoginSchema>;
