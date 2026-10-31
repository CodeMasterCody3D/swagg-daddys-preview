import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

// Local development/test adapter. Production uses Netlify Blobs, never function-local disk.
export function localStore(filename = ':memory:') {
  const db = new DatabaseSync(filename);
  db.exec('CREATE TABLE IF NOT EXISTS entries (key TEXT PRIMARY KEY, value BLOB NOT NULL, etag TEXT NOT NULL, binary INTEGER NOT NULL DEFAULT 0)');
  return {
    async get(key) {
      const row = db.prepare('SELECT value, etag FROM entries WHERE key = ? AND binary = 0').get(key);
      return row ? { value: JSON.parse(Buffer.from(row.value).toString()), etag: row.etag } : null;
    },
    async put(key, value, expected) {
      const bytes = Buffer.from(JSON.stringify(value)); const etag = randomUUID();
      const result = expected
        ? db.prepare('UPDATE entries SET value = ?, etag = ?, binary = 0 WHERE key = ? AND etag = ?').run(bytes, etag, key, expected)
        : db.prepare('INSERT OR IGNORE INTO entries (key, value, etag, binary) VALUES (?, ?, ?, 0)').run(key, bytes, etag);
      return result.changes === 1;
    },
    async remove(key) { db.prepare('DELETE FROM entries WHERE key = ?').run(key); },
    async keys(prefix) { return db.prepare('SELECT key FROM entries WHERE substr(key, 1, ?) = ?').all(prefix.length, prefix).map(row => row.key); },
    async putBytes(key, bytes) { db.prepare('INSERT INTO entries (key,value,etag,binary) VALUES (?, ?, ?, 1)').run(key, Buffer.from(bytes), randomUUID()); },
    async getBytes(key) { const row = db.prepare('SELECT value FROM entries WHERE key = ? AND binary = 1').get(key); return row ? row.value : null; },
    close() { db.close(); }
  };
}
