/**
 * Stand-ins for Twilio Programmable Messaging, the MessageBird SMS API and Slack incoming webhooks that keep messages in memory,
 * enforce each API's documented rules and send signed delivery reports, for testing text message
 * channels without accounts (FR-NOT-4). They need nothing but Node.
 */
export { startTwilioFake, twilioSignature, type TwilioFake, type TwilioMessage } from './twilio.ts';
export { startMessageBirdFake, messageBirdJwt, type MessageBirdFake, type MessageBirdMessage } from './messagebird.ts';
export { startSlackFake, type SlackFake, type SlackMessage } from './slack.ts';
