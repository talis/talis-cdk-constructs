import {
  createPublicKey,
  randomUUID,
  verify,
  type KeyObject,
} from "node:crypto";

export type PersonaErrorType =
  | "validation_failure"
  | "insufficient_scope"
  | "communication_issue";

export interface TokenPayload {
  sub?: string;
  aud?: string;
  scopes?: string[];
  // Set instead of `scopes` when a token has too many scopes to embed
  scopeCount?: number;
  exp?: number;
  nbf?: number;
}

export class PersonaError extends Error {
  constructor(
    readonly type: PersonaErrorType,
    readonly token?: TokenPayload,
  ) {
    super(type);
  }
}

const PUBLIC_KEY_TTL_MS = 600_000;
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Minimal Persona client: validates OAuth bearer tokens (RS256 JWTs signed by
 * Persona) and checks their scopes. Mirrors talis-node's validateToken.
 */
export class PersonaClient {
  private publicKey?: { key: KeyObject; expiresAt: number };

  constructor(
    private readonly baseUrl: string,
    private readonly userAgent: string,
  ) {}

  /**
   * Resolves with the decoded token, or rejects with a PersonaError.
   * At least one of `scopes` must be granted when given.
   */
  async validateToken(
    token: string,
    scopes?: string[],
    requestId: string = randomUUID(),
  ): Promise<TokenPayload> {
    const payload = verifyJwt(token, await this.getPublicKey(requestId));

    if (!scopes) {
      return payload;
    }
    if (payload.scopeCount !== undefined) {
      await this.validateScopesRemotely(token, scopes, payload, requestId);
      return payload;
    }
    // A non-array claim must not reach hasAnyScope: "subscriber".includes("su") is true
    const granted = Array.isArray(payload.scopes) ? payload.scopes : [];
    if (!hasAnyScope(granted, scopes)) {
      throw new PersonaError("insufficient_scope", payload);
    }
    return payload;
  }

  private async getPublicKey(requestId: string): Promise<KeyObject> {
    if (this.publicKey && Date.now() < this.publicKey.expiresAt) {
      return this.publicKey.key;
    }
    const response = await this.request("GET", "/3/oauth/keys", requestId);
    if (response.status !== 200) {
      throw new PersonaError("communication_issue");
    }
    const key = createPublicKey(await response.text());
    this.publicKey = { key, expiresAt: Date.now() + PUBLIC_KEY_TTL_MS };
    return key;
  }

  private async validateScopesRemotely(
    token: string,
    scopes: string[],
    payload: TokenPayload,
    requestId: string,
  ): Promise<void> {
    const scopeParam = scopes.map(encodeURIComponent).join(",");
    const response = await this.request(
      "HEAD",
      `/3/oauth/tokens/${encodeURIComponent(token)}?scope=${scopeParam}`,
      requestId,
    );
    switch (response.status) {
      case 204:
        return;
      case 401:
        throw new PersonaError("validation_failure", payload);
      case 403:
        throw new PersonaError("insufficient_scope", payload);
      default:
        throw new PersonaError("communication_issue", payload);
    }
  }

  private request(
    method: string,
    path: string,
    requestId: string,
  ): Promise<Response> {
    return fetch(`${this.baseUrl}${path}`, {
      method,
      headers: { "User-Agent": this.userAgent, "X-Request-Id": requestId },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  }
}

/** Verifies an RS256 JWT's signature, `exp` and `nbf`; returns its payload. */
export function verifyJwt(token: string, key: KeyObject): TokenPayload {
  try {
    const [header, payload, signature, ...rest] = token.split(".");
    if (signature === undefined || rest.length > 0) {
      throw new Error("malformed token");
    }
    if (decodeSegment(header).alg !== "RS256") {
      throw new Error("unsupported algorithm");
    }
    const signed = Buffer.from(`${header}.${payload}`);
    if (
      !verify("RSA-SHA256", signed, key, Buffer.from(signature, "base64url"))
    ) {
      throw new Error("invalid signature");
    }

    const claims = decodeSegment(payload) as TokenPayload;
    const now = Math.floor(Date.now() / 1000);
    if (
      claims.exp !== undefined &&
      !(typeof claims.exp === "number" && now < claims.exp)
    ) {
      throw new Error("token expired");
    }
    if (
      claims.nbf !== undefined &&
      !(typeof claims.nbf === "number" && now >= claims.nbf)
    ) {
      throw new Error("token not yet valid");
    }
    return claims;
  } catch (err) {
    console.log("JWT verification failed:", (err as Error).message);
    throw new PersonaError("validation_failure");
  }
}

function decodeSegment(segment: string): Record<string, unknown> {
  const value = JSON.parse(Buffer.from(segment, "base64url").toString());
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("token segment is not a JSON object");
  }
  return value;
}

/** True when any granted scope satisfies any required scope. */
export function hasAnyScope(granted: string[], required: string[]): boolean {
  if (granted.includes("su")) {
    return true;
  }
  return required.some((r) => granted.some((g) => scopeSatisfies(g, r)));
}

// Scopes are `role` or `namespace@role`. `su@x` also grants `x:<anything>`.
function scopeSatisfies(granted: string, required: string): boolean {
  const [grantedNamespace, grantedRole] = splitScope(granted);
  const [requiredNamespace, requiredRole] = splitScope(required);
  const roleMatch = grantedRole === requiredRole;
  const suOverride =
    grantedNamespace === "su" &&
    (roleMatch || requiredRole.startsWith(`${grantedRole}:`));
  return suOverride || (grantedNamespace === requiredNamespace && roleMatch);
}

function splitScope(scope: string): [string | undefined, string] {
  const [first, second] = scope.split("@", 2);
  return second === undefined ? [undefined, first] : [first, second];
}
