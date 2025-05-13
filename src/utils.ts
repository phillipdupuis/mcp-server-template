import {
  type BinaryLike,
  type BinaryToTextEncoding,
  createHash,
} from "node:crypto";
import { isArrayBufferView } from "node:util/types";
import type { Jsonifiable } from "type-fest";

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

export const nonNullable = <T extends unknown>(
  value: T
): value is NonNullable<T> => value != null;

export const omit = <T, K extends keyof T>(obj: T, keys: K[]): Omit<T, K> => {
  const clone = { ...obj };
  for (const key of keys) delete clone[key];
  return clone;
};

export const pick = <T, K extends keyof T>(obj: T, keys: K[]): Pick<T, K> => {
  const clone = {} as Pick<T, K>;
  for (const key of keys) clone[key] = obj[key];
  return clone;
};

export type Hashable = BinaryLike | Jsonifiable;

export interface HashOptions {
  algorithm?: string;
  encoding?: BinaryToTextEncoding;
}

export const hash = (values: Hashable[], options?: HashOptions): string => {
  const hash = createHash(options?.encoding ?? "sha256");
  for (const value of values) {
    if (typeof value === "string" || isArrayBufferView(value)) {
      hash.update(value);
    } else {
      hash.update(JSON.stringify(value));
    }
  }
  return hash.digest(options?.encoding ?? "hex");
};

type MaybePromise<T> = T | Promise<T>;

type KeyValueStorage<T> = {
  get: (key: string) => MaybePromise<T>;
  set: (key: string, value: T) => MaybePromise<unknown>;
};

type AllHashable<T extends any[]> = T extends [infer First, ...infer Rest]
  ? First extends Hashable
    ? AllHashable<Rest>
    : false
  : true;

type HashableFunction<
  Args extends any[],
  Return
> = AllHashable<Args> extends true ? (...args: Args) => Return : never;

type MemoizeOptions<Args extends any[], Result> = KeyValueStorage<Result> & {
  condition?: (...args: Args) => boolean | Promise<boolean>;
};

type MemoizedFunction<Args extends any[], Result> = (
  ...args: Args
) => Promise<Result>;

/**
 * Create a memoized function.
 */
export function memoize<Args extends any[], Result>(
  fn: HashableFunction<Args, MaybePromise<Result>>,
  options: MemoizeOptions<Args, Result> & { key?: undefined }
): MemoizedFunction<Args, Result>;

/**
 * Create a memoized function with a custom key.
 */
export function memoize<Args extends any[], Result>(
  fn: (...args: Args) => MaybePromise<Result>,
  options: MemoizeOptions<Args, Result> & {
    key: (...args: Args) => MaybePromise<string>;
  }
): MemoizedFunction<Args, Result>;

export function memoize<Args extends any[], Result>(
  fn: (...args: Args) => MaybePromise<Result>,
  options: MemoizeOptions<Args, Result> & {
    key?: (...args: Args) => MaybePromise<string>;
  }
): MemoizedFunction<Args, Result> {
  const { condition, get, set } = options;
  const keyFn = options?.key ?? ((...args: Args) => hash(args));
  const memoizedFn = async (...args: Args): Promise<Result> => {
    if (condition) {
      const shouldMemoize = await condition(...args);
      if (!shouldMemoize) return fn(...args);
    }
    const key = await keyFn(...args);
    try {
      const result = await get(key);
      console.debug("Cache hit:", key);
      return result;
    } catch (error) {
      console.debug("Cache miss:", key, error);
      const result = await fn(...args);
      try {
        await set(key, result);
      } catch (error) {
        console.error("Cache set error:", error);
      }
      return result;
    }
  };
  return memoizedFn;
}
