import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getTaskTool } from '../tools/definitions/getTask.js';

const searchTasksHandler = async () => ({
  content: [{ type: 'text' as const, text: '[]' }],
});

function desc(toolName: keyof typeof TOOL_DESCRIPTIONS): string {
  return TOOL_DESCRIPTIONS[toolName] ?? toolName;
}

function ann(_toolName: string): Record<string, boolean> {
  return { readOnlyHint: true };
}

export function registerTaskTools(server: McpServer): number {
  server.tool(
    'get_task',
    desc('get_task'),
    getTaskTool.schema.shape,
    ann('get_task'),
    getTaskTool.handler
  );

  server.registerTool(
    'search_tasks',
    {
      description: desc('search_tasks'),
      inputSchema: { query: z.string() },
    },
    searchTasksHandler
  );

  return 2;
}

