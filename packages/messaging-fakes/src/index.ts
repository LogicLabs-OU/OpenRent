/**
 * Stand-ins for Twilio Programmable Messaging and the MessageBird SMS API that keep messages in memory,
 * enforce each API's documented rules and send signed delivery reports, for testing text message
 * channels without accounts (FR-NOT-4). They need nothing but Node.
 */
export { startTwilioFake, twilioSignature, type TwilioFake, type TwilioMessage } from './twilio.ts';
export { startMessageBirdFake, messageBirdJwt, type MessageBirdFake, type MessageBirdMessage } from './messagebird.ts';
