import type {
  APIGatewayAuthorizerResult,
  APIGatewayRequestAuthorizerEvent,
  APIGatewayRequestAuthorizerEventHeaders,
  APIGatewayRequestAuthorizerEventV2,
  APIGatewaySimpleAuthorizerWithContextResult,
} from "aws-lambda";
import {
  PersonaClient,
  PersonaError,
  type TokenPayload,
} from "./persona-client";

// Module scope so the cached Persona public key survives warm invocations
const persona = new PersonaClient(
  `${process.env.PERSONA_SCHEME}://${process.env.PERSONA_HOST}:${process.env.PERSONA_PORT}`,
  `${process.env.PERSONA_CLIENT_NAME} (lambda)`,
);

// Required scope per "<METHOD> <route>", set by the construct
const scopeConfig: Record<string, string> = JSON.parse(
  process.env.SCOPE_CONFIG ?? "{}",
);

/** Passed to route handlers as `requestContext.authorizer.lambda`. */
export interface HttpApiAuthorizerContext {
  clientId: string;
  description?: string;
}

/** HTTP API (API Gateway v2) Lambda authorizer with simple responses. */
export async function httpApiHandler(
  event: APIGatewayRequestAuthorizerEventV2,
): Promise<
  APIGatewaySimpleAuthorizerWithContextResult<HttpApiAuthorizerContext>
> {
  const result = await authorize(event.headers, event.routeKey);
  const clientId = result.token?.sub ?? "";
  if (result.authorized) {
    return { isAuthorized: true, context: { clientId } };
  }
  return {
    isAuthorized: false,
    context: result.insufficientScope
      ? { description: "Insufficient Scope", clientId }
      : { clientId },
  };
}

/** REST API (API Gateway v1) REQUEST authorizer returning an IAM policy. */
export async function restApiHandler(
  event: APIGatewayRequestAuthorizerEvent,
): Promise<APIGatewayAuthorizerResult> {
  const result = await authorize(
    event.headers,
    `${event.httpMethod} ${event.resource}`,
  );
  return {
    principalId: result.authorized ? (result.token.aud ?? "invalid_oauth") : "",
    policyDocument: {
      Version: "2012-10-17",
      Statement: [
        {
          Action: "execute-api:Invoke",
          Effect: result.authorized ? "Allow" : "Deny",
          Resource: [event.methodArn],
        },
      ],
    },
  };
}

type AuthorizeResult =
  | { authorized: true; token: TokenPayload }
  | { authorized: false; insufficientScope: boolean; token?: TokenPayload };

/**
 * @param routeKey `<METHOD> <route/resource template>`, e.g. `GET /items/{id}`
 */
async function authorize(
  headers: APIGatewayRequestAuthorizerEventHeaders | null | undefined,
  routeKey: string,
): Promise<AuthorizeResult> {
  const token = header(headers, "authorization")
    ?.replace(/^bearer\b/i, "")
    .trim();
  if (!token) {
    // API Gateway responds 401 to this exact error message
    throw new Error("Unauthorized");
  }

  const scope = requiredScope(routeKey);
  // Pass the caller's X-Request-Id on to Persona for tracing; an empty one gets generated
  const requestId = header(headers, "x-request-id") || undefined;
  try {
    const decoded = await persona.validateToken(
      token,
      scope?.split(",").map((s) => s.trim()),
      requestId,
    );
    return { authorized: true, token: decoded };
  } catch (err) {
    if (err instanceof PersonaError) {
      console.log(`Token rejected for ${routeKey}: ${err.type}`);
      return {
        authorized: false,
        insufficientScope: err.type === "insufficient_scope",
        token: err.token,
      };
    }
    console.error(`Token validation failed for ${routeKey}:`, err);
    return { authorized: false, insufficientScope: false };
  }
}

/** Scope SCOPE_CONFIG requires for `routeKey`, if any. */
export function requiredScope(routeKey: string): string | undefined {
  // REST API events carry the request's verb, not "ANY", for ANY methods
  const anyMethodKey = routeKey.replace(/^\S+/, "ANY");
  const key = [routeKey, anyMethodKey].find((k) =>
    Object.hasOwn(scopeConfig, k),
  );
  return key === undefined ? undefined : scopeConfig[key];
}

// HTTP API lowercases header names; REST API keeps them as sent
function header(
  headers: APIGatewayRequestAuthorizerEventHeaders | null | undefined,
  name: string,
): string | undefined {
  return Object.entries(headers ?? {}).find(
    ([key]) => key.toLowerCase() === name,
  )?.[1];
}
