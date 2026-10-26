export { orders, payments, documents, notifications, AppError } from '@openrent/core';
import type { orders as O } from '@openrent/core';

/** Transitions exposed as POST /orders/{id}/actions/{action}; `expire` is system-only. */
export const ORDER_ACTIONS: O.OrderAction[] = ['send_quote', 'reserve', 'prepare', 'check_out', 'check_in', 'inspect', 'close', 'cancel', 'reopen'];
