import { randomUUID } from 'node:crypto';
import { json, startFake, type FakeReply, type FakeRequest, type FakeServer } from '@openrent/accounting-fakes';

/**
 * Google Calendar API v3, the parts a booking calendar uses: `calendars/{id}` (with `primary` for the
 * signed-in user), and events created, patched and deleted under `/calendars/{id}/events`. As Google
 * does: start and end need a `dateTime` (or a `date`), the end must come after the start, a deleted
 * event answers 410 Gone and an unknown one 404, and DELETE answers 204 with no body.
 */
export interface GoogleEvent {
  id: string;
  status: 'confirmed' | 'cancelled';
  summary?: string;
  description?: string;
  location?: string;
  start: { dateTime?: string; date?: string; timeZone?: string };
  end: { dateTime?: string; date?: string; timeZone?: string };
  extendedProperties?: { private?: Record<string, string> };
  htmlLink: string;
  updated: string;
}

export interface GoogleCalendarFake extends FakeServer {
  /** Calendars by id, each with its events by id. */
  calendars: Map<string, { summary: string; events: Map<string, GoogleEvent> }>;
  owner: string;
  /** The live (not deleted) events of a calendar. */
  events(calendarId?: string): GoogleEvent[];
  /** Someone deletes the event in Google Calendar itself. */
  deleteInGoogle(calendarId: string, eventId: string): void;
}

const err = (status: number, message: string, reason = 'invalid'): FakeReply => json(status, { error: { code: status, message, errors: [{ domain: 'global', reason, message }] } });
const when = (t: GoogleEvent['start'] | undefined) => (t?.dateTime ? Date.parse(t.dateTime) : t?.date ? Date.parse(`${t.date}T00:00:00Z`) : NaN);

export async function startGoogleCalendarFake(opts: { clientId?: string; clientSecret?: string; owner?: string; calendars?: string[] } = {}): Promise<GoogleCalendarFake> {
  const owner = opts.owner ?? 'shop@example.com';
  const calendars: GoogleCalendarFake['calendars'] = new Map([[owner, { summary: owner, events: new Map() }]]);
  for (const c of opts.calendars ?? []) calendars.set(c, { summary: c, events: new Map() });
  const cal = (id: string) => calendars.get(id === 'primary' ? owner : decodeURIComponent(id));

  const check = (b: any): FakeReply | null => {
    if (!b || typeof b !== 'object') return err(400, 'Parse Error', 'parseError');
    const s = when(b.start);
    const e = when(b.end);
    if (Number.isNaN(s)) return err(400, 'Missing start time.', 'required');
    if (Number.isNaN(e)) return err(400, 'Missing end time.', 'required');
    if (e <= s) return err(400, 'The specified time range is empty.', 'timeRangeEmpty');
    return null;
  };

  const api = (req: FakeRequest): FakeReply => {
    const m = /^\/calendar\/v3\/calendars\/([^/]+)(?:\/events(?:\/([^/]+))?)?$/.exec(req.path);
    if (!m) return err(404, 'Not Found', 'notFound');
    const c = cal(m[1]!);
    if (!c) return err(404, 'Not Found', 'notFound');
    const calendarId = m[1] === 'primary' ? owner : decodeURIComponent(m[1]!);
    const eventPath = req.path.includes('/events');
    if (!eventPath) return req.method === 'GET' ? json(200, { kind: 'calendar#calendar', id: calendarId, summary: c.summary, timeZone: 'UTC' }) : err(405, 'Method not allowed');
    const eventId = m[2] ? decodeURIComponent(m[2]) : null;
    if (!eventId) {
      if (req.method !== 'POST') return err(405, 'Method not allowed');
      const bad = check(req.body);
      if (bad) return bad;
      const id = randomUUID().replace(/-/g, '');
      const ev: GoogleEvent = { ...req.body, id, status: 'confirmed', htmlLink: `https://calendar.google.com/event?eid=${id}`, updated: new Date().toISOString() };
      c.events.set(id, ev);
      return json(200, ev);
    }
    const ev = c.events.get(eventId);
    if (!ev) return err(404, 'Not Found', 'notFound');
    if (ev.status === 'cancelled') return err(410, 'Resource has been deleted', 'deleted');
    if (req.method === 'GET') return json(200, ev);
    if (req.method === 'PATCH') {
      const next = { ...ev, ...req.body, id: ev.id, status: ev.status, htmlLink: ev.htmlLink, updated: new Date().toISOString() };
      const bad = check(next);
      if (bad) return bad;
      c.events.set(eventId, next);
      return json(200, next);
    }
    if (req.method === 'DELETE') {
      ev.status = 'cancelled';
      return { status: 204 };
    }
    return err(405, 'Method not allowed');
  };

  const fake = (await startFake({ clientId: opts.clientId ?? 'google-client', clientSecret: opts.clientSecret ?? 'google-secret', clientAuth: 'body', tokenPrefix: 'Bearer', ttl: 3599 }, api)) as GoogleCalendarFake;
  fake.calendars = calendars;
  fake.owner = owner;
  fake.events = (calendarId = owner) => [...(calendars.get(calendarId)?.events.values() ?? [])].filter((e) => e.status === 'confirmed');
  fake.deleteInGoogle = (calendarId, eventId) => {
    const ev = calendars.get(calendarId)?.events.get(eventId);
    if (ev) ev.status = 'cancelled';
  };
  return fake;
}
