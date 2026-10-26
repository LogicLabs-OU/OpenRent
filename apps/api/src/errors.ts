import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { AppError, mapDbError } from '@openrent/core';
import { HookVeto } from '@openrent/plugin-sdk';

export interface Problem {
  type: string;
  title: string;
  status: number;
  code: string;
  detail: string;
  errors?: { field: string; code: string; message: string }[];
  request_id: string;
  [k: string]: unknown;
}

const TITLES: Record<number, string> = {
  400: 'Bad request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not found', 409: 'Conflict', 412: 'Precondition failed',
  415: 'Unsupported media type', 422: 'Unprocessable entity', 429: 'Too many requests', 500: 'Internal server error', 502: 'Bad gateway', 503: 'Service unavailable',
};

export function problem(status: number, code: string, detail: string, req: FastifyRequest, extra: Record<string, unknown> = {}): Problem {
  return {
    ...extra,
    type: `https://openrent.dev/errors/${code}`,
    title: TITLES[status] ?? 'Error',
    status,
    code,
    detail,
    request_id: String(req.id),
  };
}

/** RFC 9457 Problem Details with a stable `code` for every error (PRD §5.1.9). */
export function errorHandler(err: FastifyError & Record<string, any>, req: FastifyRequest, reply: FastifyReply) {
  let p: Problem;
  if (err instanceof AppError) {
    p = problem(err.status, err.code, err.message, req, { ...(err.errors ? { errors: err.errors } : {}), ...(err.extra ?? {}) });
  } else if (err instanceof HookVeto) {
    p = problem(422, err.code, err.message, req);
  } else if (err.validation) {
    const errors = err.validation.map((v: any) => ({
      field: [err.validationContext, ...(v.instancePath ? v.instancePath.split('/').filter(Boolean) : []), v.params?.missingProperty].filter(Boolean).join('.'),
      code: v.keyword ?? 'invalid',
      message: v.message ?? 'is invalid',
    }));
    p = problem(400, 'validation_error', 'The request is invalid', req, { errors });
  } else if (err.statusCode === 429) {
    p = problem(429, 'rate_limited', err.message, req);
  } else if (err.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE' || err.code === 'FST_ERR_CTP_EMPTY_JSON_BODY' || err.code === 'FST_ERR_CTP_INVALID_JSON_BODY' || (err.statusCode === 400 && err.code?.startsWith('FST_'))) {
    p = problem(err.statusCode ?? 400, 'invalid_body', err.message, req);
  } else if (err.type === 'StripeCardError' || err.type?.startsWith?.('Stripe') || err.rawType) {
    p = problem(502, 'provider_error', err.message, req, { provider_code: err.code ?? null });
  } else if (typeof err.status === 'number' && err.status >= 400 && err.status < 500 && typeof err.code === 'string') {
    p = problem(err.status, err.code, err.message, req);
  } else {
    const mapped = mapDbError(err);
    if (mapped) p = problem(mapped.status, mapped.code, mapped.message, req, mapped.extra ?? {});
    else {
      req.log.error({ err }, 'unhandled error');
      if (process.env.OPENRENT_DEBUG_ERRORS) console.error(err);
      p = problem(500, 'internal_error', 'Something went wrong. The request id helps support find it.', req);
    }
  }
  if (p.status >= 500) req.log.error({ err, code: p.code }, 'request failed');
  reply.status(p.status).type('application/problem+json').send(p);
}
