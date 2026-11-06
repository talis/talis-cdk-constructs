import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";

export const { publicKey, privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
export const publicKeyPem = publicKey
  .export({ type: "spki", format: "pem" })
  .toString();

const encode = (value: unknown) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");

/** Signs `payload` as an RS256 JWT (header `alg` can be overridden). */
export function signJwt(
  payload: unknown,
  { alg = "RS256", key = privateKey }: { alg?: string; key?: KeyObject } = {},
): string {
  const data = `${encode({ alg, typ: "JWT" })}.${encode(payload)}`;
  const signature = sign("RSA-SHA256", Buffer.from(data), key);
  return `${data}.${signature.toString("base64url")}`;
}

export const nowSeconds = () => Math.floor(Date.now() / 1000);

/** A fetch stub serving the test public key and answering HEAD with `headStatus`. */
export function personaFetch(headStatus = 204) {
  return vi.fn(async (url: string, init?: RequestInit) =>
    init?.method === "HEAD"
      ? new Response(null, { status: headStatus })
      : url.endsWith("/3/oauth/keys")
        ? new Response(publicKeyPem)
        : new Response(null, { status: 404 }),
  );
}
