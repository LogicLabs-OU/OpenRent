<script lang="ts">
  import {
    getRuntime,
    RuntimeError,
    LOCALE_NAMES,
    type AccountData,
    type AccountOrder,
    type Locale,
  } from '@openrent/theme-sdk';
  import { NativeSelect, NativeSelectOption } from '@openrent/ui/native-select';
  import * as Field from '@openrent/ui/field';
  import { Input } from '@openrent/ui/input';
  import { Switch } from '@openrent/ui/switch';
  import { Button } from '@openrent/ui/button';
  import { Spinner } from '@openrent/ui/spinner';
  import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
  import LogOutIcon from '@lucide/svelte/icons/log-out';
  import { toast } from 'svelte-sonner';
  import CancelRequest from '../snippets/CancelRequest.svelte';
  import Documents from '../snippets/Documents.svelte';
  import ExtendRequest from '../snippets/ExtendRequest.svelte';
  import { box, boxHead, cta, h1, h3, pad } from '../lib/marquee.ts';

  let { data }: { data: AccountData } = $props();
  const rt = getRuntime();
  const a = $derived(data.account);
  const upcoming = $derived(a.orders.filter((o) => o.upcoming));
  const past = $derived(a.orders.filter((o) => !o.upcoming));
  // svelte-ignore state_referenced_locally
  let profile = $state({
    name: data.account.name,
    phone: data.account.phone ?? '',
    locale: data.account.locale ?? '',
    marketing_consent: data.account.marketing_consent,
  });
  let errors = $state<Record<string, string>>({});
  let saving = $state(false);

  const status = (o: AccountOrder) => {
    const s = rt.t(`status.${o.status}`);
    return s === `status.${o.status}` ? o.status : s;
  };

  async function save(e: SubmitEvent) {
    e.preventDefault();
    saving = true;
    errors = {};
    try {
      await rt.account!.updateProfile({
        name: profile.name,
        phone: profile.phone || null,
        locale: profile.locale || null,
        marketing_consent: profile.marketing_consent,
      });
      toast.success(rt.t('account.saved'));
    } catch (err) {
      if (err instanceof RuntimeError && err.status === 422 && Object.keys(err.fields).length)
        errors = err.fields;
      else toast.error((err as Error).message);
    } finally {
      saving = false;
    }
  }

  async function logout() {
    await rt.account!.logout();
    location.assign(rt.url.home());
  }
</script>

{#snippet booking(o: AccountOrder)}
  <article class={box} data-testid="account-order">
    <div class="flex flex-wrap items-center justify-between gap-3 border-b border-(--mq-ink) px-4 py-3 md:px-5">
      <a class="mq-link mq-tight text-[1.75rem] leading-none font-bold uppercase" href={rt.url.order(o.token)}
        >{rt.t('account.booking', { number: o.number })}</a
      >
      <span
        class={[
          'border px-2 py-0.5 text-[0.8125rem] font-semibold uppercase',
          o.status === 'cancelled'
            ? 'border-(--mq-accent-2) bg-(--mq-accent-2) text-(--mq-on-accent-2)'
            : 'border-(--mq-ink)',
        ]}>{status(o)}</span
      >
    </div>
    <div class="flex flex-col gap-4 p-4 md:p-5">
      <div class="flex flex-wrap items-baseline justify-between gap-3">
        <p class="mq-mono text-sm">{rt.format.datetime(o.starts_at)} – {rt.format.datetime(o.ends_at)}</p>
        <p class="mq-mono text-lg font-semibold">{rt.format.money(o.total)}</p>
      </div>
      <Documents documents={o.documents} attachments={o.attachments} />
      <div class="flex flex-wrap items-center gap-3">
        <a
          class="mq-cta flex h-9 items-center gap-2 px-3 text-base font-bold uppercase"
          href={rt.url.order(o.token)}>{rt.t('account.view')}<ArrowRightIcon class="mq-arrow size-4" aria-hidden="true" /></a
        >
        <CancelRequest order={{ id: o.id }} request={o.cancellation_request} can={o.can_request_cancellation} />
        <ExtendRequest
          order={{ id: o.id }}
          endsAt={o.ends_at}
          request={o.extension_request}
          can={!!o.can_request_extension}
        />
      </div>
    </div>
  </article>
{/snippet}

<div class="flex flex-col gap-10">
  <div class="flex flex-wrap items-end justify-between gap-6 border-b border-(--mq-ink) pb-6">
    <div class="flex flex-col gap-3">
      <h1 class={h1}>{rt.t('account.title')}</h1>
      <p class="mq-mono text-sm">{rt.t('account.signed_in_as', { email: a.email })}</p>
    </div>
    <Button variant="outline" class="h-11 border-(--mq-ink) bg-transparent px-4 text-base hover:bg-(--mq-ink) hover:text-(--mq-paper)" onclick={logout}
      ><LogOutIcon />{rt.t('account.sign_out')}</Button
    >
  </div>
  <div class="grid gap-10 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
    <div class="flex min-w-0 flex-col gap-10">
      <!-- What is owed, business account, insurance and signatures (theme API 1.7). -->
      <rt.components.Slot name="account.extra" />
      <section class="flex flex-col gap-4" aria-labelledby="or-upcoming">
        <h2 id="or-upcoming" class={[h3, 'flex items-baseline gap-3']}>
          {rt.t('account.upcoming')}<span class="mq-mono text-base font-normal">{pad(upcoming.length)}</span>
        </h2>
        {#each upcoming as o (o.id)}{@render booking(o)}{:else}
          <div class="flex flex-col items-start gap-5 border border-(--mq-ink) p-6 md:p-8">
            <p class="mq-tight text-[2rem] leading-[0.95] font-bold uppercase">{rt.t('account.no_upcoming')}</p>
            <a class="mq-fill flex h-12 items-center gap-3 border border-(--mq-ink) px-5 text-lg font-bold uppercase" href={rt.url.home()}
              >{rt.t('nav.all')}<ArrowRightIcon class="mq-arrow size-5" aria-hidden="true" /></a
            >
          </div>
        {/each}
      </section>
      {#if past.length}
        <section class="flex flex-col gap-4" aria-labelledby="or-past">
          <h2 id="or-past" class={[h3, 'flex items-baseline gap-3']}>
            {rt.t('account.past')}<span class="mq-mono text-base font-normal">{pad(past.length)}</span>
          </h2>
          {#each past as o (o.id)}{@render booking(o)}{/each}
        </section>
      {/if}
    </div>
    <section class={[box, 'h-fit lg:sticky lg:top-[calc(var(--mq-head)+1rem)]']} aria-labelledby="or-profile-title">
      <h2 id="or-profile-title" class={boxHead}>{rt.t('account.profile')}</h2>
      <form id="or-profile" class="flex flex-col gap-5 p-4 md:p-5" onsubmit={save}>
        <p class="text-muted-foreground text-lg leading-snug uppercase">{rt.t('account.profile_hint')}</p>
        <Field.Group>
          <Field.Field data-invalid={!!errors.name || undefined}>
            <Field.Label for="or-acc-name">{rt.t('checkout.name')}</Field.Label>
            <Input id="or-acc-name" autocomplete="name" bind:value={profile.name} aria-invalid={!!errors.name} />
            {#if errors.name}<Field.Error>{errors.name}</Field.Error>{/if}
          </Field.Field>
          <Field.Field data-invalid={!!errors.phone || undefined}>
            <Field.Label for="or-acc-phone">{rt.t('checkout.phone')}</Field.Label>
            <Input
              id="or-acc-phone"
              type="tel"
              autocomplete="tel"
              bind:value={profile.phone}
              aria-invalid={!!errors.phone}
            />
            {#if errors.phone}<Field.Error>{errors.phone}</Field.Error>{/if}
          </Field.Field>
          {#if (rt.shop.locales?.length ?? 0) > 1}
            <Field.Field>
              <Field.Label for="or-acc-lang">{rt.t('account.language')}</Field.Label>
              <NativeSelect id="or-acc-lang" class="w-full" bind:value={profile.locale}>
                {#each rt.shop.locales ?? [] as l (l)}<NativeSelectOption value={l}
                    >{LOCALE_NAMES[l as Locale] ?? l}</NativeSelectOption
                  >{/each}
              </NativeSelect>
            </Field.Field>
          {/if}
          <Field.Field orientation="horizontal">
            <Switch id="or-acc-news" bind:checked={profile.marketing_consent} />
            <Field.Label for="or-acc-news">{rt.t('account.marketing')}</Field.Label>
          </Field.Field>
        </Field.Group>
      </form>
      <Button type="submit" form="or-profile" class={[cta, 'w-full justify-between border-t border-(--mq-ink)']} disabled={saving}
        >{rt.t('account.save')}{#if saving}<Spinner />{:else}<ArrowRightIcon class="mq-arrow" />{/if}</Button
      >
    </section>
  </div>
</div>
