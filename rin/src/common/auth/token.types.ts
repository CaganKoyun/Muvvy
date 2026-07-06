/** Principal kinds carried in a Spark access token. */
export type PrincipalType = 'consumer' | 'merchant';

export interface ConsumerTokenPayload {
  sub: string; // consumer id
  typ: 'consumer';
}

export interface MerchantTokenPayload {
  sub: string; // merchant id
  typ: 'merchant';
  role: string; // RBAC role within the tenant
}

export interface ConsumerPrincipal {
  id: string;
}

export interface MerchantPrincipal {
  id: string;
  role: string;
}
