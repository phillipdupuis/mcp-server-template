import { execa } from "execa";
import { z } from "zod";
import { createTool } from "../types.js";

const getDescription = async () => {
  const { stdout } = await execa("say", ["--voice", "?"]);
  const voices = stdout.split("\n").map((line) => {
    const parts = line.trim().split(/\s+/);
    const langIndex = parts.findIndex((part) => part.includes("_"));
    if (langIndex === -1) return undefined;
    const name = parts.slice(0, langIndex).join(" ").trim();
    const lang = parts[langIndex];
    return { name, lang };
  });
  const voicesByLang = voices.reduce((acc, voice) => {
    if (!voice) return acc;
    (acc[voice.lang] ??= []).push(voice.name);
    return acc;
  }, {} as Record<string, string[]>);
  let desc =
    "Convert text to audible speech using the system's text-to-speech engine.\n\n";
  desc += "<available_voices>\n";
  for (const [lang, voices] of Object.entries(voicesByLang)) {
    desc += `<lang="${lang}">\n`;
    desc += voices.map((voice) => `"${voice}"`).join("\n");
    desc += "\n";
    desc += `</lang>\n`;
  }
  desc += "</available_voices>\n";
  return desc;
};

const parameters = z.object({
  text: z.string().describe("The text to be spoken out loud."),
  voice: z
    .string()
    .optional()
    .describe("The specific voice to use for speech synthesis."),
  rate: z
    .number()
    .optional()
    .describe("The speech rate to be used, in words per minute."),
});

export const say = createTool({
  name: "say",
  description: await getDescription(),
  parameters,
  execute: async ({ text, rate, voice }) => {
    const args: string[] = [];
    if (rate) args.push("-r", rate.toString());
    if (voice) args.push("-v", voice);
    const result = await execa("say", args, { input: text });
    if (result.failed) {
      console.error(result.message);
      return "Error speaking text";
    } else {
      return "Text spoken successfully";
    }
  },
});
