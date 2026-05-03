import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { KnowledgeGraph } from '../graph/types.js';
import type { GraphRelationship } from 'gitnexus-shared';
import { walkRepositoryPaths } from './filesystem-walker.js';

export const INCREMENTAL_MANIFEST_VERSION = 1;
export const INCREMENTAL_MANIFEST_FILE = 'incremental-manifest.json';

const CONFIG_FILE_NAMES = new Set([
  'package.json',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lockb',
  'tsconfig.json',
  'jsconfig.json',
  'Package.swift',
  'go.mod',
  'go.sum',
  'Cargo.toml',
  'Cargo.lock',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'settings.gradle',
  'settings.gradle.kts',
  'composer.json',
  'composer.lock',
  'pyproject.toml',
  'requirements.txt',
  'Gemfile',
  'Gemfile.lock',
  '.gitnexusignore',
]);

export interface IncrementalManifestEntry {
  path: string;
  size: number;
  contentHash: string;
  configFingerprint: string;
  indexerVersion: number;
}

export interface IncrementalManifest {
  version: number;
  repoCommit: string;
  generatedAt: string;
  files: IncrementalManifestEntry[];
}

export interface IncrementalDiff {
  added: string[];
  modified: string[];
  deleted: string[];
  unchanged: string[];
  configChanged: boolean;
  changedConfigFiles: string[];
}

export interface IncrementalPlan {
  mode: 'incremental' | 'full';
  reason?: string;
  manifest: IncrementalManifest;
  diff: IncrementalDiff;
  reindexPaths: string[];
  deletedPaths: string[];
}

const sha1 = (input: string | Buffer): string => crypto.createHash('sha1').update(input).digest('hex');

export const isConfigPath = (filePath: string): boolean => {
  const normalized = filePath.replace(/\\/g, '/');
  const base = path.posix.basename(normalized);
  if (CONFIG_FILE_NAMES.has(base)) return true;
  return normalized.endsWith('/Package.swift') || normalized.endsWith('/tsconfig.json');
};

export const incrementalManifestPath = (storagePath: string): string =>
  path.join(storagePath, INCREMENTAL_MANIFEST_FILE);

export async function loadIncrementalManifest(
  storagePath: string,
): Promise<IncrementalManifest | undefined> {
  try {
    const raw = await fs.readFile(incrementalManifestPath(storagePath), 'utf-8');
    const parsed = JSON.parse(raw) as IncrementalManifest;
    if (parsed.version !== INCREMENTAL_MANIFEST_VERSION || !Array.isArray(parsed.files)) {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

export async function saveIncrementalManifest(
  storagePath: string,
  manifest: IncrementalManifest,
): Promise<void> {
  await fs.mkdir(storagePath, { recursive: true });
  await fs.writeFile(
    incrementalManifestPath(storagePath),
    JSON.stringify(manifest, null, 2) + '\n',
    'utf-8',
  );
}

export async function buildIncrementalManifest(
  repoPath: string,
  repoCommit: string,
): Promise<IncrementalManifest> {
  const scannedFiles = await walkRepositoryPaths(repoPath);
  const files: IncrementalManifestEntry[] = [];
  const configHashes = new Map<string, string>();

  for (const file of scannedFiles) {
    const absolute = path.join(repoPath, file.path);
    const content = await fs.readFile(absolute);
    const contentHash = sha1(content);
    if (isConfigPath(file.path)) {
      configHashes.set(file.path, contentHash);
    }
    files.push({
      path: file.path,
      size: file.size,
      contentHash,
      configFingerprint: '',
      indexerVersion: INCREMENTAL_MANIFEST_VERSION,
    });
  }

  const configFingerprint = sha1(
    [...configHashes.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([p, hash]) => `${p}:${hash}`)
      .join('\n'),
  );

  return {
    version: INCREMENTAL_MANIFEST_VERSION,
    repoCommit,
    generatedAt: new Date().toISOString(),
    files: files
      .map((file) => ({ ...file, configFingerprint }))
      .sort((a, b) => a.path.localeCompare(b.path)),
  };
}

export function diffIncrementalManifests(
  previous: IncrementalManifest,
  current: IncrementalManifest,
): IncrementalDiff {
  const previousByPath = new Map(previous.files.map((file) => [file.path, file]));
  const currentByPath = new Map(current.files.map((file) => [file.path, file]));
  const added: string[] = [];
  const modified: string[] = [];
  const deleted: string[] = [];
  const unchanged: string[] = [];
  const changedConfigFiles: string[] = [];

  for (const [filePath, currentFile] of currentByPath) {
    const previousFile = previousByPath.get(filePath);
    if (!previousFile) {
      added.push(filePath);
      if (isConfigPath(filePath)) changedConfigFiles.push(filePath);
      continue;
    }
    if (
      previousFile.contentHash !== currentFile.contentHash ||
      previousFile.indexerVersion !== currentFile.indexerVersion
    ) {
      modified.push(filePath);
      if (isConfigPath(filePath)) changedConfigFiles.push(filePath);
    } else {
      unchanged.push(filePath);
    }
  }

  for (const filePath of previousByPath.keys()) {
    if (!currentByPath.has(filePath)) {
      deleted.push(filePath);
      if (isConfigPath(filePath)) changedConfigFiles.push(filePath);
    }
  }

  const previousFingerprint = previous.files[0]?.configFingerprint ?? '';
  const currentFingerprint = current.files[0]?.configFingerprint ?? '';

  return {
    added: added.sort(),
    modified: modified.sort(),
    deleted: deleted.sort(),
    unchanged: unchanged.sort(),
    configChanged:
      previousFingerprint !== currentFingerprint ||
      changedConfigFiles.length > 0 ||
      previous.version !== current.version,
    changedConfigFiles: [...new Set(changedConfigFiles)].sort(),
  };
}

export function expandReindexPathsFromImports(
  graph: KnowledgeGraph,
  initialPaths: Iterable<string>,
): string[] {
  const reindex = new Set(initialPaths);
  let changed = true;

  while (changed) {
    changed = false;
    for (const rel of graph.iterRelationshipsByType('IMPORTS')) {
      const targetPath = graph.getNode(rel.targetId)?.properties.filePath;
      const sourcePath = graph.getNode(rel.sourceId)?.properties.filePath;
      if (
        typeof targetPath === 'string' &&
        typeof sourcePath === 'string' &&
        reindex.has(targetPath) &&
        !reindex.has(sourcePath)
      ) {
        reindex.add(sourcePath);
        changed = true;
      }
    }
  }

  return [...reindex].sort();
}

export function removeGraphNodesForIncrementalRun(
  graph: KnowledgeGraph,
  filePaths: Iterable<string>,
): number {
  let removed = 0;
  for (const filePath of filePaths) {
    removed += graph.removeNodesByFile(filePath);
  }

  const derivedLabels = new Set(['Community', 'Process']);
  const derivedNodeIds: string[] = [];
  graph.forEachNode((node) => {
    if (derivedLabels.has(node.label)) derivedNodeIds.push(node.id);
  });
  for (const nodeId of derivedNodeIds) {
    if (graph.removeNode(nodeId)) removed++;
  }

  const derivedRelationshipTypes = new Set(['MEMBER_OF', 'STEP_IN_PROCESS', 'ENTRY_POINT_OF']);
  const derivedRelationshipIds: string[] = [];
  graph.forEachRelationship((rel: GraphRelationship) => {
    if (derivedRelationshipTypes.has(rel.type)) derivedRelationshipIds.push(rel.id);
  });
  for (const relId of derivedRelationshipIds) {
    graph.removeRelationship(relId);
  }

  return removed;
}

export async function planIncrementalRun(
  repoPath: string,
  storagePath: string,
  repoCommit: string,
  previousGraph?: KnowledgeGraph,
): Promise<IncrementalPlan> {
  const manifest = await buildIncrementalManifest(repoPath, repoCommit);
  const previous = await loadIncrementalManifest(storagePath);

  if (!previous) {
    return {
      mode: 'full',
      reason: 'no incremental manifest from a previous successful analyze run',
      manifest,
      diff: {
        added: manifest.files.map((file) => file.path),
        modified: [],
        deleted: [],
        unchanged: [],
        configChanged: false,
        changedConfigFiles: [],
      },
      reindexPaths: [],
      deletedPaths: [],
    };
  }

  const diff = diffIncrementalManifests(previous, manifest);
  if (diff.configChanged) {
    return {
      mode: 'full',
      reason:
        diff.changedConfigFiles.length > 0
          ? `configuration changed: ${diff.changedConfigFiles.join(', ')}`
          : 'configuration fingerprint changed',
      manifest,
      diff,
      reindexPaths: [],
      deletedPaths: diff.deleted,
    };
  }

  const changedPaths = [...diff.added, ...diff.modified];
  if (changedPaths.length === 0 && diff.deleted.length === 0) {
    return { mode: 'incremental', manifest, diff, reindexPaths: [], deletedPaths: [] };
  }

  const currentPaths = new Set(manifest.files.map((file) => file.path));
  const deletedPaths = new Set(diff.deleted);
  const affectedPaths = previousGraph
    ? expandReindexPathsFromImports(previousGraph, [...changedPaths, ...diff.deleted])
    : changedPaths.sort();
  const reindexPaths = affectedPaths.filter(
    (filePath) => currentPaths.has(filePath) && !deletedPaths.has(filePath),
  );

  return {
    mode: 'incremental',
    manifest,
    diff,
    reindexPaths,
    deletedPaths: diff.deleted,
  };
}
