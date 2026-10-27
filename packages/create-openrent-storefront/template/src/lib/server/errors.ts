import { error, fail } from '@sveltejs/kit';
import { OpenRentError } from '@openrent/sdk';

/** An API refusal as a form failure: the message, and messages per field for the form to show. */
export function refused(e: unknown, values: Record<string, unknown> = {}) {
  if (!(e instanceof OpenRentError)) throw e;
  const fields: Record<string, string> = {};
  for (const x of e.problem.errors ?? []) if (x?.field && !fields[x.field]) fields[x.field] = x.message;
  if (e.status >= 500) error(503, e.message);
  return fail(e.status === 409 || e.status === 422 ? e.status : 400, { message: e.message, fields, values });
}
