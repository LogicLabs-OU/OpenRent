import { currentLocale, t as msg, type MessageKey } from '../i18n/index.ts';

/**
 * Declarative order state machine (PRD §7.6, FR-OR-1). The table drives the API (409 invalid_transition),
 * the admin UI (next action button with blocked reasons) and the OpenAPI documentation.
 */
export type OrderStatus =
  | 'draft' | 'quote' | 'reserved' | 'prepared' | 'out' | 'returned_partial' | 'returned' | 'inspected' | 'closed' | 'cancelled' | 'expired';

export const ORDER_STATUSES: OrderStatus[] = ['draft', 'quote', 'reserved', 'prepared', 'out', 'returned_partial', 'returned', 'inspected', 'closed', 'cancelled', 'expired'];

export type OrderAction =
  | 'send_quote' | 'reserve' | 'prepare' | 'check_out' | 'check_in' | 'inspect' | 'close' | 'cancel' | 'expire' | 'reopen';

/** Facts guards look at. Loaded once per transition. */
export interface OrderFacts {
  status: OrderStatus;
  hasLines: boolean;
  hasCustomer: boolean;
  customerBlocked: boolean;
  unassignedUnits: number;
  outstandingUnits: number;
  balance: number;
  openDeposits: number;
  openDamageCharges: number;
  currency: string;
}

export interface Guard {
  code: string;
  check(f: OrderFacts): string | null;
}

export interface Transition {
  action: OrderAction;
  from: OrderStatus[];
  /** Target; check_in decides between returned_partial and returned at run time. */
  to: OrderStatus | 'dynamic';
  /** English summary for the API reference; UIs get `order.action.<action>` in the request language. */
  label: string;
  guards: Guard[];
  systemOnly?: boolean;
  primaryFrom?: OrderStatus[];
}

const hasLines: Guard = { code: 'no_lines', check: (f) => (f.hasLines ? null : msg('order.guard.no_lines')) };
const hasCustomer: Guard = { code: 'customer_required', check: (f) => (f.hasCustomer ? null : msg('order.guard.customer_required')) };
const notBlocked: Guard = { code: 'customer_blocked', check: (f) => (f.customerBlocked ? msg('order.guard.customer_blocked') : null) };
const allAssigned: Guard = {
  code: 'units_unassigned',
  check: (f) => (f.unassignedUnits > 0 ? msg('order.guard.units_unassigned', { count: f.unassignedUnits }) : null),
};
const settled: Guard = {
  code: 'balance_due',
  check: (f) =>
    f.balance > 0 ? msg('order.guard.balance_due', { amount: new Intl.NumberFormat(currentLocale(), { style: 'currency', currency: f.currency }).format(f.balance / 100) }) : null,
};
const depositsSettled: Guard = {
  code: 'deposit_open',
  check: (f) => (f.openDeposits > 0 ? msg('order.guard.deposit_open') : null),
};
const damageSettled: Guard = {
  code: 'damage_open',
  check: (f) => (f.openDamageCharges > 0 ? msg('order.guard.damage_open', { count: f.openDamageCharges }) : null),
};

export const TRANSITIONS: Transition[] = [
  { action: 'send_quote', from: ['draft'], to: 'quote', label: 'Send quote', guards: [hasLines, hasCustomer] },
  { action: 'reserve', from: ['draft', 'quote'], to: 'reserved', label: 'Reserve', guards: [hasLines, hasCustomer, notBlocked], primaryFrom: ['draft', 'quote'] },
  { action: 'prepare', from: ['reserved'], to: 'prepared', label: 'Mark prepared', guards: [allAssigned] },
  { action: 'check_out', from: ['reserved', 'prepared'], to: 'out', label: 'Mark picked up', guards: [], primaryFrom: ['reserved', 'prepared'] },
  { action: 'check_in', from: ['out', 'returned_partial'], to: 'dynamic', label: 'Check in', guards: [], primaryFrom: ['out', 'returned_partial'] },
  { action: 'inspect', from: ['returned'], to: 'inspected', label: 'Complete inspection', guards: [], primaryFrom: ['returned'] },
  { action: 'close', from: ['returned', 'inspected'], to: 'closed', label: 'Close order', guards: [settled, depositsSettled, damageSettled], primaryFrom: ['inspected'] },
  { action: 'cancel', from: ['draft', 'quote', 'reserved', 'prepared'], to: 'cancelled', label: 'Cancel order', guards: [] },
  { action: 'expire', from: ['quote'], to: 'expired', label: 'Expire quote', guards: [], systemOnly: true },
  { action: 'reopen', from: ['cancelled', 'expired'], to: 'draft', label: 'Reopen as draft', guards: [] },
];

export function transitionFor(action: OrderAction): Transition {
  const t = TRANSITIONS.find((x) => x.action === action);
  if (!t) throw new Error(`unknown action ${action}`);
  return t;
}

export interface ActionAvailability {
  action: OrderAction;
  label: string;
  enabled: boolean;
  primary: boolean;
  blocked_reasons: { code: string; message: string }[];
}

export function evaluate(t: Transition, f: OrderFacts): { code: string; message: string }[] {
  const out: { code: string; message: string }[] = [];
  for (const g of t.guards) {
    const msg = g.check(f);
    if (msg) out.push({ code: g.code, message: msg });
  }
  return out;
}

/** Actions valid from the current status, with blocked reasons, for UIs (PRD §4.2.5). */
export function availableActions(f: OrderFacts): ActionAvailability[] {
  return TRANSITIONS.filter((t) => !t.systemOnly && t.from.includes(f.status)).map((t) => {
    const blocked = evaluate(t, f);
    return { action: t.action, label: msg(`order.action.${t.action}` as MessageKey), enabled: blocked.length === 0, primary: !!t.primaryFrom?.includes(f.status), blocked_reasons: blocked };
  });
}

/** Statuses during which an order holds stock. */
export const HOLDING: OrderStatus[] = ['quote', 'reserved', 'prepared', 'out', 'returned_partial'];
