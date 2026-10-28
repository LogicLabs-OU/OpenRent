/**
 * Default document templates (FR-DOC-2). Wording lives in the core catalogues under `doc.*`
 * (`{{t "key"}}`), so one template serves every language. Tenants override per type and locale.
 */

export const BASE_CSS = `
*{box-sizing:border-box}body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,"Hiragino Sans","Noto Sans JP","Noto Sans CJK JP",sans-serif;color:#111827;font-size:13px;line-height:1.5;margin:0;padding:40px}
.head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid var(--brand,#0891b2);padding-bottom:16px;margin-bottom:24px}
.head h1{font-size:22px;margin:0 0 4px}.muted{color:#6b7280}.right{text-align:right}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:24px}
table{width:100%;border-collapse:collapse;margin:8px 0 16px}th,td{padding:8px 6px;border-bottom:1px solid #e5e7eb;text-align:left;vertical-align:top}
th{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#6b7280}td.num,th.num{text-align:right;white-space:nowrap}
.totals{margin-left:auto;width:320px}.totals td{border:none;padding:4px 6px}.totals tr.grand td{font-weight:700;font-size:15px;border-top:2px solid #111827}
.box{border:1px solid #e5e7eb;border-radius:8px;padding:12px 14px}.terms{white-space:pre-wrap;font-size:11px;color:#374151}
.sig{margin-top:40px;display:grid;grid-template-columns:1fr 1fr;gap:40px}.sig div{border-top:1px solid #111827;padding-top:6px}
.badge{display:inline-block;padding:2px 8px;border-radius:999px;background:#ecfeff;color:#155e75;font-size:11px;font-weight:600}
@media print{body{padding:0}}
`;

const HEADER = `<div class="head">
  <div>
    {{#if tenant.branding.logo_url}}<img src="{{tenant.branding.logo_url}}" alt="" style="max-height:48px;margin-bottom:8px">{{/if}}
    <h1>{{document.title}}</h1>
    <div class="muted">{{document.number_label}} {{document.number}} · {{date document.issued_at}}</div>
  </div>
  <div class="right">
    <strong>{{tenant.legal_name}}</strong><br>
    {{#each tenant.address_lines}}{{this}}<br>{{/each}}
    {{#each tenant.tax_ids}}{{this.type}} {{this.value}}<br>{{/each}}
    {{#if tenant.registry_code}}{{t "doc.registry_code" code=tenant.registry_code}}<br>{{/if}}
  </div>
</div>`;

const PARTIES = `<div class="grid">
  <div class="box"><div class="muted">{{t "doc.customer"}}</div><strong>{{customer.name}}</strong><br>{{#if customer.company_name}}{{customer.company_name}}<br>{{/if}}{{#with customer.billing}}{{#if line1}}{{line1}}<br>{{/if}}{{#if line2}}{{line2}}<br>{{/if}}{{#if city}}{{postal_code}} {{city}}<br>{{/if}}{{#if country}}{{country}}<br>{{/if}}{{/with}}{{customer.email}}<br>{{customer.phone}}{{#if customer.tax_id}}<br>{{t "doc.tax_id" id=customer.tax_id}}{{/if}}</div>
  {{#if orders}}<div class="box"><div class="muted">{{t "doc.bookings"}}</div>{{#each orders}}<strong>#{{this.number}}</strong>{{#if this.po_number}} · {{t "doc.po_number" number=this.po_number}}{{/if}}<br>{{/each}}{{t "doc.period" from=(date order.starts_at) to=(date order.ends_at)}}</div>
  {{else}}<div class="box"><div class="muted">{{t "doc.rental"}}</div>{{t "doc.order"}} <strong>#{{order.number}}</strong>{{#if order.po_number}}<br>{{t "doc.po_number" number=order.po_number}}{{/if}}<br>{{t "doc.pickup"}} {{datetime order.starts_at}}<br>{{t "doc.return"}} {{datetime order.ends_at}}<br>{{location.name}}{{#if location.phone}}<br>{{location.phone}}{{/if}}</div>{{/if}}
</div>`;

const LINES = `<table>
  <thead><tr><th>{{t "doc.item"}}</th><th class="num">{{t "doc.qty"}}</th><th class="num">{{t "doc.unit_price"}}</th><th class="num">{{t "doc.discount"}}</th><th class="num">{{t "doc.tax"}}</th><th class="num">{{t "doc.total"}}</th></tr></thead>
  <tbody>
  {{#each lines}}
    <tr><td>{{this.name}}{{#if this.period_label}}<div class="muted">{{this.period_label}}</div>{{/if}}{{#each this.units}}<div class="muted">{{this}}</div>{{/each}}</td>
    <td class="num">{{this.quantity}}</td><td class="num">{{money this.unit_price}}</td><td class="num">{{#if this.discount}}−{{money this.discount}}{{/if}}</td>
    <td class="num">{{percent this.tax_rate_bp}}</td><td class="num">{{money this.total}}</td></tr>
  {{/each}}
  </tbody>
</table>`;

const TOTALS = `<table class="totals">
  <tr><td>{{t "doc.subtotal"}}</td><td class="num">{{money totals.subtotal}}</td></tr>
  {{#if totals.discount}}<tr><td>{{t "doc.discount"}}</td><td class="num">−{{money totals.discount}}</td></tr>{{/if}}
  {{#if totals.fees}}<tr><td>{{t "doc.fees"}}</td><td class="num">{{money totals.fees}}</td></tr>{{/if}}
  {{#each tax_breakdown}}<tr><td>{{t "doc.tax_rate" rate=(percent this.rate_bp)}}</td><td class="num">{{money this.tax}}</td></tr>{{/each}}
  <tr class="grand"><td>{{t "doc.total"}}</td><td class="num">{{money totals.total}}</td></tr>
  {{#if totals.paid}}<tr><td>{{t "doc.paid"}}</td><td class="num">{{money totals.paid}}</td></tr><tr><td>{{t "doc.balance_due"}}</td><td class="num">{{money totals.balance}}</td></tr>{{/if}}
  {{#if totals.deposit}}<tr><td class="muted">{{t "doc.deposit_refundable"}}</td><td class="num muted">{{money totals.deposit}}</td></tr>{{/if}}
</table>{{#if totals.tax_note}}<p class="muted">{{localized totals.tax_note}}</p>{{/if}}`;

/** `title` is a catalogue key for built-in templates. */
export const DEFAULT_TEMPLATES: Record<string, { title: string; body: string }> = {
  quote: {
    title: 'doc.title.quote',
    body: `${HEADER}${PARTIES}${LINES}${TOTALS}<p class="muted">{{t "doc.quote_valid_until" until=(datetime order.quote_expires_at)}}</p><div class="terms">{{terms.text}}</div>`,
  },
  confirmation: {
    title: 'doc.title.confirmation',
    body: `${HEADER}${PARTIES}<p><span class="badge">{{t "doc.confirmed"}}</span></p>${LINES}${TOTALS}{{#if qr_svg}}<div style="width:120px">{{{qr_svg}}}</div><div class="muted">{{t "doc.show_code"}}</div>{{/if}}`,
  },
  contract: {
    title: 'doc.title.contract',
    body: `${HEADER}${PARTIES}${LINES}${TOTALS}<h3>{{t "doc.terms"}}</h3><div class="terms">{{terms.text}}</div>
      {{#if signature}}<p>{{t "doc.accepted_by" name=signature.name date=(datetime signature.signed_at) method=signature.method}}</p>{{/if}}
      {{#if pickup_signature}}<div class="box"><div class="muted">{{t "doc.signed_at_pickup"}}</div><strong>{{pickup_signature.name}}</strong> · {{datetime pickup_signature.signed_at}}{{#if pickup_signature.image}}<br><img src="{{pickup_signature.image}}" alt="{{t "doc.signature"}}" style="max-height:90px;max-width:320px;margin-top:6px">{{/if}}</div>{{/if}}
      <div class="sig"><div>{{t "doc.renter"}}</div><div>{{tenant.name}}</div></div>`,
  },
  pick_list: {
    title: 'doc.title.pick_list',
    body: `${HEADER}<div class="box">{{t "doc.order"}} <strong>#{{order.number}}</strong> · {{customer.name}} · {{t "doc.pickup"}} {{datetime order.starts_at}}</div>
      <table><thead><tr><th>{{t "doc.item"}}</th><th class="num">{{t "doc.qty"}}</th><th>{{t "doc.units"}}</th><th>✓</th></tr></thead><tbody>
      {{#each lines}}<tr><td>{{this.name}}</td><td class="num">{{this.quantity}}</td><td>{{#each this.units}}{{this}}<br>{{else}}<span class="muted">{{t "doc.not_assigned"}}</span>{{/each}}</td><td>☐</td></tr>{{/each}}
      </tbody></table>`,
  },
  delivery_note: {
    title: 'doc.title.delivery_note',
    body: `${HEADER}${PARTIES}${LINES}<div class="sig"><div>{{t "doc.received_by"}}</div><div>{{t "doc.delivered_by"}}</div></div>`,
  },
  invoice: {
    title: 'doc.title.invoice',
    body: `${HEADER}${PARTIES}${LINES}${TOTALS}{{#if document.due_at}}<p><strong>{{t "doc.due_by" date=(date document.due_at)}}</strong></p>{{/if}}{{#if tenant.bank}}<p>{{t "doc.pay_to" iban=tenant.bank.iban}}{{#if tenant.bank.bic}} · BIC {{tenant.bank.bic}}{{/if}}</p>{{/if}}<p class="muted">{{t "doc.invoice_reference" number=document.number}}</p>`,
  },
  credit_note: {
    title: 'doc.title.credit_note',
    body: `${HEADER}${PARTIES}<p>{{t "doc.credit_for" number=credit_for.number}}{{#if reason}}: {{reason}}{{/if}}</p>${LINES}${TOTALS}`,
  },
  receipt: {
    title: 'doc.title.receipt',
    body: `${HEADER}${PARTIES}<table><thead><tr><th>{{t "doc.date"}}</th><th>{{t "doc.method"}}</th><th class="num">{{t "doc.amount"}}</th></tr></thead><tbody>
      {{#each payments}}<tr><td>{{datetime this.created_at}}</td><td>{{this.method}}</td><td class="num">{{money this.amount}}</td></tr>{{/each}}</tbody></table>${TOTALS}`,
  },
  deposit_receipt: {
    title: 'doc.title.deposit_receipt',
    body: `${HEADER}${PARTIES}<p>{{t "doc.deposit_held" amount=(money deposit.amount) method=deposit.method}}</p>`,
  },
};

export const LEGAL_NUMBERED = new Set(['invoice', 'credit_note', 'receipt']);
