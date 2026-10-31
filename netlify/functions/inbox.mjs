import { createApi } from '../../server/api.mjs';
import { netlifyStore } from '../../server/netlify-store.mjs';

export default async (request, context) => {
  try { return await createApi({ store: netlifyStore() })(request, context); }
  catch { return Response.json({ error: 'Backend storage is not available yet.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } }); }
};

export const config = {
  path: '/api/*',
  rateLimit: { windowLimit: 90, windowSize: 60, aggregateBy: ['ip', 'domain'] }
};
