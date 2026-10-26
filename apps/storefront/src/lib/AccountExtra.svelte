<script lang="ts">
  import { page } from '$app/state';
  import { invalidateAll } from '$app/navigation';
  import * as Card from '@openrent/ui/card';
  import * as Field from '@openrent/ui/field';
  import { Input } from '@openrent/ui/input';
  import { Button } from '@openrent/ui/button';
  import { Spinner } from '@openrent/ui/spinner';
  import { Switch } from '@openrent/ui/switch';
  import { getRuntime } from '@openrent/theme-sdk';
  import { t } from './i18n/index.ts';

  /**
   * The account page's portal extras (FR-CUS-6), shown by the `account.extra` slot in every theme: what
   * is left to pay with a button to pay it, the business account's terms (FR-CUS-7), insurance
   * certificates the customer uploads (FR-PAY-8), documents waiting for a signature, and booking updates
   * by SMS or WhatsApp when the shop sends them (FR-NOT-4).
   */
  type Money = { amount: number; currency: string };
  const rt = getRuntime();
  const data = $derived(page.data.portal as { me: any } | null);
  const locale = $derived(page.data.shop?.locale);
  const tr = (key: Parameters<typeof t>[0], params: Record<string, string | number> = {}) => t(key, params, locale);
  const money = (m: Money) => new Intl.NumberFormat(locale, { style: 'currency', currency: m.currency }).format(m.amount / 100);
  const owing = $derived((data?.me.owing ?? []) as { id: string; number: number; balance: Money }[]);
  let paying = $state<string | null>(null);
  let payError = $state('');
  let uploading = $state(false);
  let uploadError = $state('');
  let label = $state('');
  let fileInput = $state<HTMLInputElement | null>(null);
  // Shown at once; the page's own data catches up in the background.
  let added = $state<{ id: string; label: string }[]>([]);
  const texts = $derived((['sms', 'whatsapp'] as const).filter((k) => page.data.messaging?.[k]));
  let optIns = $state<Record<string, boolean>>({});
  const optedIn = (k: 'sms' | 'whatsapp') => optIns[k] ?? !!data?.me[`${k}_opt_in`];
  let textError = $state('');

  async function setText(k: 'sms' | 'whatsapp', on: boolean) {
    textError = '';
    optIns = { ...optIns, [k]: on };
    try {
      const res = await fetch('/_or/account/profile', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ [`${k}_opt_in`]: on }) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? res.statusText);
    } catch (e) {
      optIns = { ...optIns, [k]: !on };
      textError = (e as Error).message;
    }
  }
  const insurance = $derived([...(data?.me.insurance ?? []), ...added.filter((a) => !(data?.me.insurance ?? []).some((d: any) => d.id === a.id))]);

  async function pay(id: string) {
    paying = id;
    payError = '';
    try {
      const res = await fetch('/_or/account/pay', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ order_id: id }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message);
      window.location.href = body.order_url;
    } catch (e) {
      payError = (e as Error).message;
      paying = null;
    }
  }

  async function upload(e: SubmitEvent) {
    e.preventDefault();
    uploadError = '';
    const file = fileInput?.files?.[0];
    if (!file) return (uploadError = tr('account.insurance.choose'));
    uploading = true;
    try {
      const form = new FormData();
      form.set('label', label);
      form.set('file', file);
      const res = await fetch('/_or/account/insurance', { method: 'POST', body: form });
      const body = await res.json();
      if (!res.ok) throw new Error(body.errors?.[0]?.message ?? body.message);
      added = [...added, { id: body.id, label: body.label }];
      label = '';
      if (fileInput) fileInput.value = '';
      void invalidateAll();
    } catch (err) {
      uploadError = (err as Error).message;
    } finally {
      uploading = false;
    }
  }
</script>

{#if data}
  <div class="flex flex-col gap-4" data-slot="account.extra" data-testid="account-extra">
    {#if owing.length}
      <Card.Root data-testid="account-owing">
        <Card.Header><Card.Title>{tr('account.owed.title')}</Card.Title></Card.Header>
        <Card.Content class="flex flex-col gap-3">
          {#each owing as o (o.id)}
            <div class="flex flex-wrap items-center justify-between gap-3">
              <span>{tr('account.owed.booking', { number: o.number })}</span>
              <Button size="sm" onclick={() => pay(o.id)} disabled={!!paying}>{#if paying === o.id}<Spinner />{/if}{tr('account.owed.pay', { amount: money(o.balance) })}</Button>
            </div>
          {/each}
          {#if payError}<p class="text-sm text-destructive" role="alert">{payError}</p>{/if}
        </Card.Content>
      </Card.Root>
    {/if}
    {#if data.me.b2b}
      <Card.Root data-testid="account-business">
        <Card.Header><Card.Title>{tr('account.business.title')}</Card.Title><Card.Description>{tr('account.business.terms', { days: data.me.b2b.payment_terms_days })}</Card.Description></Card.Header>
        <Card.Content>
          <dl class="grid grid-cols-2 gap-2 text-sm">
            <dt class="opacity-70">{tr('account.business.owed')}</dt><dd class="text-right tabular-nums">{money(data.me.open_balance)}</dd>
            {#if data.me.b2b.available_credit}<dt class="opacity-70">{tr('account.business.credit')}</dt><dd class="text-right tabular-nums">{money(data.me.b2b.available_credit)}</dd>{/if}
          </dl>
        </Card.Content>
      </Card.Root>
    {/if}
    {#if data.me.signature_requests.length}
      <Card.Root data-testid="account-signatures">
        <Card.Header><Card.Title>{tr('account.signatures.title')}</Card.Title></Card.Header>
        <Card.Content class="flex flex-col gap-1 text-sm">
          {#each data.me.signature_requests as s (s.id)}<p>{tr('account.signatures.item', { document: rt.t(`document.${s.document.type}`), number: s.document.number ?? '' })}</p>{/each}
        </Card.Content>
      </Card.Root>
    {/if}
    {#if texts.length}
      <Card.Root data-testid="account-texts">
        <Card.Header><Card.Title>{tr('account.texts.title')}</Card.Title><Card.Description>{data.me.phone ? tr('account.texts.to', { phone: data.me.phone }) : tr('account.texts.no_phone')}</Card.Description></Card.Header>
        <Card.Content class="flex flex-col gap-3">
          {#each texts as k (k)}
            <Field.Field orientation="horizontal">
              <Field.Label for={`or-acc-texts-${k}`} class="flex-1 font-normal">{tr(`checkout.texts.${k}`)}</Field.Label>
              <Switch id={`or-acc-texts-${k}`} checked={optedIn(k)} disabled={!data.me.phone} onCheckedChange={(v) => setText(k, v)} />
            </Field.Field>
          {/each}
          {#if textError}<p class="text-sm text-destructive" role="alert">{textError}</p>{/if}
        </Card.Content>
      </Card.Root>
    {/if}
    <Card.Root data-testid="account-insurance">
      <Card.Header><Card.Title>{tr('account.insurance.title')}</Card.Title><Card.Description>{tr('account.insurance.hint')}</Card.Description></Card.Header>
      <Card.Content class="flex flex-col gap-4">
        {#if insurance.length}
          <ul class="flex flex-col gap-1 text-sm">{#each insurance as d (d.id)}<li>{d.label}</li>{/each}</ul>
        {/if}
        <form class="flex flex-col gap-3" onsubmit={upload}>
          <Field.Field>
            <Field.Label for="or-ins-label">{tr('account.insurance.label')}</Field.Label>
            <Input id="or-ins-label" maxlength={200} bind:value={label} />
          </Field.Field>
          <Field.Field data-invalid={!!uploadError || undefined}>
            <Field.Label for="or-ins-file">{tr('account.insurance.file')}</Field.Label>
            <Input id="or-ins-file" type="file" accept="application/pdf,image/jpeg,image/png,image/webp,image/heic" bind:ref={fileInput} aria-invalid={!!uploadError} />
            {#if uploadError}<Field.Error>{uploadError}</Field.Error>{/if}
          </Field.Field>
          <div><Button type="submit" variant="outline" disabled={uploading}>{#if uploading}<Spinner />{/if}{tr('account.insurance.upload')}</Button></div>
        </form>
      </Card.Content>
    </Card.Root>
  </div>
{/if}
