#!/usr/bin/env node --import tsx

import fs from "node:fs/promises";
import { parseArgs } from "node:util";
import colors from "picocolors";
import {
  CLAUDE_DESKTOP_CONFIG_FILE,
  PACKAGE_JSON,
  SERVER_CONFIG,
} from "../src//constants.js";

const CLAUDE_DESKTOP_HELP_URL =
  "https://modelcontextprotocol.io/quickstart/user";

const { values: options } = parseArgs({
  options: {
    force: {
      type: "boolean",
      short: "f",
      default: false,
      description:
        "Force add the MCP server to the config file, even if it already exists",
    },
  },
});

const main = async () => {
  // Ensure the config file exists and is readable/writable
  await fs.access(
    CLAUDE_DESKTOP_CONFIG_FILE,
    fs.constants.R_OK | fs.constants.W_OK
  );
  // Read the config file
  const config = JSON.parse(
    await fs.readFile(CLAUDE_DESKTOP_CONFIG_FILE, "utf8")
  );
  // Check if the config file is valid
  const mcpServers = config.mcpServers;
  if (!mcpServers || typeof mcpServers !== "object") {
    console.error(
      colors.red(
        `Invalid config file, 'mcpServers' should be an object: ${CLAUDE_DESKTOP_CONFIG_FILE}`
      )
    );
    return;
  }
  // Check if the MCP server already exists
  const existingServer = mcpServers[PACKAGE_JSON.name];
  if (existingServer) {
    if (!options.force) {
      console.warn(
        colors.yellow(
          `MCP server ${PACKAGE_JSON.name} already exists; use --force to overwrite it`
        )
      );
      return;
    }
    console.warn(
      colors.yellow(
        `MCP server ${PACKAGE_JSON.name} already exists; overwriting it.`
      )
    );
  }
  // Add the MCP server to the config file
  config.mcpServers[PACKAGE_JSON.name] = SERVER_CONFIG;
  await fs.writeFile(
    CLAUDE_DESKTOP_CONFIG_FILE,
    JSON.stringify(config, null, 2),
    "utf8"
  );
  // Tell the user the config file was updated successfully
  console.log(
    colors.green(
      `Added MCP server ${PACKAGE_JSON.name} to ${CLAUDE_DESKTOP_CONFIG_FILE}\nRestart Claude Desktop to begin using it`
    )
  );
};

main().catch((error) => {
  console.error(error);
  console.log(
    colors.cyan(
      `For more information, please visit:\n${CLAUDE_DESKTOP_HELP_URL}`
    )
  );
});
