export type SafeResult<T> =
  | { ok: true; value: Awaited<T> }
  | { ok: false; error: unknown };

/**
 * Safely evaluate a promise or callback.
 * Returns a result object with either the value or the error.
 */
export const safe = async <T>(
  task: Promise<T> | (() => T | Promise<T>)
): Promise<SafeResult<T>> => {
  try {
    const value = await (typeof task === "function" ? task() : task);
    return { ok: true, value };
  } catch (error) {
    return { ok: false, error };
  }
};

/**
 * Generate a sequence of numbers.
 * This function imitates the behavior of python's `range` function.
 */
export function range(stop: number): number[];
export function range(start: number, stop: number): number[];
export function range(start: number, stop: number, step: number): number[];
export function range(
  start: number,
  stop?: number,
  step: number = 1
): number[] {
  if (stop === undefined) {
    stop = start;
    start = 0;
  }
  const result: number[] = [];
  for (let i = start; i < stop; i += step) {
    result.push(i);
  }
  return result;
}
