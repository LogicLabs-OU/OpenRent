/**
 * Stand-ins for Google Calendar (API v3) and Microsoft Graph calendars that keep events in memory and
 * enforce the documented rules, for testing calendar integrations without real accounts (FR-INT-4).
 * Both sit behind the OAuth 2 server of `@openrent/accounting-fakes`.
 */
export { startGoogleCalendarFake, type GoogleCalendarFake, type GoogleEvent } from './google.ts';
export { startGraphCalendarFake, type GraphCalendarFake, type GraphEvent } from './graph.ts';
