// Hello GRID — dokümandaki K4 deseninin canlı örneği:
// çekirdek bir kez yazılır, host süper güçleri capability detection ile kullanılır.
/* global grid */

async function main() {
  const user = await grid.core.auth.getUser();

  let mode;
  if (grid.capabilities.identity.proofOfPersonhood) {
    // World: anonim-ama-tekil deneyim.
    mode = 'anonim-tekil';
  } else if (grid.capabilities.identity.kyc) {
    // Spark/banka: KYC'li deneyim.
    mode = `dogrulanmis (${user.claims.kyc_level ?? 'bilinmiyor'})`;
  } else {
    // Core fallback: her host'ta çalışan asgari deneyim.
    mode = 'temel';
  }

  document.getElementById('greeting').textContent =
    `Merhaba ${user.name ?? user.sub} — mod: ${mode}`;

  document.getElementById('support').addEventListener('click', async () => {
    const result = await grid.core.pay.request({
      amount: 10,
      currency: 'TRY',
      description: 'Hello GRID destek',
    });
    await grid.core.storage.set('last_tx', result.transactionId ?? null);
  });
}

main();
