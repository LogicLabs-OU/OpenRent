import { t as msg } from './i18n/index.ts';
export interface FieldError {
  field: string;
  code: string;
  message: string;
}

/**
 * Domain error carrying a stable machine code. The API maps it to RFC 9457 Problem Details.
 */
export class AppError extends Error {
  readonly code: string;
  readonly status: number;
  readonly errors: FieldError[] | undefined;
  readonly extra: Record<string, unknown> | undefined;

  constructor(
    code: string,
    status: number,
    message: string,
    opts: { errors?: FieldError[]; extra?: Record<string, unknown>; cause?: unknown } = {},
  ) {
    super(message, opts.cause ? { cause: opts.cause } : undefined);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.errors = opts.errors;
    this.extra = opts.extra;
  }
}

export const notFound = (entity: string, id?: string) =>
  new AppError('not_found', 404, id ? `${entity} ${id} not found` : `${entity} not found`);

export const invalid = (message: string, errors?: FieldError[]) =>
  new AppError('validation_error', 422, message, { errors });

export const conflict = (code: string, message: string, extra?: Record<string, unknown>) =>
  new AppError(code, 409, message, { extra });

export const forbidden = (message = msg('error.forbidden')) =>
  new AppError('forbidden', 403, message);

/** Maps PostgreSQL errors raised by constraints and triggers to domain errors. */
export function mapDbError(err: any): AppError | null {
  if (!err || typeof err !== 'object') return null;
  switch (err.code) {
    case '23P01':
      return new AppError('exceeds_availability', 409, msg('error.the_requested_unit_is_already_allocated_for'), {
        extra: { constraint: err.constraint, detail: err.detail },
        cause: err,
      });
    case '23505':
      return new AppError('already_exists', 409, msg('error.a_record_with_the_same_unique_value'), {
        extra: { constraint: err.constraint, detail: err.detail },
        cause: err,
      });
    case '23503':
      return new AppError('invalid_reference', 422, msg('error.a_referenced_record_does_not_exist'), {
        extra: { constraint: err.constraint, detail: err.detail },
        cause: err,
      });
    case '23514':
      return new AppError('constraint_violation', 422, msg('error.a_value_is_outside_the_allowed_range'), {
        extra: { constraint: err.constraint },
        cause: err,
      });
    case 'P0001':
      return new AppError(err.hint || 'rule_violation', 409, err.message, { cause: err });
    case '22P02':
    case '22007':
    case '22008':
      return new AppError('validation_error', 422, err.message, { cause: err });
    default:
      return null;
  }
}
