import { toast } from 'svelte-sonner';
import { ApiError } from './api.ts';

export { toast };

/**
 * General errors go to a toast (error-handling §3.2). Validation errors (422) belong next to
 * their fields; callers read `fieldErrors(e)` and only fall back to a toast for the summary.
 */
export function notifyError(e: unknown) {
  toast.error(e instanceof Error ? e.message : String(e));
}

export function fieldErrors(e: unknown): Record<string, string> {
  return e instanceof ApiError && e.status === 422 ? e.fieldErrors : {};
}
