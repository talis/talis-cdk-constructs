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

interface HttpApiAuthorizerEvent {
  headers?: Record<string, string | undefined>;
  routeArn: string;
}

interface TokenAuthorizerEvent {
  authorizationToken?: string;
  methodArn: string;
}

/** HTTP API (API Gateway v2) Lambda authorizer with simple responses. */
export async function httpApiHandler(event: HttpApiAuthorizerEvent) {
  const result = await authorize(event.headers?.authorization, event.routeArn);
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

/** REST API (API Gateway v1) TOKEN authorizer returning an IAM policy. */
export async function restApiHandler(event: TokenAuthorizerEvent) {
  const result = await authorize(event.authorizationToken, event.methodArn);
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

async function authorize(
  authorizationHeader: string | undefined,
  arn: string,
): Promise<AuthorizeResult> {
  const token = authorizationHeader?.replace("Bearer", "").trim();
  if (!token) {
    // API Gateway responds 401 to this exact error message
    throw new Error("Unauthorized");
  }

  const resourcePath = resourcePathFromArn(arn);
  const scope = requiredScope(resourcePath);
  try {
    const decoded = await persona.validateToken(token, scope?.split(","));
    return { authorized: true, token: decoded };
  } catch (err) {
    if (err instanceof PersonaError) {
      console.log(`Token rejected for ${resourcePath}: ${err.type}`);
      return {
        authorized: false,
        insufficientScope: err.type === "insufficient_scope",
        token: err.token,
      };
    }
    console.error(`Token validation failed for ${resourcePath}:`, err);
    return { authorized: false, insufficientScope: false };
  }
}

/**
 * Resource path of a method/route ARN, e.g.
 * `arn:aws:execute-api:eu-west-1:123:api-id/stage/GET/a/b` -> `/a/b`.
 */
export function resourcePathFromArn(arn: string): string {
  const apiGatewayArn = arn.split(":").slice(5).join(":");
  return `/${apiGatewayArn.split("/").slice(3).join("/")}`;
}

/** Scope required by the first SCOPE_CONFIG path matching `resourcePath`. */
export function requiredScope(resourcePath: string): string | undefined {
  const config: Record<string, string> = JSON.parse(
    process.env.SCOPE_CONFIG ?? "{}",
  );
  return Object.entries(config).find(([path]) =>
    pathMatches(path, resourcePath),
  )?.[1];
}

/** Matches a path against a definition where `{param}` matches any segment. */
export function pathMatches(definition: string, path: string): boolean {
  const definitionSegments = definition.split("/");
  const pathSegments = path.split("/");
  return (
    definitionSegments.length === pathSegments.length &&
    definitionSegments.every(
      (segment, i) =>
        (segment.startsWith("{") && segment.endsWith("}")) ||
        segment === pathSegments[i],
    )
  );
}
