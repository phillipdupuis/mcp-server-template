import {
  type BinaryLike,
  type BinaryToTextEncoding,
  createHash,
} from "node:crypto";
import type { Abortable } from "node:events";
import { isArrayBufferView } from "node:util/types";
import sortKeys from "sort-keys";
import type { Jsonifiable } from "type-fest";

type SafeResult<T> =
  | { ok: true; value: Awaited<T> }
  | { ok: false; error: unknown };

// ------------------------------------------------------------------
// Task key utilities
// ------------------------------------------------------------------

type Hashable = BinaryLike | Jsonifiable | AnyTask;

interface HashOptions {
  algorithm?: string;
  encoding?: BinaryToTextEncoding;
}

export const hash = (values: Hashable[], options?: HashOptions): string => {
  values = Array.isArray(values) ? values : [values];
  const hash = createHash(options?.encoding ?? "sha256");
  for (const value of values) {
    if (value instanceof Task) {
      hash.update(value.key);
    } else if (isArrayBufferView(value)) {
      hash.update(value);
    } else if (typeof value === "object" && value !== null) {
      try {
        hash.update(JSON.stringify(sortKeys(value, { deep: true })));
      } catch (error) {
        console.error(
          `Failed to sort keys, cached usage may be incorrect: ${error}`
        );
        hash.update(JSON.stringify(value));
      }
    } else {
      hash.update(JSON.stringify(value));
    }
  }
  return hash.digest(options?.encoding ?? "hex");
};

// ------------------------------------------------------------------
// Task arguments
// ------------------------------------------------------------------

type TaskArguments<Args extends any[]> = {
  [K in keyof Args]: Args[K] extends Hashable
    ? Args[K] | Task<any[], Args[K]>
    : Task<any[], Args[K]>;
};

type UnwrapPromise<T> = T extends Promise<infer U> ? U : T;

type UnwrapTask<T> = T extends Task<infer _, infer Result> ? Result : T;

type UnwrappedArguments<Args extends any[]> = {
  [K in keyof Args]: Awaited<UnwrapTask<Args[K]>>;
};

const unwrap = async <Args extends any[]>(
  args: TaskArguments<Args>,
  options?: Abortable
): Promise<UnwrappedArguments<Args>> => {
  const unwrappedArgs = await Promise.all(
    args.map(async (arg) => (arg instanceof Task ? arg.result(options) : arg))
  );
  return unwrappedArgs as UnwrappedArguments<Args>;
};

// ------------------------------------------------------------------
// Task names
// ------------------------------------------------------------------

// export class TaskNameError extends Error {
//   name = "TaskNameError";

//   static invalid = (name: unknown) =>
//     new TaskNameError(
//       `'name' must be a non-empty string provided by either the function or options. Received: ${name}`
//     );

//   static alreadyRegistered = (name: string) =>
//     new TaskNameError(
//       `A different function with name "${name}" is already registered. ` +
//         "Use the { name } option to assign a custom name for this function."
//     );
// }

type AnyFunction = (...args: any[]) => any;

const nameRegistry = new Map<string, AnyFunction>();

const registerName = (fn: AnyFunction): string => {
  const name = fn.name?.trim();
  if (!name) throw new Error(`Anonymous functions require an explicit 'key'`);
  const existing = nameRegistry.get(name);
  if (existing && existing !== fn)
    throw new Error(`A function with name "${name}" is already registered`);
  nameRegistry.set(name, fn);
  return name;
};

// ------------------------------------------------------------------
// Task storage
// ------------------------------------------------------------------

export interface TaskStorage<T> {
  get: (key: string) => T | Promise<T>;
  set: (key: string, value: T) => unknown | Promise<unknown>;
}

export const taskStorage = <T>(storage: TaskStorage<T>): TaskStorage<T> =>
  storage;

export class TaskStorageError extends Error {
  name = "TaskStorageError";
  storage?: TaskStorage<any>;

  constructor(
    message: string,
    options?: { storage?: TaskStorage<any>; cause?: unknown }
  ) {
    super(message, { cause: options?.cause });
    this.storage = options?.storage;
  }

  static keyNotFound = (key: string, storage?: TaskStorage<any>) =>
    new TaskStorageError(`Key "${key}" not found`, { storage });
}

const createDefaultStorage = (): TaskStorage<any> => {
  const map = new Map<string, any>();
  return {
    get: (key: string) => {
      if (!map.has(key)) throw TaskStorageError.keyNotFound(key, map);
      return map.get(key)!;
    },
    set: (key: string, value: any) => {
      map.set(key, value);
    },
  };
};

const getFromStorage = async <T>(
  storage: TaskStorage<T>,
  key: string
): Promise<SafeResult<T>> => {
  try {
    const value = await storage.get(key);
    return { ok: true, value };
  } catch (error) {
    return { ok: false, error };
  }
};

const setToStorage = async <T>(
  storage: TaskStorage<T>,
  key: string,
  value: T
): Promise<SafeResult<void>> => {
  try {
    await storage.set(key, value);
    return { ok: true, value: undefined };
  } catch (error) {
    return { ok: false, error };
  }
};

// ------------------------------------------------------------------
// Topological sorting
// ------------------------------------------------------------------

type AnyTask = Task<any[], any>;

const removeDuplicateTasks = (tasks: AnyTask[]): AnyTask[] => {
  const seen = new Set<string>();
  return tasks.filter((task) => {
    if (seen.has(task.key)) return false;
    seen.add(task.key);
    return true;
  });
};

/**
 * Topologically sort tasks based on dependencies
 */
const toposort = (tasks: AnyTask[]): AnyTask[] => {
  const sortedTasks: AnyTask[] = [];
  const completed = new Set<string>();
  const visiting = new Set<string>();

  for (const task of removeDuplicateTasks(tasks)) {
    if (completed.has(task.key)) continue;

    const tasksToProcess = [task];

    while (tasksToProcess.length) {
      const current = tasksToProcess[tasksToProcess.length - 1];
      // Skip if it's already complete
      if (completed.has(current.key)) {
        tasksToProcess.pop();
        continue;
      }
      // Mark as visiting and get a list of incomplete dependencies
      // TODO: maybe display the cycle? https://github.com/dask/dask/blob/abdb435dde0be15b262e9ad4657238c2bcb320c9/dask/core.py#L366
      visiting.add(current.key);
      const incompleteDeps: AnyTask[] = [];
      for (const dep of current.dependencies()) {
        if (completed.has(dep.key)) continue;
        if (visiting.has(dep.key)) {
          throw new Error(`Cycle detected: ${current.key} -> ${dep.key}`);
        }
        incompleteDeps.push(dep);
      }
      // Mark as complete if all dependencies are complete
      if (incompleteDeps.length === 0) {
        tasksToProcess.pop();
        visiting.delete(current.key);
        sortedTasks.push(current);
        completed.add(current.key);
      } else {
        tasksToProcess.push(...incompleteDeps);
      }
    }
  }

  return sortedTasks;
};

/**
 * Returns an ordered list of groups of tasks that can be executed in parallel.
 * layers[0] contains the dependencies required by layers[1]
 * layers[1] contains the dependencies required by layers[2]
 * etc.
 */
const dependencyLayers = (task: AnyTask): AnyTask[][] => {
  const tasks = [task, ...task.dependencies({ deep: true })];
  const sortedTasks = toposort(tasks);
  const layersByKey = new Map<string, number>();
  // For each task, the layer is (deepestDependencyLayer + 1)
  for (const task of sortedTasks) {
    const maxDependencyLayer = Math.max(
      -1,
      ...task.dependencies().map((dep) => layersByKey.get(dep.key) ?? 0)
    );
    layersByKey.set(task.key, maxDependencyLayer + 1);
  }
  // Group tasks by layer
  const layers: AnyTask[][] = [];
  for (const task of sortedTasks) {
    const layer = layersByKey.get(task.key)!;
    if (!layers[layer]) layers[layer] = [];
    layers[layer].push(task);
  }
  return layers;
};

// ------------------------------------------------------------------
// Task class
// ------------------------------------------------------------------

export const isTask = (value: unknown): value is Task<any[], any> =>
  value instanceof Task;

interface TaskProps<Args extends any[], Result> {
  fn: (...args: UnwrappedArguments<Args>) => Result;
  args: TaskArguments<Args>;
  key?: string;
  storage?: TaskStorage<Awaited<Result>>;
}

class Task<Args extends any[], Result> {
  readonly fn: (...args: UnwrappedArguments<Args>) => Result;
  readonly args: TaskArguments<Args>;
  readonly key: string;
  storage?: TaskStorage<Awaited<Result>>;

  constructor(props: TaskProps<Args, Result>) {
    this.fn = props.fn;
    this.args = props.args;
    this.key = props.key || `${registerName(this.fn)}_${hash(this.args)}`;
    this.storage = props.storage;
    this.dependencies = this.dependencies.bind(this);
    this.forEachTask = this.forEachTask.bind(this);
    this.setDefaultStorage = this.setDefaultStorage.bind(this);
    this.persist = this.persist.bind(this);
    this.result = this.result.bind(this);
  }

  /**
   * Return a de-duplicated list of this task's dependencies.
   */
  dependencies(options?: { deep?: boolean }): Task<any[], any>[] {
    const deps = removeDuplicateTasks(this.args.filter(isTask));
    if (!options?.deep) return deps;
    const seen = new Set(deps.map((task) => task.key));
    const work: Task<any[], any>[] = [...deps];
    while (work.length) {
      const task = work.pop()!;
      if (seen.has(task.key)) continue;
      seen.add(task.key);
      deps.push(task);
      work.push(...task.args.filter(isTask));
    }
    return deps;
  }

  /**
   * Execute a callback on every `Task` instance that will run
   * when this task is executed, including this task itself.
   */
  forEachTask(callback: (task: AnyTask) => void): void {
    const seen = new Set<AnyTask>();
    const work: AnyTask[] = [this];
    while (work.length) {
      const task = work.pop()!;
      if (seen.has(task)) continue;
      seen.add(task);
      callback(task);
      work.push(...task.dependencies());
    }
  }

  /**
   * Set default storage for this task and all its dependencies.
   */
  setDefaultStorage(storage: TaskStorage<Result> | TaskStorage<any>): void {
    this.forEachTask((task) => {
      task.storage ??= storage;
    });
  }

  /**
   * Ensure the task result exists in storage.
   */
  async persist(options?: Abortable): Promise<void> {
    const signal = options?.signal;
    const { key, storage } = this;
    if (!storage) {
      throw new TaskStorageError(
        `Cannot persist task "${key}", no storage provided`
      );
    }
    signal?.throwIfAborted();
    const existingResult = await getFromStorage(storage, key);
    if (existingResult.ok) return;
    const args = await unwrap(this.args, options);
    signal?.throwIfAborted();
    const value = await this.fn(...args);
    signal?.throwIfAborted();
    const result = await setToStorage(storage, key, value);
    if (!result.ok) throw result.error;
  }

  /**
   * Compute and return the result of the task.
   * The task and its dependencies will be converted into a DAG and executed with maximum parallelism.
   */
  async result(options?: Abortable): Promise<Result> {
    const signal = options?.signal;
    if (!this.storage) this.setDefaultStorage(createDefaultStorage());
    if (!this.storage) throw new TaskStorageError("setDefaultStorage failed");
    const storage = this.storage;
    // Check if the result is already in storage
    signal?.throwIfAborted();
    let result = await getFromStorage(storage, this.key);
    if (result.ok) return result.value;
    // Create a DAG of tasks and persist the results with maximum parallelism
    const layers = dependencyLayers(this);
    for (const layer of layers) {
      signal?.throwIfAborted();
      await Promise.all(layer.map((task) => task.persist({ signal })));
    }
    // Retrieve the computed result from storage
    signal?.throwIfAborted();
    result = await getFromStorage(storage, this.key);
    if (result.ok) return result.value;
    throw result.error;
  }
}

type TaskCreator<Args extends any[], Result> = (
  ...args: TaskArguments<Args>
) => Task<Args, Result>;

// function task<Args extends any[], Result>(
//   fn: (...args: Args) => Result,
//   options?: { name?: string }
// ): TaskCreator<Args, Result>;

// function task<Args extends any[], Result>(
//   fn: (...args: Args) => Result,
//   options: { name: string }
// ): TaskCreator<Args, Result>;

export function task<Args extends any[], Result>(
  fn: (...args: UnwrappedArguments<Args>) => Result,
  options?: {
    key?: string | ((...args: TaskArguments<Args>) => string);
    storage?: TaskStorage<Awaited<Result>>;
  }
): TaskCreator<Args, Result> {
  const getKey = (...args: TaskArguments<Args>) => {
    if (!options?.key) return undefined;
    if (typeof options.key === "function") return options.key(...args);
    return options.key;
  };
  const storage = options?.storage;
  return (...args: TaskArguments<Args>) => {
    const key = getKey(...args);
    const task = new Task({ fn, args, key, storage });
    return task;
  };
}
