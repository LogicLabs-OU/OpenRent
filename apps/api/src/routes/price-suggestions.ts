import { priceSuggestions } from '@openrent/core';
import type { Router } from '../http.ts';
import { IdParams, Type } from '../schemas.ts';

/** Price suggestions (FR-PR-9): busy and quiet weeks per product, for staff to accept or dismiss. */
export function registerPriceSuggestions(r: Router) {
  const P = ['Pricing'];
  r.get(
    '/price_suggestions',
    {
      permission: 'pricing:read',
      tags: P,
      summary: 'Suggested price changes per product and weeks, with how full they are now and were a year ago',
      querystring: Type.Object({ status: Type.Optional(Type.Union(['open', 'accepted', 'dismissed'].map((s) => Type.Literal(s)))) }),
    },
    async (ctx, req) => ({ object: 'list', data: await priceSuggestions.listPriceSuggestions(ctx, req.query) }),
  );
  r.post(
    '/price_suggestions/actions/refresh',
    { permission: 'pricing:write', tags: P, summary: 'Make the open suggestions again now from the bookings as they stand (the worker does this each Monday)', status: 200 },
    async (ctx) => ({ object: 'price_suggestion_refresh', count: await priceSuggestions.computePriceSuggestions(ctx) }),
  );
  r.post(
    '/price_suggestions/:id/actions/accept',
    {
      permission: 'pricing:write',
      tags: P,
      summary: 'Make the season price rule; adjustment_bp changes the suggested percentage',
      params: IdParams,
      body: Type.Object({ adjustment_bp: Type.Optional(Type.Integer({ description: 'Basis points: 1000 = 10% more, -1000 = 10% less' })) }),
      status: 200,
    },
    async (ctx, req) => priceSuggestions.acceptPriceSuggestion(ctx, req.params.id, req.body),
  );
  r.post(
    '/price_suggestions/:id/actions/dismiss',
    { permission: 'pricing:write', tags: P, summary: 'Dismiss the suggestion; it is not made again for these weeks', params: IdParams, status: 200 },
    async (ctx, req) => priceSuggestions.dismissPriceSuggestion(ctx, req.params.id),
  );
}
