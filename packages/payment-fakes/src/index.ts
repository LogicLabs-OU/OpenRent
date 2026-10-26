/**
 * Stand-ins for Mollie and PayPal that enforce each provider's documented rules, for testing payment
 * plugins without real accounts. They need nothing but Node.
 */
export { serve, decimals, minorOf, majorOf, type FakeHttp, type FakeRequest, type FakeReply } from './server.ts';
export { startMollieFake, type MollieFake, type MolliePayment } from './mollie.ts';
export { startPayPalFake, type PayPalFake, type PayPalOrder } from './paypal.ts';
