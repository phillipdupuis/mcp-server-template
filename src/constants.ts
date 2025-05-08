import envPaths from "env-paths";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROJECT_ROOT = path.join(__dirname, "..");

export interface PackageJson {
  name: string;
  version: `${number}.${number}.${number}`;
  [key: string]: unknown;
}

/**
 * The parsed contents of the package.json file for this MCP server.
 */
export const PACKAGE_JSON: PackageJson = JSON.parse(
  await fs.readFile(path.join(PROJECT_ROOT, "package.json"), "utf8")
);

/**
 * The application directories that this MCP server can use for storing
 * data, config, cache, etc. on the file system.
 * Note: these paths may not exist yet.
 */
export const SERVER_APPDATA_DIRS = envPaths(PACKAGE_JSON.name);

export interface EnvVarInfo {
  default?: string;
  description?: string;
  inherit?: boolean;
}

/**
 * The environment variables that can/should be set when running this MCP server.
 * This is used to automatically generate documentation and config templates.
 */
export const SERVER_ENVIRONMENT_VARS: Record<string, EnvVarInfo> = {};

export interface McpServerConfig {
  command: string;
  args: string[];
  env: Record<string, string>;
}

/**
 * The default config for this MCP server.
 * This allows applications like Claude to run and interact with this server.
 * Helpful documentation can be found here:
 * https://docs.aws.amazon.com/amazonq/latest/qdeveloper-ug/command-line-mcp-configuration.html
 */
export const SERVER_CONFIG = {
  command: process.execPath,
  args: [path.join(PROJECT_ROOT, "dist", "server.js")],
  env: Object.fromEntries(
    Object.entries(SERVER_ENVIRONMENT_VARS).map(([key, value]) => [
      key,
      (value.inherit && process.env[key]) || value.default || "",
    ])
  ),
} satisfies McpServerConfig;

/**
 * The path to the config file for claude desktop; this is where MCP servers are configured.
 */
export const CLAUDE_DESKTOP_CONFIG_FILE = path.join(
  envPaths("Claude", { suffix: "" }).data,
  "claude_desktop_config.json"
);
