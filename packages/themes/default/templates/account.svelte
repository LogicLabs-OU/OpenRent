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
  import * as Card from '@openrent/ui/card';
  import * as Field from '@openrent/ui/field';
  import * as Empty from '@openrent/ui/empty';
  import { Input } from '@openrent/ui/input';
  import { Switch } from '@openrent/ui/switch';
  import { Button } from '@openrent/ui/button';
  import { Badge } from '@openrent/ui/badge';
  import { Spinner } from '@openrent/ui/spinner';
  import CalendarDaysIcon from '@lucide/svelte/icons/calendar-days';
  import LogOutIcon from '@lucide/svelte/icons/log-out';
  import { toast } from 'svelte-sonner';
  import CancelRequest from '../snippets/CancelRequest.svelte';
  import Documents from '../snippets/Documents.svelte';
  import ExtendRequest from '../snippets/ExtendRequest.svelte';

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
  <Card.Root data-testid="account-order">
    <Card.Header>
      <Card.Title class="flex flex-wrap items-center gap-2">
        <a class="underline-offset-4 hover:underline" href={rt.url.order(o.token)}
          >{rt.t('account.booking', { number: o.number })}</a
        >
        <Badge variant={o.status === 'cancelled' ? 'destructive' : 'secondary'}>{status(o)}</Badge>
      </Card.Title>
      <Card.Description class="flex items-center gap-1.5"
        ><CalendarDaysIcon class="size-4" />{rt.format.datetime(o.starts_at)} – {rt.format.datetime(
          o.ends_at,
        )}</Card.Description
      >
      <Card.Action class="text-base font-semibold tabular-nums">{rt.format.money(o.total)}</Card.Action>
    </Card.Header>
    <Card.Content class="flex flex-col gap-3">
      <Documents documents={o.documents} attachments={o.attachments} />
      <div class="flex flex-wrap items-center gap-3">
        <Button size="sm" href={rt.url.order(o.token)}>{rt.t('account.view')}</Button>
        <CancelRequest
          order={{ id: o.id }}
          request={o.cancellation_request}
          can={o.can_request_cancellation}
        />
        <ExtendRequest order={{ id: o.id }} endsAt={o.ends_at} request={o.extension_request} can={!!o.can_request_extension} />
      </div>
    </Card.Content>
  </Card.Root>
{/snippet}

<div class="flex flex-col gap-8">
  <div class="flex flex-wrap items-end justify-between gap-4">
    <div>
      <h1 class="text-3xl font-semibold tracking-tight">{rt.t('account.title')}</h1>
      <p class="text-muted-foreground">{rt.t('account.signed_in_as', { email: a.email })}</p>
    </div>
    <Button variant="outline" onclick={logout}><LogOutIcon />{rt.t('account.sign_out')}</Button>
  </div>
  <div class="grid gap-8 lg:grid-cols-[1.6fr_1fr]">
    <div class="flex flex-col gap-6">
      <!-- What is owed, business account, insurance and signatures (theme API 1.7). -->
      <rt.components.Slot name="account.extra" />
      <section class="flex flex-col gap-3" aria-labelledby="or-upcoming">
        <h2 id="or-upcoming" class="text-xl font-semibold">{rt.t('account.upcoming')}</h2>
        {#each upcoming as o (o.id)}{@render booking(o)}{:else}
          <Empty.Root class="border">
            <Empty.Header><Empty.Title>{rt.t('account.no_upcoming')}</Empty.Title></Empty.Header>
            <Empty.Content><Button href={rt.url.home()}>{rt.t('nav.all')}</Button></Empty.Content>
          </Empty.Root>
        {/each}
      </section>
      {#if past.length}
        <section class="flex flex-col gap-3" aria-labelledby="or-past">
          <h2 id="or-past" class="text-xl font-semibold">{rt.t('account.past')}</h2>
          {#each past as o (o.id)}{@render booking(o)}{/each}
        </section>
      {/if}
    </div>
    <Card.Root class="h-fit">
      <Card.Header>
        <Card.Title>{rt.t('account.profile')}</Card.Title>
        <Card.Description>{rt.t('account.profile_hint')}</Card.Description>
      </Card.Header>
      <Card.Content>
        <form id="or-profile" onsubmit={save}>
          <Field.Group>
            <Field.Field data-invalid={!!errors.name || undefined}>
              <Field.Label for="or-acc-name">{rt.t('checkout.name')}</Field.Label>
              <Input
                id="or-acc-name"
                autocomplete="name"
                bind:value={profile.name}
                aria-invalid={!!errors.name}
              />
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
              <Field.Label for="or-acc-news" class="font-normal">{rt.t('account.marketing')}</Field.Label>
            </Field.Field>
          </Field.Group>
        </form>
      </Card.Content>
      <Card.Footer
        ><Button type="submit" form="or-profile" disabled={saving}
          >{#if saving}<Spinner />{/if}{rt.t('account.save')}</Button
        ></Card.Footer
      >
    </Card.Root>
  </div>
</div>
