import { randomUUID } from 'node:crypto';
import { json, startFake, type FakeReply, type FakeRequest, type FakeServer } from '@openrent/accounting-fakes';

/**
 * Microsoft Graph v1.0, the calendar parts: `/me`, `/me/calendars`, events created on the default
 * calendar (`/me/events`) or a given one (`/me/calendars/{id}/events`), and patched or deleted by id
 * under `/me/events/{id}`. As Graph does: `start` and `end` are `{ dateTime, timeZone }` with a local
 * date-time and no offset, the end must come after the start, unknown events answer 404
 * `ErrorItemNotFound`, and DELETE answers 204.
 */
export interface GraphEvent {
  id: string;
  calendarId: string;
  subject?: string;
  body?: { contentType: string; content: string };
  location?: { displayName?: string };
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  webLink: string;
  lastModifiedDateTime: string;
}

export interface GraphCalendarFake extends FakeServer {
  calendars: { id: string; name: string; isDefaultCalendar: boolean }[];
  /** Live events, optionally of one calendar. */
  events(calendarId?: string): GraphEvent[];
  /** Someone deletes the event in Outlook itself. */
  deleteInOutlook(eventId: string): void;
}

const err = (status: number, code: string, message: string): FakeReply => json(status, { error: { code, message } });
const time = (t: any) => (t && typeof t.dateTime === 'string' && typeof t.timeZone === 'string' && !/[zZ]|[+-]\d\d:\d\d$/.test(t.dateTime) ? Date.parse(`${t.dateTime}Z`) : NaN);

export async function startGraphCalendarFake(opts: { clientId?: string; clientSecret?: string; user?: { displayName: string; mail: string } } = {}): Promise<GraphCalendarFake> {
  const user = opts.user ?? { displayName: 'Rental Shop', mail: 'shop@example.com' };
  const calendars = [{ id: 'cal-default', name: 'Calendar', isDefaultCalendar: true }, { id: 'cal-tartu', name: 'Tartu branch', isDefaultCalendar: false }];
  const events = new Map<string, GraphEvent>();

  const check = (b: any): FakeReply | null => {
    const s = time(b?.start);
    const e = time(b?.end);
    if (Number.isNaN(s) || Number.isNaN(e)) return err(400, 'ErrorInvalidRequest', 'start and end need a dateTime without offset and a timeZone.');
    if (e <= s) return err(400, 'ErrorInvalidRequest', 'The end of the event must be after its start.');
    return null;
  };
  const create = (calendarId: string, body: any): FakeReply => {
    const bad = check(body);
    if (bad) return bad;
    const id = `AAMk${randomUUID().replace(/-/g, '')}`;
    const ev: GraphEvent = { ...body, id, calendarId, webLink: `https://outlook.office365.com/owa/?itemid=${id}`, lastModifiedDateTime: new Date().toISOString() };
    events.set(id, ev);
    return json(201, ev);
  };

  const api = (req: FakeRequest): FakeReply => {
    const p = req.path;
    if (p === '/v1.0/me' && req.method === 'GET') return json(200, { id: 'user-1', displayName: user.displayName, mail: user.mail, userPrincipalName: user.mail });
    if (p === '/v1.0/me/calendars' && req.method === 'GET') return json(200, { value: calendars });
    if (p === '/v1.0/me/events' && req.method === 'POST') return create('cal-default', req.body);
    const inCal = /^\/v1\.0\/me\/calendars\/([^/]+)\/events$/.exec(p);
    if (inCal && req.method === 'POST') {
      const id = decodeURIComponent(inCal[1]!);
      return calendars.some((c) => c.id === id) ? create(id, req.body) : err(404, 'ErrorItemNotFound', 'The specified object was not found in the store.');
    }
    const one = /^\/v1\.0\/me\/events\/([^/]+)$/.exec(p);
    if (one) {
      const id = decodeURIComponent(one[1]!);
      const ev = events.get(id);
      if (!ev) return err(404, 'ErrorItemNotFound', 'The specified object was not found in the store.');
      if (req.method === 'GET') return json(200, ev);
      if (req.method === 'PATCH') {
        const next = { ...ev, ...req.body, id, calendarId: ev.calendarId, webLink: ev.webLink, lastModifiedDateTime: new Date().toISOString() };
        const bad = check(next);
        if (bad) return bad;
        events.set(id, next);
        return json(200, next);
      }
      if (req.method === 'DELETE') {
        events.delete(id);
        return { status: 204 };
      }
    }
    return err(400, 'BadRequest', `Unsupported request ${req.method} ${p}`);
  };

  const fake = (await startFake({ clientId: opts.clientId ?? 'graph-client', clientSecret: opts.clientSecret ?? 'graph-secret', clientAuth: 'body', tokenPrefix: 'Bearer', ttl: 3599 }, api)) as GraphCalendarFake;
  fake.calendars = calendars;
  fake.events = (calendarId) => [...events.values()].filter((e) => !calendarId || e.calendarId === calendarId);
  fake.deleteInOutlook = (id) => void events.delete(id);
  return fake;
}
