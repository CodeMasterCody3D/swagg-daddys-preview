import { netlifyStore } from '../../server/netlify-store.mjs';
import { createPushService } from '../../server/push.mjs';

export default async (_request, context) => {
  const push=createPushService({store:netlifyStore(context),env:process.env});
  // Resend reminders for requests the owner has not opened yet, then deliver.
  await push.remind(context.waitUntil?.bind(context));
  await push.drain();
  return new Response(null,{status:204});
};
export const config = { schedule:'*/5 * * * *' };
