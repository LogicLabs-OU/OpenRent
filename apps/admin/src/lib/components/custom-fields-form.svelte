<script lang="ts">
  import { onMount } from 'svelte';
  import * as Field from '@openrent/ui/field';
  import * as NativeSelect from '@openrent/ui/native-select';
  import { Input } from '@openrent/ui/input';
  import { Textarea } from '@openrent/ui/textarea';
  import { Checkbox } from '@openrent/ui/checkbox';
  import { Switch } from '@openrent/ui/switch';
  import { api, t, getLocale, notifyError } from '#lib';

  /**
   * Inputs for the shop's custom fields on one record (FR-CAT-1). `errors` takes the API's field errors;
   * those for `custom_fields.<key>` show next to their input.
   */
  let { entity, value = $bindable({}), errors = {} }: { entity: 'product' | 'stock_item' | 'customer' | 'order'; value?: Record<string, any>; errors?: Record<string, string> } = $props();
  let defs = $state<any[]>([]);

  onMount(() => {
    api
      .get(`/custom_field_definitions?filter[entity]=${entity}&limit=200`)
      .then((r) => (defs = r.data))
      .catch(notifyError);
  });

  const label = (labels: Record<string, string>, fallback: string) => labels?.[getLocale()] || labels?.en || Object.values(labels ?? {})[0] || fallback;
  const set = (key: string, v: unknown) => (value = { ...value, [key]: v === '' ? null : v });
  const toggle = (key: string, option: string, on: boolean) => {
    const cur: string[] = Array.isArray(value[key]) ? value[key] : [];
    set(key, on ? [...new Set([...cur, option])] : cur.filter((x) => x !== option));
  };
</script>

{#if defs.length}
  <Field.Group class="gap-4" data-testid="custom-fields">
    {#each defs as d (d.id)}
      {@const id = `cf-${entity}-${d.key}`}
      {@const err = errors[`custom_fields.${d.key}`]}
      {@const name = label(d.labels, d.key)}
      <Field.Field data-invalid={!!err || undefined} orientation={d.type === 'boolean' ? 'horizontal' : 'vertical'}>
        {#if d.type === 'boolean'}
          <Switch {id} checked={!!value[d.key]} onCheckedChange={(v) => set(d.key, v)} />
          <Field.Label for={id} class="font-normal">{name}</Field.Label>
        {:else}
          <Field.Label for={id}>{name}{d.required ? ' *' : ''}</Field.Label>
          {#if d.type === 'textarea'}
            <Textarea {id} value={value[d.key] ?? ''} aria-invalid={!!err} oninput={(e) => set(d.key, (e.currentTarget as HTMLTextAreaElement).value)} />
          {:else if d.type === 'select'}
            <NativeSelect.Root {id} class="w-full" value={value[d.key] ?? ''} aria-invalid={!!err} onchange={(e) => set(d.key, (e.currentTarget as HTMLSelectElement).value)}>
              <NativeSelect.Option value="">—</NativeSelect.Option>
              {#each d.options as o (o.value)}<NativeSelect.Option value={o.value}>{label(o.labels, o.value)}</NativeSelect.Option>{/each}
            </NativeSelect.Root>
          {:else if d.type === 'multiselect'}
            <div class="flex flex-wrap gap-x-4 gap-y-2" role="group" aria-labelledby={id}>
              {#each d.options as o (o.value)}
                <label class="flex items-center gap-2 text-sm"><Checkbox checked={Array.isArray(value[d.key]) && value[d.key].includes(o.value)} onCheckedChange={(v) => toggle(d.key, o.value, !!v)} />{label(o.labels, o.value)}</label>
              {/each}
            </div>
          {:else}
            <Input
              {id}
              type={d.type === 'number' ? 'number' : d.type === 'date' ? 'date' : d.type === 'url' ? 'url' : 'text'}
              step={d.type === 'number' ? 'any' : undefined}
              value={value[d.key] ?? ''}
              aria-invalid={!!err}
              oninput={(e) => set(d.key, d.type === 'number' ? ((e.currentTarget as HTMLInputElement).value === '' ? null : Number((e.currentTarget as HTMLInputElement).value)) : (e.currentTarget as HTMLInputElement).value)}
            />
          {/if}
        {/if}
        {#if err}<Field.Error>{err}</Field.Error>{:else if label(d.help, '')}<Field.Description>{label(d.help, '')}</Field.Description>{/if}
      </Field.Field>
    {/each}
  </Field.Group>
{/if}
