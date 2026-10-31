import { getStore } from '@netlify/blobs';

export function netlifyStore(context, openStore = getStore) {
  // Preview and development deployments must never read the production inbox.
  // CONTEXT and DEPLOY_ID are build variables, not guaranteed runtime variables.
  const deploy = context?.deploy;
  if (!deploy?.id || !deploy?.context) throw new Error('Missing trusted deployment context');
  const suffix = deploy.context === 'production' ? 'production' : `preview-${deploy.id}`;
  const data = openStore({ name: `swagg-inbox-${suffix}`, consistency: 'strong' });
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
