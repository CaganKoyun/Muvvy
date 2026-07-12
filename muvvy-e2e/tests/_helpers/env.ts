/** Typed, validated access to E2E configuration. */
export const MODE = (process.env.E2E_MODE || 'live') as 'live' | 'mock';
export const BASE_URL = process.env.BASE_URL || 'https://muvvy.now';
export const READONLY = process.env.E2E_READONLY === '1';

export const MOVIE_QUERY = process.env.E2E_MOVIE_QUERY || 'Inception';
export const MOVIE_TMDB_ID = process.env.E2E_MOVIE_TMDB_ID || '27205';

export interface Account {
  email: string;
  password: string;
  username: string;
  storageState: string; // path to Playwright storageState JSON
}

export const ACCOUNT_1: Account = {
  email: process.env.E2E_EMAIL || '',
  password: process.env.E2E_PASSWORD || '',
  username: process.env.E2E_USERNAME || '',
  storageState: 'tests/.auth/user1.json',
};

export const ACCOUNT_2: Account = {
  email: process.env.E2E_EMAIL_2 || '',
  password: process.env.E2E_PASSWORD_2 || '',
  username: process.env.E2E_USERNAME_2 || '',
  storageState: 'tests/.auth/user2.json',
};

export function requireAccount(a: Account, which: string) {
  if (MODE !== 'live') return;
  if (!a.email || !a.password) {
    throw new Error(
      `[muvvy-e2e] LIVE mode needs ${which} credentials. Set E2E_EMAIL/E2E_PASSWORD` +
      ` (and _2 for the second account) in .env — see .env.example.`,
    );
  }
}
