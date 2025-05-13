import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";
import { openai } from "@ai-sdk/openai";
import {
  experimental_generateImage as _generateImage,
  generateText as _generateText,
  createProviderRegistry,
  Experimental_GenerateImageResult as GenerateImageResult,
} from "ai";
import type { Content, ImageContent } from "fastmcp";
import path from "node:path";
import { z } from "zod";
import { SERVER_APPDATA_DIRS } from "./constants.js";
import { ObjectStorage } from "./storage.js";
import { hash, memoize } from "./utils.js";

// Required env vars for each provider:
// anthropic: ANTHROPIC_API_KEY
// google: GOOGLE_GENERATIVE_AI_API_KEY
// openai: OPENAI_API_KEY

export type { Content };

export const providerRegistry = createProviderRegistry(
  {
    anthropic,
    google,
    openai,
  },
  { separator: "_" }
);

const sortOptionsForHashing = <T extends Record<string, unknown>>(
  options: T
): T => {
  return Object.keys(options)
    .sort()
    .reduce((result, key) => {
      result[key as keyof T] = options[key as keyof T];
      return result;
    }, {} as T);
};

// ----------------------------------------------------------------
// Text Generation
// ----------------------------------------------------------------

export type LanguageModelId = Parameters<
  (typeof providerRegistry)["languageModel"]
>[0];

interface TextGenerationSettings {
  modelId: LanguageModelId;
  ignoreCache?: boolean;
  maxTokens?: number;
  system?: string;
  temperature?: number;
  timeout?: number;
  abortSignal?: AbortSignal;
}

const textResultSchema = z
  .object({
    text: z.string(),
    reasoning: z.string().optional(),
    usage: z.object({
      promptTokens: z.number(),
      completionTokens: z.number(),
      totalTokens: z.number(),
    }),
    request: z.any(),
    response: z.any(),
  })
  .passthrough();

type TextResult = z.infer<typeof textResultSchema>;

const textResultStorage = ObjectStorage.fs({
  directory: path.join(SERVER_APPDATA_DIRS.cache, "ai-text-results"),
}).withSchema(textResultSchema);

const textResultKey = (
  content: Content[],
  settings: TextGenerationSettings
): string => {
  const { modelId, abortSignal, ignoreCache, ...options } = settings;
  const sortedOptions = sortOptionsForHashing(options);
  const baseKey = hash([content, sortedOptions]);
  return `${modelId}_${baseKey}.json`;
};

const textGenerator = async (
  content: Content[],
  settings: TextGenerationSettings
): Promise<TextResult> => {
  const { modelId, ignoreCache, ...options } = settings;
  const result = await _generateText({
    model: providerRegistry.languageModel(modelId),
    messages: [
      {
        role: "user",
        content: content.map((part) =>
          part.type === "image" ? { ...part, image: part.data } : part
        ),
      },
    ],
    ...options,
  });
  return textResultSchema.parse(result);
};

/**
 * Generate text using the provided content and settings.
 *
 * If the content and settings are identical to a previous call,
 * the cached result will be used *unless* `ignoreCache` is set to true.
 */
export const generateText = memoize(textGenerator, {
  condition: (_, { ignoreCache }) => !ignoreCache,
  key: textResultKey,
  get: textResultStorage.get,
  set: textResultStorage.set,
});

// ----------------------------------------------------------------
// Image Generation
// ----------------------------------------------------------------

export type KnownImageModelId =
  | "openai_gpt-image-1"
  | "openai_dall-e-3"
  | "openai_dall-e-2";

export type ImageModelId =
  | KnownImageModelId
  | Parameters<(typeof providerRegistry)["imageModel"]>[0];

type InheritedImageGenerationSettings = Omit<
  Parameters<typeof _generateImage>[0],
  "model" | "prompt"
>;

type ImageGenerationSettings =
  | {
      modelId: ImageModelId;
      ignoreCache?: boolean;
    } & InheritedImageGenerationSettings;

type ImageResult = Omit<GenerateImageResult, "image" | "images"> & {
  images: ImageContent[];
};

const imageResultSchema = z
  .object({
    images: z.array(
      z.object({
        data: z.string(),
        mimeType: z.string(),
        type: z.literal("image").default("image"),
      })
    ),
    warnings: z.array(z.any()),
    responses: z.array(z.any()),
  })
  .passthrough();

const imageResultKey = (
  prompt: string,
  settings: ImageGenerationSettings
): string => {
  const { modelId, abortSignal, ignoreCache, ...options } = settings;
  const sortedOptions = sortOptionsForHashing(options);
  const baseKey = hash([prompt, sortedOptions]);
  return `${modelId}_${baseKey}.json`;
};

const imageResultStorage = ObjectStorage.fs({
  directory: path.join(SERVER_APPDATA_DIRS.cache, "ai-image-results"),
}).withSchema(imageResultSchema);

const imageGenerator = async (
  prompt: string,
  settings: ImageGenerationSettings
): Promise<ImageResult> => {
  const { modelId, ignoreCache, ...options } = settings;
  const { images, ...rest } = await _generateImage({
    model: providerRegistry.imageModel(modelId),
    prompt,
    ...options,
  });
  return {
    ...rest,
    images: images.map((image) => ({
      ...image,
      data: image.base64,
      type: "image",
    })),
  };
};

/**
 * Generate images using the provided content and settings.
 *
 * If the prompt and settings are identical to a previous call,
 * the cached result will be used *unless* `ignoreCache` is set to true.
 */
export const generateImages = memoize(imageGenerator, {
  condition: (_, { ignoreCache }) => !ignoreCache,
  key: imageResultKey,
  get: imageResultStorage.get,
  set: imageResultStorage.set,
});

/**
 * Internal utilities that are exported solely for testing purposes.
 */
export const _internals = {
  sortOptionsForHashing,
  textResultStorage,
  textResultKey,
  textResultSchema,
  textGenerator,
  imageResultStorage,
  imageResultKey,
  imageResultSchema,
  imageGenerator,
};

const viewImage = async (result: ImageResult) => {
  const { default: fs } = await import("fs/promises");
  const { exec } = await import("child_process");
  const { promisify } = await import("util");
  const execAsync = promisify(exec);
  const tmp = SERVER_APPDATA_DIRS.temp;
  await fs.mkdir(tmp, { recursive: true });
  const image = result.images[0];
  const imageBuffer = Buffer.from(image.data, "base64");
  const imagePath = path.join(tmp, "image.png");
  await fs.writeFile(imagePath, imageBuffer);
  await execAsync(`open ${imagePath}`);
};

const main = async () => {
  const imageArgs = [
    "A cute cat",
    {
      modelId: "openai_dall-e-2",
      n: 1,
    },
  ] as const;

  console.log(
    "Image directory",
    path.join(SERVER_APPDATA_DIRS.cache, "ai-image-results")
  );

  const result = await generateImages(...imageArgs);

  await viewImage(result);
};

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
