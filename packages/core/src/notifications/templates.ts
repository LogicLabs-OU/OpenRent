/**
 * Default transactional messages (FR-NOT-1). Handlebars; the wording lives in the core catalogues
 * under `email.*` and is written with `{{t "key" param=value}}`, so one template serves every
 * language. Tenants override per event and locale.
 */
const wrap = (inner: string) => `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,'Hiragino Sans','Noto Sans JP',sans-serif;max-width:560px;margin:0 auto;color:#111827;line-height:1.5">
<div style="border-bottom:3px solid {{brand}};padding:16px 0;margin-bottom:16px;font-weight:700;font-size:18px">{{tenant.name}}</div>
${inner}
<p style="color:#6b7280;font-size:12px;margin-top:32px">{{tenant.name}}{{#if location.name}} · {{location.name}}{{/if}}</p></div>`;

const HI = `<p>{{t "email.greeting" name=customer.name}}</p>`;
const VIEW = `<p><a href="{{order_url}}">{{t "email.view_booking"}}</a></p>`;
const ADMIN = `<p><a href="{{admin_url}}">{{t "email.open_admin"}}</a></p>`;

const ORDER_SUMMARY = `<table style="width:100%;border-collapse:collapse;margin:12px 0">{{#each lines}}<tr><td style="padding:4px 0">{{this.quantity}} × {{this.name}}</td><td style="text-align:right">{{money this.total}}</td></tr>{{/each}}
<tr><td style="padding-top:8px;border-top:1px solid #e5e7eb"><strong>{{t "email.total"}}</strong></td><td style="text-align:right;padding-top:8px;border-top:1px solid #e5e7eb"><strong>{{money totals.total}}</strong></td></tr></table>`;

export const DEFAULT_NOTIFICATIONS: Record<string, { subject: string; body: string; audience: 'customer' | 'staff' }> = {
  order_confirmed: {
    audience: 'customer',
    subject: '{{t "email.order_confirmed.subject" number=order.number}}',
    body: wrap(`${HI}<p>{{t "email.order_confirmed.body" pickup=(datetime order.starts_at) return=(datetime order.ends_at)}}</p>${ORDER_SUMMARY}
<p><a href="{{order_url}}">{{t "email.view_booking"}}</a></p><p>{{t "email.order_confirmed.qr"}}</p>`),
  },
  quote_sent: {
    audience: 'customer',
    subject: '{{t "email.quote_sent.subject" number=order.number shop=tenant.name}}',
    body: wrap(`${HI}<p>{{t "email.quote_sent.body" from=(datetime order.starts_at) to=(datetime order.ends_at)}}</p>${ORDER_SUMMARY}<p>{{t "email.quote_sent.valid_until" until=(datetime order.quote_expires_at)}}</p>
<p><a href="{{order_url}}">{{t "email.quote_sent.view"}}</a></p>`),
  },
  payment_received: {
    audience: 'customer',
    subject: '{{t "email.payment_received.subject" number=order.number}}',
    body: wrap(`${HI}<p>{{t "email.payment_received.body" amount=(money payment.amount)}}</p>${VIEW}`),
  },
  payment_request: {
    audience: 'customer',
    subject: '{{t "email.payment_request.subject" amount=(money request.amount) number=order.number}}',
    body: wrap(`${HI}<p>{{#if request.due_at}}{{t "email.payment_request.body_due" amount=(money request.amount) number=order.number due=(datetime request.due_at)}}{{else}}{{t "email.payment_request.body" amount=(money request.amount) number=order.number}}{{/if}}</p>{{#if request.message}}<p>{{request.message}}</p>{{/if}}
<p><a href="{{#if request.url}}{{request.url}}{{else}}{{order_url}}{{/if}}" style="display:inline-block;background:{{brand}};color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">{{t "email.payment_request.pay"}}</a></p>`),
  },
  pickup_reminder: {
    audience: 'customer',
    subject: '{{t "email.pickup_reminder.subject" number=order.number}}',
    body: wrap(`${HI}<p>{{t "email.pickup_reminder.body" start=(datetime order.starts_at) location=location.name}}</p>${ORDER_SUMMARY}`),
  },
  return_reminder: {
    audience: 'customer',
    subject: '{{t "email.return_reminder.subject" end=(datetime order.ends_at)}}',
    body: wrap(`${HI}<p>{{t "email.return_reminder.body" end=(datetime order.ends_at) location=location.name}}</p>`),
  },
  order_overdue: {
    audience: 'customer',
    subject: '{{t "email.order_overdue.subject" number=order.number}}',
    body: wrap(`${HI}<p>{{t "email.order_overdue.body" end=(datetime order.ends_at)}}</p>`),
  },
  order_cancelled: {
    audience: 'customer',
    subject: '{{t "email.order_cancelled.subject" number=order.number}}',
    body: wrap(`${HI}<p>{{t "email.order_cancelled.body"}}{{#if refund_amount}} {{t "email.order_cancelled.refund" amount=(money refund_amount)}}{{/if}}</p>`),
  },
  deposit_held: {
    audience: 'customer',
    subject: '{{t "email.deposit_held.subject" number=order.number}}',
    body: wrap(`${HI}<p>{{t "email.deposit_held.body" amount=(money deposit.amount)}}</p>`),
  },
  deposit_released: {
    audience: 'customer',
    subject: '{{t "email.deposit_released.subject" number=order.number}}',
    body: wrap(`${HI}<p>{{#if deposit.captured_amount}}{{t "email.deposit_released.body_captured" amount=(money deposit.captured_amount)}}{{else}}{{t "email.deposit_released.body"}}{{/if}}</p>`),
  },
  damage_charge_created: {
    audience: 'customer',
    subject: '{{t "email.damage_charge_created.subject" number=order.number}}',
    body: wrap(`${HI}<p>{{t "email.damage_charge_created.body" number=order.number}}</p>
<table style="width:100%;border-collapse:collapse;margin:12px 0">{{#each damage.charges}}<tr><td style="padding:4px 0">{{this.description}}</td><td style="text-align:right">{{money this.amount}}</td></tr>{{/each}}
<tr><td style="padding-top:8px;border-top:1px solid #e5e7eb"><strong>{{t "email.total"}}</strong></td><td style="text-align:right;padding-top:8px;border-top:1px solid #e5e7eb"><strong>{{money damage.total}}</strong></td></tr></table>
<p>{{t "email.damage_charge_created.photos"}}</p>${VIEW}`),
  },
  staff_new_order: {
    audience: 'staff',
    subject: '{{t "email.staff_new_order.subject" number=order.number customer=customer.name}}',
    body: wrap(`<p>{{t "email.staff_new_order.body"}}</p>${ORDER_SUMMARY}${ADMIN}`),
  },
  staff_payment_failed: {
    audience: 'staff',
    subject: '{{t "email.staff_payment_failed.subject" number=order.number}}',
    body: wrap(`<p>{{t "email.staff_payment_failed.body" number=order.number customer=customer.name error=error}}</p>${ADMIN}`),
  },
  staff_low_availability: {
    audience: 'staff',
    subject: '{{t "email.staff_low_availability.subject" item=item}}',
    body: wrap(`<p>{{t "email.staff_low_availability.body" item=item available=available threshold=threshold location=location days=days}}</p>${ADMIN}`),
  },
  staff_webhook_disabled: {
    audience: 'staff',
    subject: '{{t "email.staff_webhook_disabled.subject"}}',
    body: wrap(`<p>{{t "email.staff_webhook_disabled.body" url=url}}</p>${ADMIN}`),
  },
  staff_overdue: {
    audience: 'staff',
    subject: '{{t "email.staff_overdue.subject" number=order.number customer=customer.name}}',
    body: wrap(`<p>{{t "email.staff_overdue.body" number=order.number end=(datetime order.ends_at)}}</p>${ADMIN}`),
  },
  deposit_expiring: {
    audience: 'staff',
    subject: '{{t "email.deposit_expiring.subject" number=order.number}}',
    body: wrap(`<p>{{t "email.deposit_expiring.body" amount=(money deposit.amount) expires=(datetime deposit.expires_at)}}</p>${ADMIN}`),
  },
  customer_login: {
    audience: 'customer',
    subject: '{{t "email.customer_login.subject" shop=tenant.name}}',
    body: wrap(`${HI}<p>{{t "email.customer_login.body" minutes=minutes}}</p><p><a href="{{link}}">{{t "email.customer_login.link"}}</a></p><p style="color:#6b7280">{{t "email.customer_login.ignore"}}</p>`),
  },
  cancellation_request_received: {
    audience: 'customer',
    subject: '{{t "email.cancellation_request_received.subject" number=order.number}}',
    body: wrap(`${HI}<p>{{t "email.cancellation_request_received.body" number=order.number start=(datetime order.starts_at)}}</p>{{#if reason}}<p>{{t "email.your_reason" reason=reason}}</p>{{/if}}${VIEW}`),
  },
  cancellation_declined: {
    audience: 'customer',
    subject: '{{t "email.cancellation_declined.subject" number=order.number}}',
    body: wrap(`${HI}<p>{{t "email.cancellation_declined.body" number=order.number}}</p>{{#if note}}<p>{{note}}</p>{{/if}}${VIEW}<p>{{t "email.cancellation_declined.questions"}}</p>`),
  },
  staff_cancellation_requested: {
    audience: 'staff',
    subject: '{{t "email.staff_cancellation_requested.subject" number=order.number customer=customer.name}}',
    body: wrap(`<p>{{t "email.staff_cancellation_requested.body" customer=customer.name number=order.number start=(datetime order.starts_at)}}</p>{{#if reason}}<p>{{t "email.reason" reason=reason}}</p>{{/if}}${ORDER_SUMMARY}<p><a href="{{admin_url}}">{{t "email.staff_cancellation_requested.link"}}</a></p>`),
  },
  signature_requested: {
    audience: 'customer',
    subject: '{{t "email.signature_requested.subject" title=document_title number=order.number}}',
    body: wrap(`<p>{{t "email.greeting" name=signer}}</p><p>{{t "email.signature_requested.body" title=document_title number=order.number}}</p><p><a href="{{link}}">{{t "email.signature_requested.link"}}</a></p>`),
  },
  signature_code: {
    audience: 'customer',
    subject: '{{t "email.signature_code.subject" code=code}}',
    body: wrap(`<p>{{t "email.signature_code.body" minutes=minutes}}</p><p style="font-size:28px;font-weight:700;letter-spacing:6px">{{code}}</p><p>{{t "email.signature_code.ignore"}}</p>`),
  },
  document_signed: {
    audience: 'customer',
    subject: '{{t "email.document_signed.subject" title=document_title number=order.number}}',
    body: wrap(`${HI}<p>{{t "email.document_signed.body" title=document_title number=order.number}}</p>${VIEW}`),
  },
  order_extended: {
    audience: 'customer',
    subject: '{{t "email.order_extended.subject" number=order.number}}',
    body: wrap(`${HI}<p>{{t "email.order_extended.body" number=order.number return=(datetime order.ends_at)}}</p>${ORDER_SUMMARY}${VIEW}`),
  },
  extension_request_received: {
    audience: 'customer',
    subject: '{{t "email.extension_request_received.subject" number=order.number}}',
    body: wrap(`${HI}<p>{{t "email.extension_request_received.body" number=order.number until=(datetime requested_end)}}</p>{{#if reason}}<p>{{t "email.your_reason" reason=reason}}</p>{{/if}}${VIEW}`),
  },
  extension_declined: {
    audience: 'customer',
    subject: '{{t "email.extension_declined.subject" number=order.number}}',
    body: wrap(`${HI}<p>{{t "email.extension_declined.body" number=order.number return=(datetime order.ends_at)}}</p>{{#if note}}<p>{{note}}</p>{{/if}}${VIEW}`),
  },
  staff_extension_requested: {
    audience: 'staff',
    subject: '{{t "email.staff_extension_requested.subject" number=order.number customer=customer.name}}',
    body: wrap(`<p>{{t "email.staff_extension_requested.body" customer=customer.name number=order.number return=(datetime order.ends_at) until=(datetime requested_end)}}</p>{{#if reason}}<p>{{t "email.reason" reason=reason}}</p>{{/if}}${ORDER_SUMMARY}<p><a href="{{admin_url}}">{{t "email.staff_extension_requested.link"}}</a></p>`),
  },
  delivery_dispatched: {
    audience: 'customer',
    subject: '{{t "email.delivery_dispatched.subject" number=order.number}}',
    body: wrap(`${HI}<p>{{t "email.delivery_dispatched.body" number=order.number from=(datetime window_start) to=(datetime window_end)}}</p>${ORDER_SUMMARY}${VIEW}`),
  },
  collection_dispatched: {
    audience: 'customer',
    subject: '{{t "email.collection_dispatched.subject" number=order.number}}',
    body: wrap(`${HI}<p>{{t "email.collection_dispatched.body" number=order.number from=(datetime window_start) to=(datetime window_end)}}</p>${VIEW}`),
  },
  staff_delivery_failed: {
    audience: 'staff',
    subject: '{{t "email.staff_delivery_failed.subject" number=order.number customer=customer.name}}',
    body: wrap(`<p>{{t "email.staff_delivery_failed.body" number=order.number customer=customer.name}}</p>{{#if reason}}<p>{{t "email.reason" reason=reason}}</p>{{/if}}${ORDER_SUMMARY}`),
  },
  staff_accounting_issue: {
    audience: 'staff',
    subject: '{{t "email.staff_accounting_issue.subject" count=count name=name}}',
    body: wrap(`<p>{{t "email.staff_accounting_issue.body" name=name}}</p>${ADMIN}`),
  },
  staff_service_due: {
    audience: 'staff',
    subject: '{{t "email.staff_service_due.subject" name=name barcode=barcode}}',
    body: wrap(`<p>{{t "email.staff_service_due.body" name=name barcode=barcode product=product}}</p>`),
  },
  staff_invitation: {
    audience: 'staff',
    subject: '{{t "email.staff_invitation.subject" shop=shop}}',
    body: wrap(`<p>{{t "email.greeting" name=name}}</p><p>{{t "email.staff_invitation.body" shop=shop}}</p><p><a href="{{link}}">{{t "email.staff_invitation.link"}}</a></p><p>{{t "email.staff_access.expires"}}</p>`),
  },
  staff_password_reset: {
    audience: 'staff',
    subject: '{{t "email.staff_password_reset.subject" shop=shop}}',
    body: wrap(`<p>{{t "email.greeting" name=name}}</p><p>{{t "email.staff_password_reset.body" shop=shop}}</p><p><a href="{{link}}">{{t "email.staff_password_reset.link"}}</a></p><p>{{t "email.staff_access.expires"}}</p>`),
  },
  magic_link: {
    audience: 'staff',
    subject: '{{t "email.magic_link.subject"}}',
    body: wrap(`<p>{{t "email.magic_link.body"}}</p><p><a href="{{link}}">{{t "email.magic_link.link"}}</a></p>`),
  },
};
