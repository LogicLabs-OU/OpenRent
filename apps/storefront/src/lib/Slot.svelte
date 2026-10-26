<script lang="ts">
  import { page } from '$app/state';
  import * as Field from '@openrent/ui/field';
  import { Input } from '@openrent/ui/input';
  import { Checkbox } from '@openrent/ui/checkbox';
  import { NativeSelect, NativeSelectOption } from '@openrent/ui/native-select';
  import { Badge } from '@openrent/ui/badge';
  import { checkoutExtra, type CheckoutFieldDef } from './extensions.svelte.ts';

  /**
   * Extension points in theme layouts (FR-PLG-6). `header.after` and `footer.before` show the shop's
   * own HTML (Admin → Themes → Custom code), which the API cleans on save. `checkout.extra_fields`
   * shows plugins' checkout fields and `product.before_add` their product badges (FR-PLG-5).
   */
  let { name, context = {} }: { name: string; context?: Record<string, unknown> } = $props();
  const html = $derived(name === 'header.after' ? page.data.code?.header_html : name === 'footer.before' ? page.data.code?.footer_html : '');
  const fields = $derived<CheckoutFieldDef[]>(name === 'checkout.extra_fields' ? (page.data.extensions?.checkout_fields ?? []) : []);
  const badges = $derived<{ label: string; tone: string }[]>(name === 'product.before_add' ? ((context.product as any)?.badges ?? []) : []);
  const id = (key: string) => `or-extra-${key.replace(/[^a-z0-9]/gi, '-')}`;
  const TONE: Record<string, string> = { success: 'bg-emerald-700 text-white', warning: 'bg-amber-500 text-black' };
</script>

{#if html}
  <div class="or-shop-html" data-slot={name}>{@html html}</div>
{:else if fields.length}
  <Field.Group data-slot={name}>
    {#each fields as f (f.key)}
      {@const err = checkoutExtra.errors[f.key]}
      {#if f.type === 'checkbox'}
        <Field.Field orientation="horizontal" data-invalid={!!err || undefined}>
          <Checkbox id={id(f.key)} checked={checkoutExtra.values[f.key] === true} onCheckedChange={(v) => (checkoutExtra.values[f.key] = v === true)} aria-invalid={!!err} />
          <Field.Label for={id(f.key)} class="font-normal">{f.label}</Field.Label>
        </Field.Field>
      {:else}
        <Field.Field data-invalid={!!err || undefined}>
          <Field.Label for={id(f.key)}>{f.label}</Field.Label>
          {#if f.type === 'select'}
            <NativeSelect id={id(f.key)} class="w-full" value={String(checkoutExtra.values[f.key] ?? '')} onchange={(e) => (checkoutExtra.values[f.key] = (e.currentTarget as HTMLSelectElement).value)} aria-invalid={!!err}>
              <NativeSelectOption value=""></NativeSelectOption>
              {#each f.options as o (o.value)}<NativeSelectOption value={o.value}>{o.label}</NativeSelectOption>{/each}
            </NativeSelect>
          {:else}
            <Input id={id(f.key)} required={f.required} value={String(checkoutExtra.values[f.key] ?? '')} oninput={(e) => (checkoutExtra.values[f.key] = (e.currentTarget as HTMLInputElement).value)} aria-invalid={!!err} />
          {/if}
          {#if f.help && !err}<Field.Description>{f.help}</Field.Description>{/if}
        </Field.Field>
      {/if}
      {#if err}<Field.Error>{err}</Field.Error>{/if}
    {/each}
  </Field.Group>
{:else if badges.length}
  <div class="flex flex-wrap gap-1.5" data-slot={name}>
    {#each badges as b, i (i)}<Badge class={TONE[b.tone] ?? ''} variant={b.tone === 'default' ? 'secondary' : 'default'}>{b.label}</Badge>{/each}
  </div>
{:else}
  <span hidden data-slot={name}></span>
{/if}
