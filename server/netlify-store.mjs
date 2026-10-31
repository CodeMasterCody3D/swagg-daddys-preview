import { getStore } from '@netlify/blobs';

export function netlifyStore(env = process.env) {
  // Preview and development deployments must never read the production inbox.
  const suffix = env.CONTEXT === 'production' ? 'production' : `preview-${env.DEPLOY_ID || 'local'}`;
  const data = getStore({ name: `swagg-inbox-${suffix}`, consistency: 'strong' });
  return {
    async get(key) {
      const result = await data.getWithMetadata(key, { type: 'json' });
      return result ? { value: result.data, etag: result.etag } : null;
    },
    async put(key, value, expected) {
      const result = await data.setJSON(key, value, expected ? { onlyIfMatch: expected } : { onlyIfNew: true });
      return result.modified;
    },
    async remove(key) { await data.delete(key); },
    async keys(prefix) { return (await data.list({ prefix })).blobs.map(blob => blob.key); },
    async putBytes(key, bytes) { await data.set(key, bytes, { onlyIfNew: true }); },
    async getBytes(key) { return data.get(key, { type: 'arrayBuffer' }); }
  };
}
