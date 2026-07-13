/**
 * The Consent Engine data dictionary.
 *
 * A "scope" is a single, granular thing a merchant can ask for and a customer
 * can approve or decline independently. Two flavours:
 *
 *   - `profile`     : discloses a piece of the customer's PII (email, phone …).
 *   - `permission`  : a standing permission the customer grants (marketing …).
 *
 * A merchant's Consent Engine config is just a set of these keys marked
 * required or optional (see PRD "Consent Engine"). The customer approves only
 * the scopes they choose; the merchant then receives *exactly* those and
 * nothing else.
 */
export type ScopeCategory = 'profile' | 'permission';

export interface ScopeDef {
  key: string;
  label: string;
  category: ScopeCategory;
  /** True if disclosing this reveals personal data (drives audit + UX warnings). */
  pii: boolean;
  description: string;
}

export const SCOPES = {
  PROFILE_NAME: 'profile:name',
  PROFILE_EMAIL: 'profile:email',
  PROFILE_PHONE: 'profile:phone',
  PROFILE_BIRTHDAY: 'profile:birthday',
  PROFILE_GENDER: 'profile:gender',
  PROFILE_ADDRESS: 'profile:address',
  PERM_MARKETING: 'permission:marketing',
  PERM_SMS: 'permission:sms',
  PERM_LOCATION: 'permission:location',
  PERM_ANALYTICS: 'permission:analytics',
} as const;

export const SCOPE_CATALOG: Record<string, ScopeDef> = {
  [SCOPES.PROFILE_NAME]: {
    key: SCOPES.PROFILE_NAME,
    label: 'Full name',
    category: 'profile',
    pii: true,
    description: 'First and last name.',
  },
  [SCOPES.PROFILE_EMAIL]: {
    key: SCOPES.PROFILE_EMAIL,
    label: 'Email address',
    category: 'profile',
    pii: true,
    description: 'Primary email address.',
  },
  [SCOPES.PROFILE_PHONE]: {
    key: SCOPES.PROFILE_PHONE,
    label: 'Phone number',
    category: 'profile',
    pii: true,
    description: 'Mobile phone number.',
  },
  [SCOPES.PROFILE_BIRTHDAY]: {
    key: SCOPES.PROFILE_BIRTHDAY,
    label: 'Birthday',
    category: 'profile',
    pii: true,
    description: 'Date of birth (used for birthday campaigns).',
  },
  [SCOPES.PROFILE_GENDER]: {
    key: SCOPES.PROFILE_GENDER,
    label: 'Gender',
    category: 'profile',
    pii: true,
    description: 'Self-declared gender.',
  },
  [SCOPES.PROFILE_ADDRESS]: {
    key: SCOPES.PROFILE_ADDRESS,
    label: 'Address',
    category: 'profile',
    pii: true,
    description: 'Postal address.',
  },
  [SCOPES.PERM_MARKETING]: {
    key: SCOPES.PERM_MARKETING,
    label: 'Marketing communications',
    category: 'permission',
    pii: false,
    description: 'Permission to send marketing campaigns.',
  },
  [SCOPES.PERM_SMS]: {
    key: SCOPES.PERM_SMS,
    label: 'SMS messages',
    category: 'permission',
    pii: false,
    description: 'Permission to send SMS.',
  },
  [SCOPES.PERM_LOCATION]: {
    key: SCOPES.PERM_LOCATION,
    label: 'Location analytics',
    category: 'permission',
    pii: false,
    description: 'Permission to use in-store location signals.',
  },
  [SCOPES.PERM_ANALYTICS]: {
    key: SCOPES.PERM_ANALYTICS,
    label: 'Shopping analytics',
    category: 'permission',
    pii: false,
    description: 'Permission to analyse purchase behaviour.',
  },
};

export const ALL_SCOPE_KEYS = Object.keys(SCOPE_CATALOG);

export function isValidScope(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(SCOPE_CATALOG, key);
}

export function describeScopes(keys: string[]): ScopeDef[] {
  return keys.filter(isValidScope).map((k) => SCOPE_CATALOG[k]);
}
