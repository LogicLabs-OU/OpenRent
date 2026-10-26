/* global customElements, HTMLElement */
customElements.define(
  'e2e-extras-dashboard-widget',
  class extends HTMLElement {
    connectedCallback() {
      this.textContent = 'Hello from the e2e plugin';
    }
  },
);
