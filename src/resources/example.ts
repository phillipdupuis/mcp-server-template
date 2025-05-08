import type { Resource } from "fastmcp";
import os from "node:os";

const hostname = os.hostname();

export const osInfoForCurrentDevice: Resource = {
  uri: `device://${hostname}/os-info`,
  name: `OS Info for current device (${hostname})`,
  description: "OS Info for current device",
  mimeType: "application/json",
  load: async () => {
    return [
      {
        text: JSON.stringify(
          {
            hostname,
            platform: os.platform(),
            release: os.release(),
            arch: os.arch(),
            memory: os.totalmem(),
          },
          null,
          2
        ),
      },
    ];
  },
};
