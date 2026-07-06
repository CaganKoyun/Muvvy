// Minimal token storage for the two principals (brand + consumer).
const MK = 'rin.merchantToken';
const CK = 'rin.consumerToken';

export const auth = {
  merchantToken: () => localStorage.getItem(MK),
  consumerToken: () => localStorage.getItem(CK),
  setMerchant: (t: string) => localStorage.setItem(MK, t),
  setConsumer: (t: string) => localStorage.setItem(CK, t),
  clearMerchant: () => localStorage.removeItem(MK),
  clearConsumer: () => localStorage.removeItem(CK),
};
