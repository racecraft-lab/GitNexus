import { beforeAll, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import { runPipelineFromRepo } from '../../src/core/ingestion/pipeline.js';
import { loadGraphToLbug } from '../../src/core/lbug/lbug-adapter.js';
import { LocalBackend } from '../../src/mcp/local/local-backend.js';
import { listRegisteredRepos } from '../../src/storage/repo-manager.js';
import { withTestLbugDB } from '../helpers/test-indexed-db.js';

vi.mock('../../src/storage/repo-manager.js', () => ({
  listRegisteredRepos: vi.fn().mockResolvedValue([]),
  cleanupOldKuzuFiles: vi.fn().mockResolvedValue({ found: false, needsReindex: false }),
  findSiblingClones: vi.fn().mockResolvedValue([]),
}));

const FIXTURE_REPO = path.resolve(__dirname, '..', 'fixtures', 'mcp-focusengine-style');

withTestLbugDB(
  'mcp-tool-extraction',
  (handle) => {
    describe('MCP-aware tool extraction smoke test', () => {
      let backend: LocalBackend;

      beforeAll(async () => {
        const ext = handle as typeof handle & { _backend?: LocalBackend };
        if (!ext._backend) {
          throw new Error('LocalBackend not initialized');
        }
        backend = ext._backend;
      });

      it('tool_map resolves FocusEngine-style get_task after ingestion', async () => {
        const result = await backend.callTool('tool_map', {
          repo: 'focusengine-style',
          tool: 'get_task',
        });

        expect(result.total).toBe(1);
        expect(result.tools[0]).toMatchObject({
          name: 'get_task',
        });
        expect(result.tools[0].description).toMatch(/OmniFocus task/);
        expect(result.tools[0].filePath).toMatch(
          /src\/config\/toolsets\.ts|swift\/Sources\/FocusEngineCore\/Tools\/Task\/GetTask\.swift/,
        );
      });

      it('tool_map resolves TS registerTool and Swift Tool initializer shapes', async () => {
        const result = await backend.callTool('tool_map', { repo: 'focusengine-style' });
        const tools = new Map(result.tools.map((tool: any) => [tool.name, tool]));

        expect(tools.get('search_tasks')?.description).toBe('Search OmniFocus tasks');
        expect(tools.get('weather')?.description).toBe('Get current weather for a location');
      });
    });
  },
  {
    poolAdapter: true,
    afterSetup: async (handle) => {
      const pipelineResult = await runPipelineFromRepo(FIXTURE_REPO, () => {});
      await loadGraphToLbug(pipelineResult.graph, FIXTURE_REPO, handle.tmpHandle.dbPath);

      vi.mocked(listRegisteredRepos).mockResolvedValue([
        {
          name: 'focusengine-style',
          path: FIXTURE_REPO,
          storagePath: handle.tmpHandle.dbPath,
          indexedAt: new Date().toISOString(),
          lastCommit: 'fixture',
          stats: {
            files: pipelineResult.totalFileCount,
            nodes: pipelineResult.graph.nodeCount,
            communities: pipelineResult.communityResult?.stats.totalCommunities ?? 0,
            processes: pipelineResult.processResult?.stats.totalProcesses ?? 0,
          },
        },
      ]);

      const backend = new LocalBackend();
      await backend.init();
      (handle as typeof handle & { _backend?: LocalBackend })._backend = backend;
    },
    timeout: 120_000,
  },
);

