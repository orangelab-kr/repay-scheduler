import { IncomingWebhook } from '@slack/webhook';

export const Webhook = new IncomingWebhook(
  String(process.env.SLACK_WEBHOOK_URL)
);
