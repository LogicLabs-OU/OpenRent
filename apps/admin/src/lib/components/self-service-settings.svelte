<script lang="ts">
  import { onMount } from 'svelte';
  import * as Card from '@openrent/ui/card';
  import * as Field from '@openrent/ui/field';
  import { NativeSelect, NativeSelectOption } from '@openrent/ui/native-select';
  import { Input } from '@openrent/ui/input';
  import { Button } from '@openrent/ui/button';
  import { Skeleton } from '@openrent/ui/skeleton';
  import { Spinner } from '@openrent/ui/spinner';
  import PlusIcon from '@lucide/svelte/icons/plus';
  import Trash2Icon from '@lucide/svelte/icons/trash-2';
  import { api, t, toast, notifyError, fieldErrors } from '#lib';

  /**
   * Cancellation refunds by how long before pickup, and what customers may change themselves in their
   * account (ADR 0012): cancel, or ask to; move their dates, ask to, or neither.
   */
  type Tier = { hours_before: number; refund_pct: number };
  let tiers = $state<Tier[] | null>(null);
  let ss = $state({ cancel: 'request', cancel_until_hours: 48, change_dates: 'off', change_until_hours: 48 });
  let errors = $state<Record<string, string>>({});
  let saving = $state(false);

  onMount(async () => {
    try {
      const s = await api.get('/tenant/settings');
      tiers = s.cancellation_policy.map((x: Tier) => ({ ...x }));
      ss = { ...s.self_service };
    } catch (e) {
      notifyError(e);
    }
  });

  async function save() {
    if (!tiers) return;
    saving = true;
    errors = {};
    try {
      const sorted = [...tiers].sort((a, b) => b.hours_before - a.hours_before);
      const r = await api.patch('/tenant/settings', { cancellation_policy: sorted.map((x) => ({ hours_before: Number(x.hours_before), refund_pct: Number(x.refund_pct) })), self_service: { ...ss, cancel_until_hours: Number(ss.cancel_until_hours), change_until_hours: Number(ss.change_until_hours) } });
      tiers = r.cancellation_policy;
      toast.success(t('common.saved'));
    } catch (e) {
      errors = fieldErrors(e);
      if (!Object.keys(errors).length) notifyError(e);
    } finally {
      saving = false;
    }
  }
</script>

<Card.Root data-testid="self-service-settings">
  <Card.Header><Card.Title>{t('selfservice.title')}</Card.Title><Card.Description>{t('selfservice.hint')}</Card.Description></Card.Header>
  {#if !tiers}
    <Card.Content><Skeleton class="h-40" /></Card.Content>
  {:else}
    <Card.Content class="flex flex-col gap-6">
      <Field.Set>
        <Field.Legend variant="label">{t('settings.cancellation')}</Field.Legend>
        <Field.Description>{t('selfservice.tiers_hint')}</Field.Description>
        {#if errors.cancellation_policy}<Field.Error>{errors.cancellation_policy}</Field.Error>{/if}
        {#each tiers as tier, i (i)}
          <div class="flex flex-wrap items-end gap-3">
            <Field.Field class="w-40" data-invalid={!!errors[`cancellation_policy.${i}.hours_before`] || undefined}>
              <Field.Label for="tier-h-{i}">{t('selfservice.hours_before')}</Field.Label>
              <Input id="tier-h-{i}" type="number" min="0" bind:value={tier.hours_before} />
            </Field.Field>
            <Field.Field class="w-40" data-invalid={!!errors[`cancellation_policy.${i}.refund_pct`] || undefined}>
              <Field.Label for="tier-p-{i}">{t('selfservice.refund_pct')}</Field.Label>
              <Input id="tier-p-{i}" type="number" min="0" max="100" bind:value={tier.refund_pct} />
            </Field.Field>
            <Button variant="ghost" size="icon-sm" aria-label={t('selfservice.remove_tier', { n: i + 1 })} disabled={tiers.length === 1} onclick={() => tiers!.splice(i, 1)}><Trash2Icon /></Button>
            {#if errors[`cancellation_policy.${i}.hours_before`] || errors[`cancellation_policy.${i}.refund_pct`]}<Field.Error class="w-full">{errors[`cancellation_policy.${i}.hours_before`] ?? errors[`cancellation_policy.${i}.refund_pct`]}</Field.Error>{/if}
          </div>
        {/each}
        <div><Button variant="outline" size="sm" disabled={tiers.length >= 8} onclick={() => tiers!.push({ hours_before: 0, refund_pct: 0 })}><PlusIcon />{t('selfservice.add_tier')}</Button></div>
      </Field.Set>
      <Field.Group class="grid gap-4 sm:grid-cols-2">
        <Field.Field>
          <Field.Label for="ss-cancel">{t('selfservice.cancel_mode')}</Field.Label>
          <NativeSelect id="ss-cancel" bind:value={ss.cancel}>
            <NativeSelectOption value="request">{t('selfservice.cancel_request')}</NativeSelectOption>
            <NativeSelectOption value="self">{t('selfservice.cancel_self')}</NativeSelectOption>
          </NativeSelect>
        </Field.Field>
        <Field.Field data-invalid={!!errors['self_service.cancel_until_hours'] || undefined}>
          <Field.Label for="ss-cancel-h">{t('selfservice.until_hours')}</Field.Label>
          <Input id="ss-cancel-h" type="number" min="0" max="720" disabled={ss.cancel !== 'self'} bind:value={ss.cancel_until_hours} />
          {#if errors['self_service.cancel_until_hours']}<Field.Error>{errors['self_service.cancel_until_hours']}</Field.Error>{/if}
        </Field.Field>
        <Field.Field>
          <Field.Label for="ss-change">{t('selfservice.change_mode')}</Field.Label>
          <NativeSelect id="ss-change" bind:value={ss.change_dates}>
            <NativeSelectOption value="off">{t('selfservice.change_off')}</NativeSelectOption>
            <NativeSelectOption value="request">{t('selfservice.change_request')}</NativeSelectOption>
            <NativeSelectOption value="self">{t('selfservice.change_self')}</NativeSelectOption>
          </NativeSelect>
        </Field.Field>
        <Field.Field data-invalid={!!errors['self_service.change_until_hours'] || undefined}>
          <Field.Label for="ss-change-h">{t('selfservice.until_hours')}</Field.Label>
          <Input id="ss-change-h" type="number" min="0" max="720" disabled={ss.change_dates === 'off'} bind:value={ss.change_until_hours} />
          {#if errors['self_service.change_until_hours']}<Field.Error>{errors['self_service.change_until_hours']}</Field.Error>{/if}
        </Field.Field>
      </Field.Group>
    </Card.Content>
    <Card.Footer><Button onclick={save} disabled={saving}>{#if saving}<Spinner />{/if}{t('common.save')}</Button></Card.Footer>
  {/if}
</Card.Root>
