import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
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

export function configured(env) {
  return /^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$/.test(env.OWNER_PASSWORD_HASH || '');
}

export async function verifyPassword(password, encoded) {
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
