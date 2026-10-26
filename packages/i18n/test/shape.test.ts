import { describe, expect, it } from 'vitest';
import { shapeProblem } from '../src/index.ts';

describe('shapeProblem', () => {
  it('accepts wording with the same placeholders and plural blocks', () => {
    expect(shapeProblem('Booking #{number} for {customer}', 'Your rental {customer}, number {number}')).toBeNull();
    expect(shapeProblem('{count, plural, one {# day} other {# days}}', '{count, plural, one {# Tag} other {# Tage}}')).toBeNull();
  });

  it('reports missing or extra placeholders and changed plurals', () => {
    expect(shapeProblem('Hello {name}', 'Hello there')).toEqual({ params: ['name'], plurals: false });
    expect(shapeProblem('Hello', 'Hello {name}')).toEqual({ params: [], plurals: false });
    expect(shapeProblem('{count, plural, one {# day} other {# days}}', '{count} days')).toMatchObject({ plurals: true });
  });
});
