/* global window, document -- this runs in the shop's storefront. */
// Loads OpenRent's widget script once, from the OpenRent the blocks name, however many blocks a page has.
(function () {
  if (window.__openrentWidget) return;
  var el = document.querySelector('openrent-product[api], openrent-category[api], openrent-book-button[data-api]');
  if (!el) return;
  var api = el.getAttribute('api') || el.getAttribute('data-api');
  if (!/^https?:\/\//.test(api || '')) return;
  window.__openrentWidget = true;
  var s = document.createElement('script');
  s.src = api.replace(/\/$/, '') + '/widget/openrent-widget.js';
  s.setAttribute('data-openrent-api', api);
  document.head.appendChild(s);
})();
