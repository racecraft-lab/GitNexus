import { describe, expect, it } from 'vitest';
import { createKnowledgeGraph } from '../../src/core/graph/graph.js';
import { communitiesPhase } from '../../src/core/ingestion/pipeline-phases/communities.js';
import type {
  PhaseResult,
  PipelineContext,
} from '../../src/core/ingestion/pipeline-phases/types.js';

describe('communitiesPhase cluster enrichment', () => {
  it('applies opt-in LLM enrichments to Community graph nodes', async () => {
    const graph = createKnowledgeGraph();
    graph.addNode({
      id: 'Function:src/auth.ts:login',
      label: 'Function',
      properties: {
        name: 'login',
        filePath: 'src/auth.ts',
        startLine: 1,
        endLine: 3,
        isExported: true,
      },
    });
    graph.addNode({
      id: 'Function:src/auth.ts:validatePassword',
      label: 'Function',
      properties: {
        name: 'validatePassword',
        filePath: 'src/auth.ts',
        startLine: 5,
        endLine: 7,
        isExported: true,
      },
    });
    graph.addRelationship({
      id: 'auth-call',
      sourceId: 'Function:src/auth.ts:login',
      targetId: 'Function:src/auth.ts:validatePassword',
      type: 'CALLS',
      confidence: 1,
      reason: 'test',
    });

    const ctx: PipelineContext = {
      repoPath: '/tmp/gitnexus-cluster-enrichment',
      graph,
      onProgress: () => {},
      pipelineStart: Date.now(),
      options: {
        clusterEnrichment: {
          enabled: true,
          batchSize: 1,
          llmClient: {
            generate: async (prompt: string) => {
              const id = prompt.match(/id: (comm_\\d+)/)?.[1] ?? 'comm_0';
              return JSON.stringify([
                {
                  id,
                  name: 'Authentication Flow',
                  keywords: ['auth', 'password'],
                  description: 'Validates credentials and starts user sessions.',
                },
              ]);
            },
          },
        },
      },
    };

    const deps = new Map<string, PhaseResult<unknown>>([
      [
        'structure',
        {
          phaseName: 'structure',
          durationMs: 0,
          output: { totalFiles: 1, usedWorkerPool: false },
        },
      ],
    ]);

    await communitiesPhase.execute(ctx, deps);

    const communities = [...graph.iterNodes()].filter((node) => node.label === 'Community');
    expect(communities).toHaveLength(1);
    expect(communities[0].properties.name).toBe('Authentication Flow');
    expect(communities[0].properties.keywords).toEqual(['auth', 'password']);
    expect(communities[0].properties.description).toBe(
      'Validates credentials and starts user sessions.',
    );
    expect(communities[0].properties.enrichedBy).toBe('llm');
  });
});
