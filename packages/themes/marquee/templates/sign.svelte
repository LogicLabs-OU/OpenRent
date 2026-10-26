<script lang="ts">
  import { getRuntime, RuntimeError, type SignData } from '@openrent/theme-sdk';
  import * as Field from '@openrent/ui/field';
  import * as Alert from '@openrent/ui/alert';
  import { Input } from '@openrent/ui/input';
  import { Button } from '@openrent/ui/button';
  import { Checkbox } from '@openrent/ui/checkbox';
  import { Spinner } from '@openrent/ui/spinner';
  import { SignaturePad } from '@openrent/ui/openrent';
  import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
  import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
  import { toast } from 'svelte-sonner';
  import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
  import { box, boxHead, cta, h2 } from '../lib/marquee.ts';

  /** Signing a document with an emailed code (theme API 1.6). */
  let { data }: { data: SignData } = $props();
  const rt = getRuntime();
  // svelte-ignore state_referenced_locally
  let status = $state(data.status);
  // svelte-ignore state_referenced_locally
  let codeSent = $state(data.code_sent);
  // svelte-ignore state_referenced_locally
  let name = $state(data.signer_name);
  let code = $state('');
  let consent = $state(false);
  let sentTo = $state('');
  let pad: ReturnType<typeof SignaturePad> | undefined = $state();
  let padEmpty = $state(true);
  let errors = $state<Record<string, string>>({});
  let busy = $state(false);

  async function sendCode() {
    busy = true;
    try {
      sentTo = (await rt.signature!.sendCode(data.token)).sent_to;
      codeSent = true;
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      busy = false;
    }
  }

  async function sign(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    errors = {};
    try {
      const blob = !padEmpty && pad ? await pad.toBlob() : null;
      const image = blob ? await new Promise<string>((ok) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.readAsDataURL(blob); }) : null;
      await rt.signature!.sign(data.token, { code, name, image, consent });
      status = 'signed';
    } catch (err) {
      if (err instanceof RuntimeError && Object.keys(err.fields).length) errors = err.fields;
      else toast.error((err as Error).message);
    } finally {
      busy = false;
    }
  }
</script>

<div class="mx-auto flex max-w-4xl flex-col gap-6 py-2">
  <div class="flex flex-col gap-3 border-b border-(--mq-ink) pb-5">
    <h1 class={h2}>{rt.t('sign.title', { title: data.document.title })}</h1>
    <p class="mq-mono text-sm">{data.document.number ?? ''}{#if data.document.issued_at} · {rt.format.date(data.document.issued_at)}{/if}</p>
  </div>
  {#if status === 'signed'}
    <Alert.Root><CircleCheckIcon /><Alert.Title>{rt.t('sign.done_title')}</Alert.Title><Alert.Description>{rt.t('sign.done_hint')}</Alert.Description></Alert.Root>
  {:else if status !== 'pending'}
    <Alert.Root variant="destructive"><CircleAlertIcon /><Alert.Title>{rt.t(`sign.status_${status}`)}</Alert.Title></Alert.Root>
  {:else}
    <iframe title={data.document.title} src={data.document_url} class="mq-crop h-[60vh] w-full border border-(--mq-ink) bg-white" sandbox=""></iframe>
    <section class={box} aria-labelledby="or-sign-title">
      <h2 id="or-sign-title" class={boxHead}>{rt.t('sign.sign_title')}</h2>
      <div class="flex flex-col gap-5 p-4 md:p-6">
        <p class="text-lg leading-snug uppercase">{rt.t('sign.sign_hint', { email: sentTo || data.signer_email })}</p>
        {#if !codeSent}
          <Button class={[cta, 'w-fit gap-6']} onclick={sendCode} disabled={busy}>{rt.t('sign.send_code')}{#if busy}<Spinner />{:else}<ArrowRightIcon class="mq-arrow" />{/if}</Button>
        {:else}
          <form class="flex flex-col gap-4" onsubmit={sign} novalidate data-testid="sign-form">
            <Field.Field data-invalid={!!errors.code || undefined}>
              <Field.Label for="or-sign-code">{rt.t('sign.code')}</Field.Label>
              <Input id="or-sign-code" inputmode="numeric" autocomplete="one-time-code" maxlength={6} class="mq-mono h-12 w-44 text-xl tracking-[0.4em]" bind:value={code} aria-invalid={!!errors.code} />
              {#if errors.code}<Field.Error>{errors.code}</Field.Error>{:else}<Field.Description>{rt.t('sign.code_hint', { email: sentTo || data.signer_email })}</Field.Description>{/if}
            </Field.Field>
            <Field.Field data-invalid={!!errors.name || undefined}>
              <Field.Label for="or-sign-name">{rt.t('sign.name')}</Field.Label>
              <Input id="or-sign-name" autocomplete="name" bind:value={name} aria-invalid={!!errors.name} />
              {#if errors.name}<Field.Error>{errors.name}</Field.Error>{/if}
            </Field.Field>
            <Field.Field data-invalid={!!errors.image || undefined}>
              <SignaturePad bind:this={pad} bind:empty={padEmpty} label={rt.t('sign.draw')} clearLabel={rt.t('sign.clear')} undoLabel={rt.t('sign.undo')} />
              {#if errors.image}<Field.Error>{errors.image}</Field.Error>{:else}<Field.Description>{rt.t('sign.draw_hint')}</Field.Description>{/if}
            </Field.Field>
            <Field.Field orientation="horizontal" data-invalid={!!errors.consent || undefined}>
              <Checkbox id="or-sign-consent" bind:checked={consent} aria-invalid={!!errors.consent} />
              <Field.Content>
                <Field.Label for="or-sign-consent" class="font-normal">{rt.t('sign.consent', { title: data.document.title })}</Field.Label>
                {#if errors.consent}<Field.Error>{errors.consent}</Field.Error>{/if}
              </Field.Content>
            </Field.Field>
            <div class="flex flex-wrap gap-2">
              <Button type="submit" class={[cta, 'gap-6']} disabled={busy}>{rt.t('sign.sign')}{#if busy}<Spinner />{:else}<ArrowRightIcon class="mq-arrow" />{/if}</Button>
              <Button type="button" variant="ghost" class="h-14 text-lg" onclick={sendCode} disabled={busy}>{rt.t('sign.resend')}</Button>
            </div>
          </form>
        {/if}
      </div>
    </section>
  {/if}
</div>
