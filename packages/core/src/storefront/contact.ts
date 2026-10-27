import type { Ctx } from '../context.ts';
import { invalid, type FieldError } from '../errors.ts';
import { t } from '../i18n/index.ts';
import { sha256 } from '../ids.ts';
import { notifyStaff } from '../notifications/index.ts';

export interface ContactInput {
  name: string;
  email: string;
  message: string;
  /** The consent text the visitor ticked, when the form asks for consent. */
  consent?: string | null;
  consent_required?: boolean;
  /** A field people do not see: anything in it means a bot filled the form. */
  website?: string | null;
}

/**
 * A message from the storefront's contact form: staff get it as a notice and by email, with the
 * address to reply to. Nothing else is stored. A form a bot filled is answered as sent and dropped.
 */
export async function sendContactMessage(ctx: Ctx, input: ContactInput) {
  if (input.website?.trim()) return { object: 'contact_message', sent: true };
  const name = input.name?.trim() ?? '';
  const email = input.email?.trim() ?? '';
  const message = input.message?.trim() ?? '';
  const errors: FieldError[] = [];
  if (!name) errors.push({ field: 'name', code: 'required', message: t('contact.name_required') });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push({ field: 'email', code: 'invalid', message: t('error.field.invalid_email') });
  if (!message) errors.push({ field: 'message', code: 'required', message: t('contact.message_required') });
  if (input.consent_required && !input.consent?.trim()) errors.push({ field: 'consent', code: 'required', message: t('contact.consent_required') });
  if (errors.length) throw invalid(t('contact.invalid'), errors);
  // The same message sent twice (a double click, a reload) reaches staff once.
  const dedupe = `contact:${sha256(`${email.toLowerCase()}\n${message}`).slice(0, 32)}`;
  await notifyStaff(ctx, null, 'staff_contact_message', { name: name.slice(0, 120), email: email.slice(0, 254), message: message.slice(0, 5000), excerpt: message.replace(/\s+/g, ' ').slice(0, 140), consent: input.consent?.trim().slice(0, 300) || '' }, dedupe);
  return { object: 'contact_message', sent: true };
}
