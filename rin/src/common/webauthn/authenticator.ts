import {
  generateKeyPairSync,
  KeyObject,
  randomBytes,
  sign as cryptoSign,
} from 'crypto';
import { encode as cborEncode } from './cbor';
import { b64url, sha256 } from './webauthn';

/**
 * A software WebAuthn authenticator — used by the demo and e2e tests to play
 * the role of a passkey device (Touch ID / a security key). It produces real
 * ES256 attestations and assertions that the server verifier accepts, so the
 * passkey ceremony is exercised end-to-end with genuine P-256 signatures.
 * (In production this half runs inside the user's device; RIN never sees it.)
 */
export class SoftwareAuthenticator {
  private readonly privateKey: KeyObject;
  private readonly publicKey: KeyObject;
  readonly credentialIdBytes: Buffer;
  private counter = 0;

  constructor() {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    this.privateKey = privateKey;
    this.publicKey = publicKey;
    this.credentialIdBytes = randomBytes(16);
  }

  get credentialId(): string {
    return b64url.encode(this.credentialIdBytes);
  }

  private coseKey(): Buffer {
    const jwk = this.publicKey.export({ format: 'jwk' }) as { x: string; y: string };
    const x = Buffer.from(jwk.x, 'base64url');
    const y = Buffer.from(jwk.y, 'base64url');
    // COSE_Key for ES256: {1:2(EC2), 3:-7(ES256), -1:1(P-256), -2:x, -3:y}
    return cborEncode(
      new Map<number, unknown>([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-2, x],
        [-3, y],
      ]),
    );
  }

  /** Registration ceremony (navigator.credentials.create). */
  createAttestation(rpId: string, origin: string, challenge: string) {
    const clientData = Buffer.from(
      JSON.stringify({ type: 'webauthn.create', challenge, origin }),
    );
    const flags = 0x01 | 0x04 | 0x40; // UP | UV | AT
    const counterBuf = Buffer.alloc(4); // 0
    const aaguid = Buffer.alloc(16);
    const credIdLen = Buffer.alloc(2);
    credIdLen.writeUInt16BE(this.credentialIdBytes.length);
    const authData = Buffer.concat([
      sha256(Buffer.from(rpId)),
      Buffer.from([flags]),
      counterBuf,
      aaguid,
      credIdLen,
      this.credentialIdBytes,
      this.coseKey(),
    ]);
    const attestationObject = cborEncode(
      new Map<string, unknown>([
        ['fmt', 'none'],
        ['attStmt', new Map()],
        ['authData', authData],
      ]),
    );
    return {
      credentialId: this.credentialId,
      attestationObject: b64url.encode(attestationObject),
      clientDataJSON: b64url.encode(clientData),
    };
  }

  /** Authentication ceremony (navigator.credentials.get). */
  createAssertion(rpId: string, origin: string, challenge: string) {
    this.counter += 1;
    const flags = 0x01 | 0x04; // UP | UV
    const counterBuf = Buffer.alloc(4);
    counterBuf.writeUInt32BE(this.counter);
    const authData = Buffer.concat([sha256(Buffer.from(rpId)), Buffer.from([flags]), counterBuf]);
    const clientData = Buffer.from(
      JSON.stringify({ type: 'webauthn.get', challenge, origin }),
    );
    const signedData = Buffer.concat([authData, sha256(clientData)]);
    const signature = cryptoSign('sha256', signedData, this.privateKey);
    return {
      credentialId: this.credentialId,
      authenticatorData: b64url.encode(authData),
      clientDataJSON: b64url.encode(clientData),
      signature: b64url.encode(signature),
    };
  }
}
