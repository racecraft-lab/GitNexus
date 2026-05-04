import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createKnowledgeGraph } from '../../src/core/graph/graph.js';
import { processesPhase } from '../../src/core/ingestion/pipeline-phases/processes.js';
import { toolsPhase } from '../../src/core/ingestion/pipeline-phases/tools.js';
import type {
  PhaseResult,
  PipelineContext,
} from '../../src/core/ingestion/pipeline-phases/types.js';
import type { KnowledgeGraph } from '../../src/core/graph/types.js';
import type { GraphNode, GraphRelationship, NodeLabel } from 'gitnexus-shared';

function makeCtx(graph: KnowledgeGraph, repoPath = 'D:/tmp/repo'): PipelineContext {
  return {
    repoPath,
    graph,
    onProgress: () => {},
    pipelineStart: 0,
  };
}

function phaseResult<T>(phaseName: string, output: T): PhaseResult<T> {
  return { phaseName, output, durationMs: 0 };
}

function addNode(
  graph: KnowledgeGraph,
  id: string,
  label: NodeLabel,
  name: string,
  filePath: string,
) {
  graph.addNode({
    id,
    label,
    properties: {
      name,
      filePath,
      startLine: 1,
      endLine: 1,
      isExported: true,
      content: '',
    },
  } satisfies GraphNode);
}

function addCall(graph: KnowledgeGraph, sourceId: string, targetId: string) {
  graph.addRelationship({
    id: `${sourceId}->${targetId}`,
    sourceId,
    targetId,
    type: 'CALLS',
    confidence: 1,
    reason: 'direct',
  } satisfies GraphRelationship);
}

describe('Tool handler and process linking phases', () => {
  it('detects MCP TypeScript server.tool and registerTool registrations', async () => {
    const repoPath = await mkdtemp(join(tmpdir(), 'gitnexus-mcp-ts-tools-'));
    await mkdir(join(repoPath, 'src', 'config'), { recursive: true });
    await mkdir(join(repoPath, 'src', 'tools', 'definitions'), { recursive: true });
    await writeFile(
      join(repoPath, 'src', 'config', 'toolDescriptions.ts'),
      `export const TOOL_DESCRIPTIONS = {
  get_task: 'Get a single OmniFocus task by ID',
} as const;
`,
    );
    await writeFile(
      join(repoPath, 'src', 'config', 'toolsets.ts'),
      `import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getTaskTool } from '../tools/definitions/getTask.js';

function desc(name: string): string {
  return TOOL_DESCRIPTIONS[name] ?? name;
}

const searchTasksHandler = async () => ({ content: [] });

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
      description: 'Search OmniFocus tasks',
      inputSchema: { query: z.string() },
      outputSchema: { matches: z.array(z.string()) },
    },
    searchTasksHandler
  );

  return 2;
}
`,
    );

    const graph = createKnowledgeGraph();
    addNode(graph, 'File:src/config/toolsets.ts', 'File', 'toolsets.ts', 'src/config/toolsets.ts');
    addNode(
      graph,
      'File:src/config/toolDescriptions.ts',
      'File',
      'toolDescriptions.ts',
      'src/config/toolDescriptions.ts',
    );
    addNode(
      graph,
      'Function:src/config/toolsets.ts:searchTasksHandler',
      'Function',
      'searchTasksHandler',
      'src/config/toolsets.ts',
    );
    addNode(
      graph,
      'Const:src/tools/definitions/getTask.ts:getTaskTool',
      'Const',
      'getTaskTool',
      'src/tools/definitions/getTask.ts',
    );

    const output = await toolsPhase.execute(
      makeCtx(graph, repoPath),
      new Map([
        [
          'parse',
          phaseResult('parse', {
            allToolDefs: [],
            allPaths: ['src/config/toolDescriptions.ts', 'src/config/toolsets.ts'],
          }),
        ],
      ]),
    );

    expect(output.toolDefs).toEqual([
      {
        name: 'get_task',
        filePath: 'src/config/toolsets.ts',
        description: 'Get a single OmniFocus task by ID',
        handlerNodeId: 'Const:src/tools/definitions/getTask.ts:getTaskTool',
      },
      {
        name: 'search_tasks',
        filePath: 'src/config/toolsets.ts',
        description: 'Search OmniFocus tasks',
        handlerNodeId: 'Function:src/config/toolsets.ts:searchTasksHandler',
      },
    ]);

    expect(graph.relationships.filter((rel) => rel.type === 'HANDLES_TOOL')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceId: 'Const:src/tools/definitions/getTask.ts:getTaskTool',
          targetId: 'Tool:get_task',
        }),
        expect.objectContaining({
          sourceId: 'Function:src/config/toolsets.ts:searchTasksHandler',
          targetId: 'Tool:search_tasks',
        }),
      ]),
    );
  });

  it('detects Swift MCPTool structs as MCP tool definitions', async () => {
    const repoPath = await mkdtemp(join(tmpdir(), 'gitnexus-mcp-swift-tools-'));
    await mkdir(join(repoPath, 'swift', 'Sources', 'FocusEngineCore', 'Tools', 'Task'), {
      recursive: true,
    });
    await writeFile(
      join(repoPath, 'swift', 'Sources', 'FocusEngineCore', 'Tools', 'Task', 'GetTask.swift'),
      `import MCPToolkit

public struct GetTask: MCPTool, Sendable {
    public let name = "get_task"
    public let description: String? = "Get a single OmniFocus task by ID, returning full details"
    public var annotations: Tool.Annotations {
        Tool.Annotations(readOnlyHint: true)
    }

    public typealias Parameters = GetTaskParameters
}
`,
    );

    const graph = createKnowledgeGraph();
    const filePath = 'swift/Sources/FocusEngineCore/Tools/Task/GetTask.swift';
    addNode(graph, `File:${filePath}`, 'File', 'GetTask.swift', filePath);
    addNode(graph, `Struct:${filePath}:GetTask`, 'Struct', 'GetTask', filePath);

    const output = await toolsPhase.execute(
      makeCtx(graph, repoPath),
      new Map([
        [
          'parse',
          phaseResult('parse', {
            allToolDefs: [],
            allPaths: [filePath],
          }),
        ],
      ]),
    );

    expect(output.toolDefs).toEqual([
      {
        name: 'get_task',
        filePath,
        description: 'Get a single OmniFocus task by ID, returning full details',
        handlerNodeId: `Struct:${filePath}:GetTask`,
      },
    ]);

    expect(graph.relationships.filter((rel) => rel.type === 'HANDLES_TOOL')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceId: `Struct:${filePath}:GetTask`,
          targetId: 'Tool:get_task',
        }),
      ]),
    );
  });

  it('detects official Swift ListTools Tool initializers', async () => {
    const repoPath = await mkdtemp(join(tmpdir(), 'gitnexus-mcp-swift-listtools-'));
    await mkdir(join(repoPath, 'swift', 'Sources', 'App'), { recursive: true });
    await writeFile(
      join(repoPath, 'swift', 'Sources', 'App', 'MCPServerSetup.swift'),
      `import MCP

func register(server: Server) async {
    await server.withMethodHandler(ListTools.self) { _ in
        let tools = [
            Tool(
                name: "weather",
                description: "Get current weather for a location",
                inputSchema: .object([:])
            )
        ]
        return .init(tools: tools)
    }
}
`,
    );

    const graph = createKnowledgeGraph();
    const filePath = 'swift/Sources/App/MCPServerSetup.swift';
    addNode(graph, `File:${filePath}`, 'File', 'MCPServerSetup.swift', filePath);
    addNode(graph, `Function:${filePath}:register`, 'Function', 'register', filePath);

    const output = await toolsPhase.execute(
      makeCtx(graph, repoPath),
      new Map([
        [
          'parse',
          phaseResult('parse', {
            allToolDefs: [],
            allPaths: [filePath],
          }),
        ],
      ]),
    );

    expect(output.toolDefs).toEqual([
      {
        name: 'weather',
        filePath,
        description: 'Get current weather for a location',
      },
    ]);
  });

  it('falls back to the file node when a parsed tool handler is missing from the graph', async () => {
    const graph = createKnowledgeGraph();
    addNode(graph, 'File:src/tools.py', 'File', 'tools.py', 'src/tools.py');

    const output = await toolsPhase.execute(
      makeCtx(graph),
      new Map([
        [
          'parse',
          phaseResult('parse', {
            allToolDefs: [
              {
                filePath: 'src/tools.py',
                toolName: 'stale_tool',
                description: 'Stale handler',
                lineNumber: 1,
                handlerNodeId: 'Function:src/tools.py:missing',
              },
            ],
            allPaths: [],
          }),
        ],
      ]),
    );

    expect(output.toolDefs).toEqual([
      { name: 'stale_tool', filePath: 'src/tools.py', description: 'Stale handler' },
    ]);

    const edge = graph.relationships.find((rel) => rel.type === 'HANDLES_TOOL');
    expect(edge).toMatchObject({
      sourceId: 'File:src/tools.py',
      targetId: 'Tool:stale_tool',
    });
  });

  it('does not attach file-level fallback tools to handler-specific processes', async () => {
    const graph = createKnowledgeGraph();
    const filePath = 'src/tools.ts';
    const alpha = 'Function:src/tools.ts:alpha';
    const alphaHelper = 'Function:src/tools.ts:alphaHelper';
    const alphaLeaf = 'Function:src/tools.ts:alphaLeaf';
    const fileEntry = 'Function:src/tools.ts:fileEntry';
    const fileHelper = 'Function:src/tools.ts:fileHelper';
    const fileLeaf = 'Function:src/tools.ts:fileLeaf';

    addNode(graph, 'File:src/tools.ts', 'File', 'tools.ts', filePath);
    addNode(graph, alpha, 'Function', 'alpha', filePath);
    addNode(graph, alphaHelper, 'Function', 'alphaHelper', filePath);
    addNode(graph, alphaLeaf, 'Function', 'alphaLeaf', filePath);
    addNode(graph, fileEntry, 'Function', 'fileEntry', filePath);
    addNode(graph, fileHelper, 'Function', 'fileHelper', filePath);
    addNode(graph, fileLeaf, 'Function', 'fileLeaf', filePath);
    addNode(graph, 'Tool:alpha', 'Tool', 'alpha', filePath);
    addNode(graph, 'Tool:fallback_tool', 'Tool', 'fallback_tool', filePath);
    addCall(graph, alpha, alphaHelper);
    addCall(graph, alphaHelper, alphaLeaf);
    addCall(graph, fileEntry, fileHelper);
    addCall(graph, fileHelper, fileLeaf);

    await processesPhase.execute(
      makeCtx(graph),
      new Map([
        ['structure', phaseResult('structure', { totalFiles: 1 })],
        ['communities', phaseResult('communities', { communityResult: { memberships: [] } })],
        ['routes', phaseResult('routes', { routeRegistry: new Map() })],
        [
          'tools',
          phaseResult('tools', {
            toolDefs: [
              { name: 'alpha', filePath, description: '', handlerNodeId: alpha },
              { name: 'fallback_tool', filePath, description: '' },
            ],
          }),
        ],
      ]),
    );

    const processEntryById = new Map(
      graph.nodes
        .filter((node) => node.label === 'Process')
        .map((node) => [node.id, node.properties.entryPointId]),
    );
    const linkedEntriesByTool = new Map<string, unknown[]>();
    for (const rel of graph.relationships.filter((edge) => edge.type === 'ENTRY_POINT_OF')) {
      const list = linkedEntriesByTool.get(rel.sourceId) ?? [];
      list.push(processEntryById.get(rel.targetId));
      linkedEntriesByTool.set(rel.sourceId, list);
    }

    expect(linkedEntriesByTool.get('Tool:alpha')).toEqual([alpha]);
    expect(linkedEntriesByTool.get('Tool:fallback_tool')).toEqual([fileEntry]);
  });
});
