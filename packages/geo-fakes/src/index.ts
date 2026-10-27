/**
 * Stand-ins for a Nominatim geocoding server and an OSRM routing server that know a small list of
 * places, enforce Nominatim's usage policy (an identifying User-Agent, a request rate) and answer
 * in each API's format, for testing distance fees without the public services (FR-PR-8).
 */
export { startNominatimFake, type NominatimFake, type Place } from './nominatim.ts';
export { startOsrmFake, type OsrmFake } from './osrm.ts';
