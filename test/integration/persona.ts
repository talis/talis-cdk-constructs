import axios from "axios";
import { nowSeconds, signJwt } from "../fixtures/jwt";

async function getOAuthToken(client = "", secret = ""): Promise<string> {
  const response = await axios.post(
    "https://staging-users.talis.com/oauth/tokens",
    "grant_type=client_credentials",
    {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      auth: { username: client, password: secret },
    },
  );
  return response.data.access_token;
}

/** Staging Persona token with the analytics:admin scope. */
export const getValidToken = () =>
  getOAuthToken(
    process.env.TALIS_CDK_AUTH_API_VALID_CLIENT,
    process.env.TALIS_CDK_AUTH_API_VALID_SECRET,
  );

/** Staging Persona token without the analytics:admin scope. */
export const getMissingScopeToken = () =>
  getOAuthToken(
    process.env.TALIS_CDK_AUTH_API_MISSING_SCOPE_CLIENT,
    process.env.TALIS_CDK_AUTH_API_MISSING_SCOPE_SECRET,
  );

/** Well-formed, unexpired JWT claiming every scope, but not signed by Persona. */
export const forgedToken = signJwt({
  sub: "forged",
  aud: "forged",
  scopes: ["su"],
  exp: nowSeconds() + 3600,
});

/** Axios client that resolves for every status, so tests assert on it. */
export function apiClient(baseURL: string, token?: string) {
  return axios.create({
    baseURL,
    headers: token === undefined ? {} : { Authorization: `Bearer ${token}` },
    validateStatus: () => true,
  });
}
