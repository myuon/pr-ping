import { Octokit } from "@octokit/rest";

/**
 * Create a JWT for GitHub App authentication.
 * Uses Web Crypto API available in Cloudflare Workers.
 */
async function createAppJwt(
  appId: string,
  privateKeyPem: string
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iat: now - 60,
    exp: now + 600,
    iss: appId,
  };

  const encode = (obj: object) =>
    btoa(JSON.stringify(obj))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

  const headerB64 = encode(header);
  const payloadB64 = encode(payload);
  const signingInput = `${headerB64}.${payloadB64}`;

  const key = await importPrivateKey(privateKeyPem);
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(signingInput)
  );

  const signatureBytes = new Uint8Array(signature);
  let signatureBinary = '';
  for (let i = 0; i < signatureBytes.length; i++) {
    signatureBinary += String.fromCharCode(signatureBytes[i]);
  }
  const signatureB64 = btoa(signatureBinary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  return `${signingInput}.${signatureB64}`;
}

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const pemContents = pem
    .replace(/-----BEGIN RSA PRIVATE KEY-----/, "")
    .replace(/-----END RSA PRIVATE KEY-----/, "")
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s/g, "");

  const binaryDer = Uint8Array.from(atob(pemContents), (c) => c.charCodeAt(0));

  // Try PKCS#8 first, fall back to PKCS#1
  try {
    return await crypto.subtle.importKey(
      "pkcs8",
      binaryDer.buffer as ArrayBuffer,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"]
    );
  } catch {
    // If PKCS#8 fails, wrap PKCS#1 in PKCS#8 and retry
    const pkcs8 = wrapPkcs1InPkcs8(binaryDer);
    return await crypto.subtle.importKey(
      "pkcs8",
      pkcs8.buffer as ArrayBuffer,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"]
    );
  }
}

function wrapPkcs1InPkcs8(pkcs1: Uint8Array): Uint8Array {
  // ASN.1 DER encoding to wrap PKCS#1 RSA private key in PKCS#8 structure
  const oid = new Uint8Array([
    0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01,
    0x01, 0x05, 0x00,
  ]);

  const octetString = new Uint8Array(2 + lengthBytes(pkcs1.length).length + pkcs1.length);
  let offset = 0;
  octetString[offset++] = 0x04;
  const lenBytes = lengthBytes(pkcs1.length);
  octetString.set(lenBytes, offset);
  offset += lenBytes.length;
  octetString.set(pkcs1, offset);

  const version = new Uint8Array([0x02, 0x01, 0x00]);
  const innerLength = version.length + oid.length + octetString.length;
  const result = new Uint8Array(2 + lengthBytes(innerLength).length + innerLength);
  offset = 0;
  result[offset++] = 0x30;
  const innerLenBytes = lengthBytes(innerLength);
  result.set(innerLenBytes, offset);
  offset += innerLenBytes.length;
  result.set(version, offset);
  offset += version.length;
  result.set(oid, offset);
  offset += oid.length;
  result.set(octetString, offset);

  return result;
}

function lengthBytes(length: number): Uint8Array {
  if (length < 0x80) {
    return new Uint8Array([length]);
  } else if (length < 0x100) {
    return new Uint8Array([0x81, length]);
  } else if (length < 0x10000) {
    return new Uint8Array([0x82, length >> 8, length & 0xff]);
  }
  throw new Error("Length too large");
}

/**
 * Get an installation access token for the GitHub App.
 */
export async function getInstallationToken(
  appId: string,
  privateKey: string,
  installationId: number | undefined
): Promise<string> {
  if (!installationId) {
    throw new Error("No installation ID found in webhook payload");
  }

  const jwt = await createAppJwt(appId, privateKey);
  const octokit = new Octokit({ auth: jwt });

  const { data } = await octokit.apps.createInstallationAccessToken({
    installation_id: installationId,
  });

  return data.token;
}
