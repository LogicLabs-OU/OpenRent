<script lang="ts">
  import { page } from '$app/state';
  import * as Field from '@openrent/ui/field';
  import { Input } from '@openrent/ui/input';
  import { Textarea } from '@openrent/ui/textarea';
  import { Checkbox } from '@openrent/ui/checkbox';
  import { Button } from '@openrent/ui/button';
  import { Spinner } from '@openrent/ui/spinner';
  import type { SectionInstance } from '@openrent/theme-sdk';
  import { t } from './i18n/index.ts';

  /**
   * The built-in contact form section: staff get the message as a notice and by email. It works without
   * JavaScript too (the form posts and the page comes back with a notice).
   */
  let { section }: { section: SectionInstance } = $props();
  const locale = $derived(page.data.shop?.locale);
  const tr = (key: Parameters<typeof t>[0]) => t(key, {}, locale);
  const heading = $derived(String(section.settings.heading ?? ''));
  const intro = $derived(String(section.settings.text ?? ''));
  const consentText = $derived(String(section.settings.consent ?? '').trim());
  const uid = $derived(`or-contact-${section.id}`);
  let name = $state('');
  let email = $state('');
  let message = $state('');
  let consent = $state(false);
  let website = $state('');
  let errors = $state<Record<string, string>>({});
  let failed = $state('');
  let sending = $state(false);
  let sent = $state(false);

  async function send(e: SubmitEvent) {
    e.preventDefault();
    sending = true;
    errors = {};
    failed = '';
    try {
      const r = await fetch('/_or/contact', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(locale ? { 'x-or-locale': locale } : {}) },
        body: JSON.stringify({ name, email, message, consent: consent ? consentText : null, consent_required: !!consentText, website }),
      });
      const body = await r.json().catch(() => ({}));
      if (r.ok) sent = true;
      else if (r.status === 422 && body.errors?.length) errors = Object.fromEntries(body.errors.map((x: { field: string; message: string }) => [x.field, x.message]));
      else failed = tr('contact.failed');
    } catch {
      failed = tr('contact.failed');
    } finally {
      sending = false;
    }
  }
</script>

<section class="mx-auto w-full max-w-2xl py-8" aria-labelledby="{uid}-title" data-testid="contact-section">
  {#if heading}<h2 id="{uid}-title" class="mb-2 text-2xl font-semibold tracking-tight">{heading}</h2>{/if}
  {#if intro}<p class="mb-6 whitespace-pre-line opacity-80">{intro}</p>{/if}
  {#if sent}
    <p role="status" class="rounded-lg border p-4" data-testid="contact-sent">{tr('contact.sent')}</p>
  {:else}
    <form method="POST" action="/_or/contact" onsubmit={send} novalidate>
      <input type="hidden" name="back" value={page.url.pathname} />
      <input type="hidden" name="consent_required" value={consentText ? '1' : ''} />
      <Field.Group>
        <Field.Field data-invalid={!!errors.name || undefined}>
          <Field.Label for="{uid}-name">{tr('contact.name')}</Field.Label>
          <Input id="{uid}-name" name="name" autocomplete="name" required maxlength={200} bind:value={name} aria-invalid={!!errors.name} />
          {#if errors.name}<Field.Error>{errors.name}</Field.Error>{/if}
        </Field.Field>
        <Field.Field data-invalid={!!errors.email || undefined}>
          <Field.Label for="{uid}-email">{tr('contact.email')}</Field.Label>
          <Input id="{uid}-email" name="email" type="email" autocomplete="email" required maxlength={254} bind:value={email} aria-invalid={!!errors.email} />
          {#if errors.email}<Field.Error>{errors.email}</Field.Error>{/if}
        </Field.Field>
        <Field.Field data-invalid={!!errors.message || undefined}>
          <Field.Label for="{uid}-message">{tr('contact.message')}</Field.Label>
          <Textarea id="{uid}-message" name="message" required rows={5} maxlength={5000} bind:value={message} aria-invalid={!!errors.message} />
          {#if errors.message}<Field.Error>{errors.message}</Field.Error>{/if}
        </Field.Field>
        <!-- People do not see this field; a bot that fills it is answered as sent and dropped. -->
        <div class="absolute -left-[9999px] h-px w-px overflow-hidden" aria-hidden="true">
          <label for="{uid}-website">{tr('contact.website')}</label>
          <input id="{uid}-website" name="website" tabindex="-1" autocomplete="off" bind:value={website} />
        </div>
        {#if consentText}
          <Field.Field orientation="horizontal" data-invalid={!!errors.consent || undefined}>
            <Checkbox id="{uid}-consent" name="consent" value={consentText} bind:checked={consent} aria-invalid={!!errors.consent} />
            <Field.Label for="{uid}-consent" class="font-normal">{consentText}</Field.Label>
          </Field.Field>
          {#if errors.consent}<Field.Error>{errors.consent}</Field.Error>{/if}
        {/if}
        {#if failed}<p role="alert" class="text-destructive text-sm">{failed}</p>{/if}
        <div><Button type="submit" disabled={sending}>{#if sending}<Spinner />{/if}{tr('contact.send')}</Button></div>
      </Field.Group>
    </form>
  {/if}
</section>
