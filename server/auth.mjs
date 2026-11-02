import { randomBytes, scrypt as scryptCallback, pbkdf2 as pbkdf2Callback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const pbkdf2 = promisify(pbkdf2Callback);
export const digest = value => createHash('sha256').update(value).digest('hex');
export const token = () => randomBytes(32).toString('hex');
export const COOKIE = '__Host-swagg_session';
export const SESSION_MS = 12 * 60 * 60 * 1000;

export async function hashPassword(password) {
  if (password.length < 14 || password.length > 256) throw new Error('Use a password of 14–256 characters.');
  const salt = randomBytes(16).toString('hex');
  const derived = await scrypt(password, salt, 64);
  return `scrypt:${salt}:${derived.toString('hex')}`;
}

const passwordHashPattern = /^(?:scrypt:[a-f0-9]{32}:[a-f0-9]{128}|pbkdf2:600000:[a-f0-9]{32}:[a-f0-9]{64})$/;
const usernameKey = value => typeof value === 'string' ? value.trim().toLowerCase() : '';

export function ownerAccounts(env) {
  const accounts = new Map();
  function add(username, passwordHash) {
    const key = usernameKey(username);
    if (!key || key.length > 100 || typeof passwordHash !== 'string' || !passwordHashPattern.test(passwordHash) || accounts.has(key)) return;
    accounts.set(key, { username: username.trim(), passwordHash });
  }
  // Keep the original owner account and its existing sessions working.
  add(env.OWNER_USERNAME || 'owner', env.OWNER_PASSWORD_HASH);
  try {
    const additional = JSON.parse(env.OWNER_ACCOUNTS_JSON || '[]');
    if (Array.isArray(additional) && additional.length <= 50) {
      for (const account of additional) add(account?.username, account?.passwordHash);
    }
  } catch { /* Invalid optional configuration never grants access. */ }
  return [...accounts.values()];
}

export function ownerAccount(env, username) {
  return ownerAccounts(env).find(account => usernameKey(account.username) === usernameKey(username));
}

export function configured(env) { return ownerAccounts(env).length > 0; }

export async function verifyPassword(password, encoded) {
  if (encoded.startsWith('pbkdf2:')) {
    const [, iterations, salt, expected] = encoded.split(':');
    const actual = await pbkdf2(password, salt, Number(iterations), 32, 'sha256');
    return timingSafeEqual(actual, Buffer.from(expected, 'hex'));
  }
  const [, salt, expected] = encoded.split(':');
  const actual = await scrypt(password, salt, 64);
  return timingSafeEqual(actual, Buffer.from(expected, 'hex'));
}

export function cookieValue(request) {
  return (request.headers.get('cookie') || '').split(';').map(v => v.trim())
    .find(v => v.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1) || '';
}

export function sessionCookie(value, maxAge = SESSION_MS / 1000) {
  return `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}
