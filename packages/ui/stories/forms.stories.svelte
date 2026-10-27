<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import * as Field from '../src/components/ui/field/index.js';
  import { Input } from '../src/components/ui/input/index.js';
  import { Textarea } from '../src/components/ui/textarea/index.js';
  import { Checkbox } from '../src/components/ui/checkbox/index.js';
  import { Switch } from '../src/components/ui/switch/index.js';
  import * as RadioGroup from '../src/components/ui/radio-group/index.js';
  import { NativeSelect, NativeSelectOption } from '../src/components/ui/native-select/index.js';
  import { Slider } from '../src/components/ui/slider/index.js';
  import * as InputGroup from '../src/components/ui/input-group/index.js';
  import { Label } from '../src/components/ui/label/index.js';

  const { Story } = defineMeta({ title: 'Forms/Fields' });
</script>

<Story name="Text fields">
  <Field.Group class="max-w-md">
    <Field.Field>
      <Field.Label for="s-name">Name</Field.Label>
      <Input id="s-name" value="Sea kayak" />
      <Field.Description>Shown in the storefront and on documents.</Field.Description>
    </Field.Field>
    <Field.Field data-invalid>
      <Field.Label for="s-email">Email</Field.Label>
      <Input id="s-email" type="email" value="not-an-email" aria-invalid="true" aria-describedby="s-email-error" />
      <Field.Error id="s-email-error">Enter a valid email address</Field.Error>
    </Field.Field>
    <Field.Field>
      <Field.Label for="s-notes">Notes</Field.Label>
      <Textarea id="s-notes" placeholder="Anything the warehouse should know" />
    </Field.Field>
  </Field.Group>
</Story>

<Story name="Choices">
  <Field.Group class="max-w-md">
    <Field.Field orientation="horizontal">
      <Checkbox id="s-terms" checked />
      <Field.Label for="s-terms" class="font-normal">I accept the rental terms</Field.Label>
    </Field.Field>
    <Field.Field orientation="horizontal">
      <Switch id="s-active" checked />
      <Field.Label for="s-active" class="font-normal">Active</Field.Label>
    </Field.Field>
    <Field.Set>
      <Field.Legend variant="label">Deposit</Field.Legend>
      <RadioGroup.Root value="percent">
        <div class="flex items-center gap-2"><RadioGroup.Item value="none" id="s-d-none" /><Label for="s-d-none">None</Label></div>
        <div class="flex items-center gap-2"><RadioGroup.Item value="percent" id="s-d-pct" /><Label for="s-d-pct">A share of the rental</Label></div>
      </RadioGroup.Root>
    </Field.Set>
    <Field.Field>
      <Field.Label for="s-unit">Per</Field.Label>
      <NativeSelect id="s-unit" class="w-40">
        <NativeSelectOption value="day">Day</NativeSelectOption>
        <NativeSelectOption value="week">Week</NativeSelectOption>
      </NativeSelect>
    </Field.Field>
  </Field.Group>
</Story>

<Story name="Slider and input group">
  <Field.Group class="max-w-md">
    <Field.Field>
      <Field.Label id="s-radius-label">Radius</Field.Label>
      <Slider type="single" value={40} max={100} aria-labelledby="s-radius-label" />
    </Field.Field>
    <Field.Field>
      <Field.Label for="s-price">Price</Field.Label>
      <InputGroup.Root>
        <InputGroup.Addon><InputGroup.Text>€</InputGroup.Text></InputGroup.Addon>
        <InputGroup.Input id="s-price" value="25.00" />
      </InputGroup.Root>
    </Field.Field>
  </Field.Group>
</Story>
