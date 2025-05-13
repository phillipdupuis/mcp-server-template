import type { Stats as FileStats } from "node:fs";

import type { StandardSchemaV1 } from "@standard-schema/spec";
import { SchemaError } from "@standard-schema/utils";
import { Buffer } from "node:buffer";
import type { Abortable } from "node:events";
import fs from "node:fs/promises";
import path from "node:path";
import { SERVER_APPDATA_DIRS } from "./constants.js";
import { hash } from "./utils.js";

/** The error thrown if an object fails to satisfy constraint(s) */
export class ValidationError extends AggregateError {
  name = "ValidationError";
}

/**
 * The underlying interface for key-value storage of data as buffers.
 * This can be a file system, S3, redis, a database, etc.
 * `ObjectStore` is a wrapper around this interface that provides additional
 * functionality such as validation and transformation of data.
 */
interface StorageProvider<Attributes extends unknown> {
  delete: (key: string, options?: Abortable) => Promise<void>;
  getAttributes: (key: string) => Promise<Attributes>;
  get: (key: string, options?: Abortable) => Promise<Buffer>;
  has: (key: string) => Promise<boolean>;
  keys: () => Promise<string[]>;
  set: (key: string, buffer: Buffer, options?: Abortable) => Promise<void>;
}

export interface FileAttributes extends FileStats {
  file: string;
}

export interface FileSystemProvider extends StorageProvider<FileAttributes> {
  readonly directory: string;
}

const fsProvider = (dir: string): StorageProvider<FileAttributes> => ({
  delete: (key) => fs.unlink(path.join(dir, key)),
  getAttributes: async (key) => {
    const file = path.join(dir, key);
    const stats = await fs.stat(file);
    return { ...stats, file };
  },
  get: (key, options) => fs.readFile(path.join(dir, key), options),
  has: async (key) => {
    try {
      await fs.access(path.join(dir, key), fs.constants.F_OK);
      return true;
    } catch {
      return false;
    }
  },
  keys: () => fs.readdir(dir),
  set: async (key, buffer, options) => {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, key), buffer, options);
  },
});

// const syncStorageProviders = async <SourceAttributes, TargetAttributes>(
//   source: StorageProvider<SourceAttributes>,
//   target: StorageProvider<TargetAttributes>,
//   options: {
//     filter: (
//       key: string,
//       sourceAttributes: SourceAttributes,
//       targetAttributes: TargetAttributes | undefined
//     ) => boolean | Promise<boolean>;
//     signal?: AbortSignal;
//     transform?: (data: Buffer) => Buffer | Promise<Buffer>;
//   }
// ) => {
//   const { filter, signal, transform } = options ?? {};
//   const keys = await source.keys();
//   let skipped = 0;
//   let synced = 0;
//   await Promise.all(
//     keys.map(async (key) => {
//       signal?.throwIfAborted();
//       const sourceAttributes = await source.getAttributes(key);
//       const targetAttributes = await safe(target.getAttributes(key));
//       const shouldSync = await filter(
//         key,
//         sourceAttributes,
//         targetAttributes.ok ? targetAttributes.value : undefined
//       );
//       if (!shouldSync) {
//         skipped++;
//         return;
//       }
//       let data = await source.get(key, { signal });
//       if (transform) data = await transform(data);
//       await target.set(key, data, { signal });
//       synced++;
//     })
//   );
//   return { skipped, synced };
// };

/**
 * A callable that checks if a storage entry is valid and should be kept/used.
 */
type Constraint<Attributes extends unknown> = ((
  attributes: Attributes
) => boolean | Promise<boolean>) & {
  message?: string;
};

/**
 * Check if the provided constraints are satisfied by the attributes.
 * If any constraints fail, the associated errors are returned.
 */
export const checkConstraints = async <Attributes extends unknown>(
  constraints: Constraint<Attributes>[],
  attributes: Attributes,
  options?: Abortable
): Promise<{ ok: true } | { ok: false; errors: unknown[] }> => {
  if (!constraints || !constraints.length) return { ok: true };
  const signal = options?.signal;
  signal?.throwIfAborted();
  const results = await Promise.allSettled(
    constraints.map(async (constraint) => {
      signal?.throwIfAborted();
      const ok = await constraint(attributes);
      if (!ok) throw new Error(constraint.message);
    })
  );
  const errors = results
    .filter((r) => r.status === "rejected")
    .map((r) => r.reason as unknown);
  if (errors.length) return { ok: false, errors };
  return { ok: true };
};

export const createConstraint = <Attributes extends unknown>(
  fn: (attributes: Attributes) => boolean | Promise<boolean>,
  message: string
): Constraint<Attributes> => Object.assign(fn, { message });

type Duration =
  | number
  | { ms: number }
  | { seconds: number }
  | { minutes: number }
  | { hours: number }
  | { days: number };

const durationToMs = (duration: Duration): number => {
  if (typeof duration === "number") return duration;
  if ("ms" in duration) return duration.ms;
  if ("seconds" in duration) return duration.seconds * 1000;
  if ("minutes" in duration) return duration.minutes * 60 * 1000;
  if ("hours" in duration) return duration.hours * 60 * 60 * 1000;
  if ("days" in duration) return duration.days * 24 * 60 * 60 * 1000;
  throw new Error(`Invalid duration: ${duration}`);
};

interface HasAge {
  mtimeMs: number;
}

export const maxAge = (duration: Duration): Constraint<HasAge> =>
  createConstraint(({ mtimeMs }: HasAge) => {
    const now = Date.now();
    const maxAge = durationToMs(duration);
    return now - mtimeMs < maxAge;
  }, `Max age exceeded: ${JSON.stringify(duration)}`);

/**
 * Handlers for transforming buffers to/from other data types.
 */
type Transforms<Data> = {
  decode: (buffer: Buffer) => Data | Promise<Data>;
  encode: (data: Data) => Buffer | Promise<Buffer>;
};

const textTransforms = (encoding: BufferEncoding): Transforms<string> => ({
  decode: async (buffer) => buffer.toString(encoding),
  encode: async (data) => Buffer.from(data, encoding),
});

const jsonTransforms = <Schema extends StandardSchemaV1>(
  schema: Schema
): Transforms<StandardSchemaV1.InferOutput<Schema>> => ({
  decode: async (buffer) => {
    const str = buffer.toString("utf-16le");
    const data = JSON.parse(str);
    const parsedData = await schema["~standard"].validate(data);
    if (parsedData.issues) throw new SchemaError(parsedData.issues);
    return parsedData.value;
  },
  encode: async (data) => Buffer.from(JSON.stringify(data), "utf-16le"),
});

export interface ObjectStorageProps<Attributes extends unknown, Data = Buffer> {
  provider: StorageProvider<Attributes>;
  constraints?: Constraint<Attributes>[];
  transforms?: Transforms<Data>;
}

export class ObjectStorage<Attributes extends unknown, Data = Buffer> {
  readonly provider: StorageProvider<Attributes>;
  readonly constraints: Constraint<Attributes>[] | undefined;
  readonly transforms: Transforms<Data> | undefined;

  constructor({
    provider,
    constraints,
    transforms,
  }: ObjectStorageProps<Attributes, Data>) {
    this.provider = provider;
    this.constraints = constraints;
    this.transforms = transforms;
    this.delete = this.delete.bind(this);
    this.ensure = this.ensure.bind(this);
    this.getAttributes = this.getAttributes.bind(this);
    this.get = this.get.bind(this);
    this.has = this.has.bind(this);
    this.keys = this.keys.bind(this);
    this.set = this.set.bind(this);
    this.validate = this.validate.bind(this);
  }

  /** Store objects on the local file system */
  static fs = <Data>({
    directory,
    ...options
  }: { directory: string } & Omit<
    ObjectStorageProps<FileAttributes, Data>,
    "provider"
  >) => {
    return new ObjectStorage<FileAttributes, Data>({
      ...options,
      provider: fsProvider(path.resolve(directory)),
    });
  };

  /**
   * Returns a new ObjectStore with the provided constraints.
   */
  withConstraints(
    ...constraints: Constraint<Attributes>[]
  ): ObjectStorage<Attributes, Data> {
    return new ObjectStorage<Attributes, Data>({
      provider: this.provider,
      transforms: this.transforms,
      constraints,
    });
  }

  /**
   * Returns a new ObjectStore with the provided transforms.
   */
  withTransforms<T>(transforms: Transforms<T>): ObjectStorage<Attributes, T> {
    return new ObjectStorage<Attributes, T>({
      provider: this.provider,
      constraints: this.constraints,
      transforms,
    });
  }

  /**
   * Returns a new ObjectStore which uses the provided text encoding for transforms.
   */
  withEncoding(encoding: BufferEncoding): ObjectStorage<Attributes, string> {
    return this.withTransforms(textTransforms(encoding));
  }

  /**
   * Returns a new ObjectStore which uses the provided schema for transforms and validation.
   * Assumes the data is JSON-serializable.
   */
  withSchema<T extends StandardSchemaV1>(
    schema: T
  ): ObjectStorage<Attributes, StandardSchemaV1.InferOutput<T>> {
    return this.withTransforms(jsonTransforms(schema));
  }

  /**
   * Remove an object from storage.
   * Fulfills with `undefined` on success.
   * This does not check if the key exists.
   */
  async delete(key: string, options?: Abortable): Promise<void> {
    await this.provider.delete(key, options);
  }

  /**
   * Loop through all the keys in storage and delete any that are invalid according to the constraints.
   */
  async deleteInvalidEntries(options?: Abortable) {
    if (!this.constraints || !this.constraints.length) {
      console.warn("No constraints defined, skipping deleteInvalidEntries");
      return;
    }
    const signal = options?.signal;
    signal?.throwIfAborted();
    const keys = await this.keys();
    const results = await Promise.allSettled(
      keys.map(async (key) => {
        signal?.throwIfAborted();
        const exists = await this.has(key);
        if (!exists) throw Error(`Key not found: ${key}`);
        const attributes = await this.getAttributes(key);
        const validation = await this.validate(attributes, { signal });
        if (validation.ok) return { deleted: false };
        await this.delete(key, { signal });
        return { deleted: true };
      })
    );
    let ok = 0;
    let deleted = 0;
    let errors: unknown[] = [];
    for (const result of results) {
      if (result.status === "fulfilled") {
        if (result.value.deleted) deleted++;
        else ok++;
      } else {
        errors.push(result.reason);
      }
    }
    return { ok, deleted, errors };
  }

  /**
   * Ensure that an object exists in storage and is valid.
   * If the object does not exist or the attributes are invalid,
   * storage is updated with the result of the provided function.
   */
  async ensure(
    key: string,
    fn: () => Promise<Data>,
    options?: Abortable
  ): Promise<void> {
    try {
      const attributes = await this.getAttributes(key);
      const validation = await this.validate(attributes, options);
      if (!validation.ok) throw new ValidationError(validation.errors);
    } catch {
      await this.set(key, await fn(), options);
    }
  }

  /**
   * Get the attributes for an object in storage.
   * No validation or constraint-checking is performed.
   */
  async getAttributes(key: string): Promise<Attributes> {
    return this.provider.getAttributes(key);
  }

  /**
   * Get an object's data from storage.
   */
  async get(
    key: string,
    options?: Abortable & { withAttributes?: false }
  ): Promise<Data>;

  /**
   * Get an object's data and attributes from storage.
   */
  async get(
    key: string,
    options: Abortable & { withAttributes: true }
  ): Promise<{ data: Data; attributes: Attributes }>;

  async get(
    key: string,
    { signal, withAttributes }: Abortable & { withAttributes?: boolean } = {}
  ): Promise<Data | { data: Data; attributes: Attributes }> {
    const attributes = await this.getAttributes(key);
    const validation = await this.validate(attributes, { signal });
    if (!validation.ok) throw new ValidationError(validation.errors);
    const buffer = await this.provider.get(key, { signal });
    const data = (await this.transforms?.decode(buffer)) ?? (buffer as Data);
    if (withAttributes) return { data, attributes };
    return data;
  }

  /**
   * Check if an object exists in storage.
   */
  async has(key: string): Promise<boolean> {
    return this.provider.has(key);
  }

  /**
   * Get a list of all the keys that currently exist.
   */
  async keys(): Promise<string[]> {
    return this.provider.keys();
  }

  /**
   * Save an object to storage and return its attributes.
   */
  async set(key: string, data: Data, options?: Abortable): Promise<Attributes> {
    const buffer = (await this.transforms?.encode(data)) ?? (data as Buffer);
    await this.provider.set(key, buffer, options);
    return this.getAttributes(key);
  }

  /**
   * Check if an object is valid according to the storage constraints.
   * If any constraints fail, the associated errors are returned.
   */
  async validate(
    attributes: Attributes,
    options?: Abortable
  ): Promise<{ ok: true } | { ok: false; errors: unknown[] }> {
    return checkConstraints(this.constraints ?? [], attributes, options);
  }
}

export const download = async (
  url: URL | string,
  { signal, ttl }: Abortable & { ttl?: Duration } = {}
) => {
  let storage = ObjectStorage.fs({
    directory: path.join(SERVER_APPDATA_DIRS.cache, "downloads"),
  });
  if (ttl) storage = storage.withConstraints(maxAge(ttl));
  return storage.ensure(hash([url.toString()]), async () => {
    const resp = await fetch(url, { signal });
    if (!resp.ok) {
      throw new Error(`Failed to fetch ${url}: ${resp.statusText}`);
    }
    return Buffer.from(await resp.arrayBuffer());
  });
};
