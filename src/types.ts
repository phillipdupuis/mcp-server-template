import type {
  ResourceTemplate,
  ResourceTemplateArgument,
  Tool,
  ToolParameters,
} from "fastmcp";
import type { Server, SessionAuthData, SessionContext } from "./server.js";

export type { Server, SessionAuthData, SessionContext };

/**
 * Type-safe wrapper for creating tool definitions.
 */
export const createTool = <
  TOOL_PARAMS extends ToolParameters,
  AUTH_DATA extends SessionAuthData = SessionAuthData
>(
  toolConfig: Tool<AUTH_DATA, TOOL_PARAMS>
) => toolConfig;

/**
 * Type-safe wrapper for creating resource templates.
 */
export const createResourceTemplate = <
  ARGUMENTS extends ResourceTemplateArgument[]
>(
  resourceTemplateConfig: ResourceTemplate<ARGUMENTS>
) => resourceTemplateConfig;
