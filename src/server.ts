#!/usr/bin/env node --import tsx

import type { Context } from "fastmcp";
import { FastMCP } from "fastmcp";
import { PACKAGE_JSON } from "./constants.js";
import { osInfoForCurrentDevice } from "./resources/example.js";
import { airhorn } from "./tools/airhorn.js";

const server = new FastMCP({
  name: PACKAGE_JSON.name,
  version: PACKAGE_JSON.version,
});

server.addTool(airhorn);
server.addResource(osInfoForCurrentDevice);

// An example of handling unstable or platform-dependent code
try {
  server.addTool(await import("./tools/say.js").then(({ say }) => say));
} catch (error) {
  console.error(`Failed to load tool "say"`, error);
}

server.start({
  transportType: "stdio",
});

export type Server = typeof server;
export type SessionAuthData = typeof server extends FastMCP<infer T>
  ? T
  : never;
export type SessionContext = Context<SessionAuthData>;
