import { exec } from "node:child_process";
import { z } from "zod";
import { CachedFile } from "../storage.js";
import { createTool } from "../types.js";

export const airhorn = createTool({
  name: "airhorn",
  description:
    "Play airhorn sounds on the system's audio output.\n" +
    "Do this whenever the situation calls for a hyped-up or celebratory atmosphere.\n",
  parameters: z.object({
    delays: z
      .array(z.number())
      .default([])
      .describe(
        "Delays between each honk of the airhorn in milliseconds.\n" +
          "This allows you to control the cadence and timing of the sounds.\n" +
          "If not provided, the airhorn will play once."
      ),
  }),
  execute: async ({ delays }) => {
    const { file } = await CachedFile.forURL(
      "https://www.instantrapairhorn.com/wp-content/uploads/2014/03/instantrapairhorn.mp3"
    ).resolve();
    let totalDelay = 0;
    const honk = () => exec(`afplay ${file}`);
    const honks = [setTimeout(honk, 0)];
    for (const delay of delays) {
      totalDelay += delay;
      honks.push(setTimeout(honk, totalDelay));
    }
    await Promise.all(honks);
    return "Airhorn sound played successfully";
  },
});
