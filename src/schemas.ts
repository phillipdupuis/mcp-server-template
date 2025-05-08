import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { Abortable } from "node:events";

import { SchemaError } from "@standard-schema/utils";
import fs from "node:fs/promises";

/**
 * Validate the input against the provided schema.
 * Throw a `SchemaError` detailing all issues if validation fails.
 */
export const validate = async <T extends StandardSchemaV1>(
  schema: T,
  input: StandardSchemaV1.InferInput<T>
): Promise<StandardSchemaV1.InferOutput<T>> => {
  let result = schema["~standard"].validate(input);
  if (result instanceof Promise) result = await result;
  if (result.issues) throw new SchemaError(result.issues);
  return result.value;
};

/**
 * Create a validator function for the provided schema. Useful for callbacks.
 */
export const validator =
  <T extends StandardSchemaV1>(
    schema: T
  ): ((
    input: StandardSchemaV1.InferInput<T>
  ) => Promise<StandardSchemaV1.InferOutput<T>>) =>
  (input: StandardSchemaV1.InferInput<T>) =>
    validate(schema, input);

/**
 * Read JSON from the file and then validate it against the provided schema.
 */
export const readJson = async <T extends StandardSchemaV1>(
  file: string,
  { schema, signal }: { schema: T } & Abortable
): Promise<StandardSchemaV1.InferOutput<T>> =>
  fs
    .readFile(file, { encoding: "utf8", signal })
    .then((text) => validate(schema, JSON.parse(text)));

/**
 * Validate JSON against the provided schema and then write it to the file.
 * Returns the validated data after writing.
 */
export const writeJson = async <T extends StandardSchemaV1>(
  file: string,
  input: StandardSchemaV1.InferInput<T>,
  { schema, signal }: { schema: T } & Abortable
): Promise<StandardSchemaV1.InferOutput<T>> => {
  const data = await validate(schema, input);
  await fs.writeFile(file, JSON.stringify(data, null, 2), {
    encoding: "utf8",
    signal,
  });
  return data;
};
