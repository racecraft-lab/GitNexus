import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createKnowledgeGraph } from '../../src/core/graph/graph.js';
import {
  diffIncrementalManifests,
  expandReindexPathsFromImports,
  planIncrementalRun,
  removeGraphNodesForIncrementalRun,
  type IncrementalManifest,
} from '../../src/core/ingestion/incremental-manifest.js';

function manifest(files: Array<[string, string]>): IncrementalManifest {
  return {
    version: 1,
    repoCommit: 'commit',
    generatedAt: '2026-05-03T00:00:00.000Z',
    files: files.map(([filePath, contentHash]) => ({
      path: filePath,
      size: 1,
      contentHash,
      configFingerprint: 'cfg',
      indexerVersion: 1,
    })),
  };
}

describe('incremental manifest diffing', () => {
  it('detects added, modified, deleted, and unchanged files', () => {
    const previous = manifest([
      ['src/a.ts', 'a1'],
      ['src/b.ts', 'b1'],
      ['src/deleted.ts', 'd1'],
    ]);
    const current = manifest([
      ['src/a.ts', 'a1'],
      ['src/b.ts', 'b2'],
      ['src/new.ts', 'n1'],
    ]);

    const diff = diffIncrementalManifests(previous, current);

    expect(diff.added).toEqual(['src/new.ts']);
    expect(diff.modified).toEqual(['src/b.ts']);
    expect(diff.deleted).toEqual(['src/deleted.ts']);
    expect(diff.unchanged).toEqual(['src/a.ts']);
    expect(diff.configChanged).toBe(false);
  });

  it('treats config file changes as full-invalidation changes', () => {
    const previous = manifest([['Package.swift', 'old']]);
    const current = manifest([['Package.swift', 'new']]);

    const diff = diffIncrementalManifests(previous, current);

    expect(diff.configChanged).toBe(true);
    expect(diff.changedConfigFiles).toEqual(['Package.swift']);
  });
});

describe('incremental graph planning helpers', () => {
  it('expands changed files to transitive importers', () => {
    const graph = createKnowledgeGraph();
    for (const filePath of ['src/base.ts', 'src/mid.ts', 'src/top.ts']) {
      graph.addNode({
        id: `File:${filePath}`,
        label: 'File',
        properties: { name: filePath, filePath },
      });
    }
    graph.addRelationship({
      id: 'mid-imports-base',
      sourceId: 'File:src/mid.ts',
      targetId: 'File:src/base.ts',
      type: 'IMPORTS',
      confidence: 1,
      reason: 'import',
    });
    graph.addRelationship({
      id: 'top-imports-mid',
      sourceId: 'File:src/top.ts',
      targetId: 'File:src/mid.ts',
      type: 'IMPORTS',
      confidence: 1,
      reason: 'import',
    });

    expect(expandReindexPathsFromImports(graph, ['src/base.ts'])).toEqual([
      'src/base.ts',
      'src/mid.ts',
      'src/top.ts',
    ]);
  });

  it('removes stale file-owned nodes plus derived community/process nodes', () => {
    const graph = createKnowledgeGraph();
    graph.addNode({
      id: 'File:src/a.ts',
      label: 'File',
      properties: { name: 'a.ts', filePath: 'src/a.ts' },
    });
    graph.addNode({
      id: 'Function:src/a.ts:run',
      label: 'Function',
      properties: { name: 'run', filePath: 'src/a.ts' },
    });
    graph.addNode({
      id: 'File:src/b.ts',
      label: 'File',
      properties: { name: 'b.ts', filePath: 'src/b.ts' },
    });
    graph.addNode({
      id: 'comm_1',
      label: 'Community',
      properties: { name: 'Old', filePath: '' },
    });
    graph.addNode({
      id: 'proc_1',
      label: 'Process',
      properties: { name: 'OldFlow', filePath: '' },
    });
    graph.addRelationship({
      id: 'member',
      sourceId: 'Function:src/a.ts:run',
      targetId: 'comm_1',
      type: 'MEMBER_OF',
      confidence: 1,
      reason: 'old',
    });

    const removed = removeGraphNodesForIncrementalRun(graph, ['src/a.ts']);

    expect(removed).toBe(4);
    expect(graph.getNode('File:src/a.ts')).toBeUndefined();
    expect(graph.getNode('Function:src/a.ts:run')).toBeUndefined();
    expect(graph.getNode('comm_1')).toBeUndefined();
    expect(graph.getNode('proc_1')).toBeUndefined();
    expect(graph.getNode('File:src/b.ts')).toBeDefined();
    expect([...graph.iterRelationships()]).toHaveLength(0);
  });
});

describe('incremental planning', () => {
  it('reindexes importers of deleted files but not the deleted file itself', async () => {
    const repoPath = await fs.mkdtemp(path.join(os.tmpdir(), 'gitnexus-incremental-plan-'));
    const storagePath = path.join(repoPath, '.gitnexus');
    await fs.mkdir(path.join(repoPath, 'src'), { recursive: true });
    await fs.mkdir(storagePath, { recursive: true });
    await fs.writeFile(
      path.join(repoPath, 'src/top.ts'),
      "import './base';\nexport const top = 1;\n",
    );

    const emptyConfigFingerprint = 'da39a3ee5e6b4b0d3255bfef95601890afd80709';
    const previous: IncrementalManifest = {
      version: 1,
      repoCommit: 'old',
      generatedAt: '2026-05-03T00:00:00.000Z',
      files: [
        {
          path: 'src/base.ts',
          size: 1,
          contentHash: 'base',
          configFingerprint: emptyConfigFingerprint,
          indexerVersion: 1,
        },
        {
          path: 'src/top.ts',
          size: 1,
          contentHash: 'old-top',
          configFingerprint: emptyConfigFingerprint,
          indexerVersion: 1,
        },
      ],
    };
    await fs.writeFile(
      path.join(storagePath, 'incremental-manifest.json'),
      JSON.stringify(previous, null, 2) + '\n',
    );

    const graph = createKnowledgeGraph();
    for (const filePath of ['src/base.ts', 'src/top.ts']) {
      graph.addNode({
        id: `File:${filePath}`,
        label: 'File',
        properties: { name: filePath, filePath },
      });
    }
    graph.addRelationship({
      id: 'top-imports-base',
      sourceId: 'File:src/top.ts',
      targetId: 'File:src/base.ts',
      type: 'IMPORTS',
      confidence: 1,
      reason: 'import',
    });

    const plan = await planIncrementalRun(repoPath, storagePath, 'new', graph);

    expect(plan.mode).toBe('incremental');
    expect(plan.deletedPaths).toEqual(['src/base.ts']);
    expect(plan.reindexPaths).toEqual(['src/top.ts']);
  });
});
