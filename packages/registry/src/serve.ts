/**
 * Bağımsız çalıştırma girişi: `pnpm --filter @grid/registry build && pnpm --filter @grid/registry start`
 * Anahtarlar env'den gelir; verilmezse geliştirme için geçici anahtar üretilir
 * (üretimde KMS/HSM — doküman §13).
 */
import { generateSigningKeyPair } from '@grid/pack';
import { createRegistryServer } from './index.js';

const port = Number(process.env.PORT ?? 4100);

let gridPrivateKey = process.env.GRID_SIGNING_KEY;
let gridPublicKey = process.env.GRID_SIGNING_PUB;
if (!gridPrivateKey || !gridPublicKey) {
  const pair = generateSigningKeyPair();
  gridPrivateKey = pair.privateKey;
  gridPublicKey = pair.publicKey;
  console.warn('[grid-registry] GRID_SIGNING_KEY verilmedi; geçici geliştirme anahtarı üretildi.');
}

const app = createRegistryServer({ gridPrivateKey, gridPublicKey });

app
  .listen({ port, host: '0.0.0.0' })
  .then(() => console.log(`[grid-registry] http://localhost:${port}`))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
