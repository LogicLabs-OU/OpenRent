import type { Preview } from '@storybook/svelte-vite';
import '../src/app.css';

const preview: Preview = {
  parameters: {
    layout: 'padded',
    // The same rules the admin's e2e checks use.
    a11y: { options: { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } } },
  },
};
export default preview;
