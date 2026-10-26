<script lang="ts" module>
  export interface ThemeSetting {
    id: string;
    type:
      | 'color'
      | 'font'
      | 'image'
      | 'text'
      | 'textarea'
      | 'select'
      | 'range'
      | 'checkbox'
      | 'link'
      | 'product'
      | 'collection';
    label: string;
    default?: unknown;
    options?: { value: string; label: string }[];
    min?: number;
    max?: number;
    step?: number;
    info?: string;
  }
</script>

<script lang="ts">
  import * as Field from '@openrent/ui/field';
  import * as InputGroup from '@openrent/ui/input-group';
  import { NativeSelect, NativeSelectOption } from '@openrent/ui/native-select';
  import { Input } from '@openrent/ui/input';
  import { Textarea } from '@openrent/ui/textarea';
  import { Switch } from '@openrent/ui/switch';
  import { Slider } from '@openrent/ui/slider';

  /** One field of a theme's settings_schema (theme settings, sections and blocks). */
  let {
    setting: s,
    value = $bindable(),
    error,
    uid,
  }: { setting: ThemeSetting; value: unknown; error?: string; uid: string } = $props();
  const id = $derived(`ts-${uid}-${s.id}`);
</script>

<Field.Field
  data-invalid={!!error || undefined}
  orientation={s.type === 'checkbox' ? 'horizontal' : 'vertical'}
>
  {#if s.type === 'checkbox'}
    <Switch {id} checked={!!value} onCheckedChange={(v) => (value = v)} />
    <Field.Label for={id}>{s.label}</Field.Label>
  {:else}
    <Field.Label for={id}>{s.label}</Field.Label>
    {#if s.type === 'color'}
      <InputGroup.Root class="w-56">
        <InputGroup.Addon>
          <input
            type="color"
            class="size-6 cursor-pointer rounded border-0 bg-transparent p-0"
            value={(value as string) || '#0e7490'}
            oninput={(e) => (value = (e.currentTarget as HTMLInputElement).value)}
            aria-label={s.label}
          />
        </InputGroup.Addon>
        <InputGroup.Input
          {id}
          placeholder="#0e7490"
          value={(value as string) ?? ''}
          oninput={(e) => (value = (e.currentTarget as HTMLInputElement).value || null)}
          aria-invalid={!!error}
        />
      </InputGroup.Root>
    {:else if s.type === 'textarea'}
      <Textarea
        {id}
        value={(value as string) ?? ''}
        oninput={(e) => (value = (e.currentTarget as HTMLTextAreaElement).value)}
        aria-invalid={!!error}
      />
    {:else if s.type === 'select'}
      <NativeSelect
        {id}
        class="w-full sm:w-72"
        value={(value as string) ?? ''}
        onchange={(e) => (value = (e.currentTarget as HTMLSelectElement).value)}
      >
        {#each s.options ?? [] as o (o.value)}<NativeSelectOption value={o.value}
            >{o.label}</NativeSelectOption
          >{/each}
      </NativeSelect>
    {:else if s.type === 'range'}
      <div class="flex items-center gap-4">
        <Slider
          type="single"
          {id}
          class="max-w-72"
          min={s.min ?? 0}
          max={s.max ?? 100}
          step={s.step ?? 1}
          value={Number(value ?? s.min ?? 0)}
          onValueChange={(v: number) => (value = v)}
        />
        <span class="w-10 text-sm tabular-nums">{value}</span>
      </div>
    {:else}
      <Input
        {id}
        type={s.type === 'link' || s.type === 'image' ? 'url' : 'text'}
        value={(value as string) ?? ''}
        oninput={(e) => (value = (e.currentTarget as HTMLInputElement).value)}
        aria-invalid={!!error}
      />
    {/if}
  {/if}
  {#if error}<Field.Error>{error}</Field.Error>{:else if s.info}<Field.Description>{s.info}</Field.Description
    >{/if}
</Field.Field>
