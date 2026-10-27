/**
 * A stand-in for the EU's VIES VAT number service that knows a list of numbers, answers in its REST
 * format and can play a member state being down, for testing VAT number checks without the real
 * service (FR-PLG-1).
 */
export { startViesFake, type ViesFake, type ViesNumber } from './vies.ts';
