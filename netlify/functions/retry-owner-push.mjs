import { netlifyStore } from '../../server/netlify-store.mjs';
import { createPushService } from '../../server/push.mjs';

export default async (_request, context) => {
  await createPushService({store:netlifyStore(context),env:process.env}).drain();
  return new Response(null,{status:204});
};
export const config = { schedule:'*/5 * * * *' };
