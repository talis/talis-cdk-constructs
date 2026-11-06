import * as cdk from "aws-cdk-lib";

/** Where the authorizer reaches Persona. All strings - even the port. */
export interface PersonaProps {
  host: string;
  scheme: string;
  port: string;
  /** @deprecated Ignored: the authorizer always uses Persona's /3/oauth routes. */
  oauth_route?: string;
}

/**
 * The Persona origin the authorizer calls, e.g. "https://users.talis.com".
 * Exactly one of `persona` and `personaOrigin` must be set.
 */
export function resolvePersonaOrigin(props: {
  persona?: PersonaProps;
  personaOrigin?: string;
}): string {
  const { persona, personaOrigin } = props;
  if (persona) {
    if (personaOrigin !== undefined) {
      throw new Error("Set either persona or personaOrigin, not both");
    }
    return `${persona.scheme}://${persona.host}:${persona.port}`;
  }
  if (personaOrigin === undefined) {
    throw new Error("Set either persona or personaOrigin");
  }
  // A path or trailing slash would break the authorizer's Persona URLs
  if (
    !cdk.Token.isUnresolved(personaOrigin) &&
    (!URL.canParse(personaOrigin) ||
      new URL(personaOrigin).origin !== personaOrigin)
  ) {
    throw new Error(
      `personaOrigin must be an origin such as "https://users.talis.com", got "${personaOrigin}"`,
    );
  }
  return personaOrigin;
}
