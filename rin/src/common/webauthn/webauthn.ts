import { createHash, createPublicKey, verify as cryptoVerify, randomBytes } from 'crypto';
import { decodeFirst } from './cbor';

export interface PublicKeyJwk {
  kty: 'EC';
  crv: 'P-256';
  x: string;
  y: string;
}

export const b64url = {
  encode: (buf: Buffer): string => buf.toString('base64url'),
  decode: (s: string): Buffer => Buffer.from(s, 'base64url'),
};

export function sha256(buf: Buffer): Buffer {
  return createHash('sha256').update(buf).digest();
}

export function randomChallenge(): string {
  return b64url.encode(randomBytes(32));
}

interface ParsedAuthData {
  rpIdHash: Buffer;
  flags: number;
  counter: number;
  credentialId?: Buffer;
  cosePublicKey?: Buffer;
}

function parseAuthData(authData: Buffer): ParsedAuthData {
  const rpIdHash = authData.subarray(0, 32);
  const flags = authData[32];
  const counter = authData.readUInt32BE(33);
  const result: ParsedAuthData = { rpIdHash, flags, counter };

  // Attested credential data present (AT flag, bit 6)?
  if (flags & 0x40) {
    // skip aaguid(16); credIdLen(2); credId; then COSE key (rest)
    let ptr = 37 + 16;
    const credIdLen = authData.readUInt16BE(ptr);
    ptr += 2;
    result.credentialId = authData.subarray(ptr, ptr + credIdLen);
    ptr += credIdLen;
    result.cosePublicKey = authData.subarray(ptr);
  }
  return result;
}

function coseToJwk(cose: Buffer): PublicKeyJwk {
  const map = decodeFirst(cose) as Map<number, unknown>;
  const kty = map.get(1);
  const alg = map.get(3);
  const x = map.get(-2) as Buffer;
  const y = map.get(-3) as Buffer;
  if (kty !== 2 || alg !== -7 || !Buffer.isBuffer(x) || !Buffer.isBuffer(y)) {
    throw new Error('Unsupported COSE key (only ES256 / P-256 is supported).');
  }
  return { kty: 'EC', crv: 'P-256', x: b64url.encode(x), y: b64url.encode(y) };
}

function parseClientData(clientDataJSONb64: string, expectedType: string, challenge: string, origin: string) {
  const raw = b64url.decode(clientDataJSONb64);
  const data = JSON.parse(raw.toString('utf8'));
  if (data.type !== expectedType) throw new Error(`Unexpected clientData type ${data.type}`);
  if (data.challenge !== challenge) throw new Error('Challenge mismatch.');
  if (data.origin !== origin) throw new Error('Origin mismatch.');
  return raw;
}

export interface VerifyRegistrationInput {
  rpId: string;
  origin: string;
  expectedChallenge: string;
  clientDataJSON: string; // base64url
  attestationObject: string; // base64url
}

export function verifyRegistration(input: VerifyRegistrationInput) {
  parseClientData(input.clientDataJSON, 'webauthn.create', input.expectedChallenge, input.origin);
  const att = decodeFirst(b64url.decode(input.attestationObject)) as Map<string, unknown>;
  const authData = att.get('authData') as Buffer;
  if (!Buffer.isBuffer(authData)) throw new Error('Malformed attestation object.');

  const parsed = parseAuthData(authData);
  if (!parsed.rpIdHash.equals(sha256(Buffer.from(input.rpId)))) throw new Error('rpId mismatch.');
  if (!(parsed.flags & 0x01)) throw new Error('User presence flag not set.');
  if (!parsed.credentialId || !parsed.cosePublicKey) throw new Error('No attested credential.');

  return {
    credentialId: b64url.encode(parsed.credentialId),
    publicKeyJwk: coseToJwk(parsed.cosePublicKey),
    counter: parsed.counter,
  };
}

export interface VerifyAuthenticationInput {
  rpId: string;
  origin: string;
  expectedChallenge: string;
  clientDataJSON: string; // base64url
  authenticatorData: string; // base64url
  signature: string; // base64url (DER ECDSA)
  publicKeyJwk: PublicKeyJwk;
  storedCounter: number;
}

export function verifyAuthentication(input: VerifyAuthenticationInput) {
  const clientDataRaw = parseClientData(
    input.clientDataJSON,
    'webauthn.get',
    input.expectedChallenge,
    input.origin,
  );
  const authData = b64url.decode(input.authenticatorData);
  const parsed = parseAuthData(authData);
  if (!parsed.rpIdHash.equals(sha256(Buffer.from(input.rpId)))) throw new Error('rpId mismatch.');
  if (!(parsed.flags & 0x01)) throw new Error('User presence flag not set.');

  const signedData = Buffer.concat([authData, sha256(clientDataRaw)]);
  const key = createPublicKey({ key: input.publicKeyJwk as any, format: 'jwk' });
  const ok = cryptoVerify('sha256', signedData, key, b64url.decode(input.signature));
  if (!ok) throw new Error('Signature verification failed.');

  // Clone-detection: counter must move forward (unless the authenticator keeps 0).
  if (parsed.counter !== 0 && parsed.counter <= input.storedCounter) {
    throw new Error('Authenticator counter did not increase (possible cloned key).');
  }
  return { newCounter: parsed.counter };
}
