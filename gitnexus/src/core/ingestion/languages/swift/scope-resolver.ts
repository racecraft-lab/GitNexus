import type { GraphNode, GraphRelationship, ParsedFile } from 'gitnexus-shared';
import { SupportedLanguages } from 'gitnexus-shared';
import { generateId } from '../../../../lib/utils.js';
import { buildMro, defaultLinearize } from '../../scope-resolution/passes/mro.js';
import { populateClassOwnedMembers } from '../../scope-resolution/scope/walkers.js';
import type { ScopeResolver } from '../../scope-resolution/contract/scope-resolver.js';
import { swiftProvider } from '../swift.js';
import {
  loadSwiftResolutionConfig,
  populateSwiftModuleSiblings,
  resolveSwiftImportTarget,
  swiftArityCompatibility,
  swiftMergeBindings,
} from './scope.js';

export const swiftScopeResolver: ScopeResolver = {
  language: SupportedLanguages.Swift,
  languageProvider: swiftProvider,
  importEdgeReason: 'swift-scope: import',

  resolveImportTarget: (targetRaw, fromFile, allFilePaths, resolutionConfig) =>
    resolveSwiftImportTarget(targetRaw, fromFile, allFilePaths, resolutionConfig),

  loadResolutionConfig: loadSwiftResolutionConfig,

  mergeBindings: (existing, incoming) => [...swiftMergeBindings([...existing, ...incoming])],

  arityCompatibility: (callsite, def) => swiftArityCompatibility(def, callsite),

  buildMro: (graph, parsedFiles, nodeLookup) =>
    buildMro(graph, parsedFiles, nodeLookup, defaultLinearize),

  populateOwners: (parsed: ParsedFile, parsedFiles?: readonly ParsedFile[]) => {
    populateClassOwnedMembers(parsed);
    mergeSwiftExtensionMembersIntoPrimaryOwners(parsed, parsedFiles ?? [parsed]);
  },

  materializeDefinitions: materializeSwiftScopeOnlyDefinitions,

  isSuperReceiver: (text) => text.trim() === 'super',

  populateNamespaceSiblings: populateSwiftModuleSiblings,

  fieldFallbackOnMethodLookup: false,
  propagatesReturnTypesAcrossImports: true,
  hoistTypeBindingsToModule: true,
};

function materializeSwiftScopeOnlyDefinitions(
  graph: Parameters<NonNullable<ScopeResolver['materializeDefinitions']>>[0],
  parsedFiles: readonly ParsedFile[],
): number {
  let added = 0;
  for (const parsed of parsedFiles) {
    for (const def of parsed.localDefs) {
      if (def.declarationKind !== 'macro_member' && def.declarationKind !== 'operator') continue;
      const qualifiedName = def.qualifiedName;
      const name = simpleName(def);
      if (qualifiedName === undefined || name === null) continue;

      const id = generateId(def.type, `${def.filePath}:${qualifiedName}${arityTagForDef(def)}`);
      if (graph.getNode(id) !== undefined) continue;

      const startLine = defStartLine(def.nodeId);
      const node: GraphNode = {
        id,
        label: def.type,
        properties: {
          name,
          filePath: def.filePath,
          startLine,
          endLine: startLine,
          language: SupportedLanguages.Swift,
          isExported: def.visibility === 'public' || def.visibility === 'open',
          ...(def.parameterCount !== undefined ? { parameterCount: def.parameterCount } : {}),
          ...(def.requiredParameterCount !== undefined
            ? { requiredParameterCount: def.requiredParameterCount }
            : {}),
          ...(def.parameterTypes !== undefined ? { parameterTypes: def.parameterTypes } : {}),
          ...(def.parameterLabels !== undefined ? { parameterLabels: def.parameterLabels } : {}),
        },
      };
      graph.addNode(node);
      addScopeOnlyDefinitionRelationships(graph, parsed, def, id);
      added++;
    }
  }
  return added;
}

function addScopeOnlyDefinitionRelationships(
  graph: Parameters<NonNullable<ScopeResolver['materializeDefinitions']>>[0],
  parsed: ParsedFile,
  def: ParsedFile['localDefs'][number],
  nodeId: string,
): void {
  const fileId = generateId('File', def.filePath);
  if (graph.getNode(fileId) !== undefined) {
    graph.addRelationship(makeRelationship('DEFINES', fileId, nodeId));
  }

  const owner = parsed.localDefs.find((candidate) => candidate.nodeId === def.ownerId);
  if (owner === undefined) return;
  const ownerGraphId = graphIdForSwiftDef(owner);
  if (ownerGraphId === null || graph.getNode(ownerGraphId) === undefined) return;
  graph.addRelationship(makeRelationship('HAS_METHOD', ownerGraphId, nodeId));
}

function makeRelationship(
  type: GraphRelationship['type'],
  sourceId: string,
  targetId: string,
): GraphRelationship {
  return {
    id: generateId(type, `${sourceId}->${targetId}`),
    sourceId,
    targetId,
    type,
    confidence: 1.0,
    reason: 'swift-scope: materialized definition',
  };
}

function graphIdForSwiftDef(def: ParsedFile['localDefs'][number]): string | null {
  const qualifiedName = def.qualifiedName ?? simpleName(def);
  if (qualifiedName === null) return null;
  return generateId(def.type, `${def.filePath}:${qualifiedName}${arityTagForDef(def)}`);
}

function arityTagForDef(def: ParsedFile['localDefs'][number]): string {
  return (def.type === 'Function' || def.type === 'Method' || def.type === 'Constructor') &&
    def.ownerId !== undefined
    ? `#${def.parameterCount ?? 0}`
    : '';
}

function defStartLine(nodeId: string): number {
  const match = nodeId.match(/#(\d+):\d+:/);
  const parsed = match?.[1] === undefined ? Number.NaN : Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : 1;
}

function mergeSwiftExtensionMembersIntoPrimaryOwners(
  parsed: ParsedFile,
  parsedFiles: readonly ParsedFile[],
): void {
  const primaryByName = new Map<string, ParsedFile['localDefs'][number]>();
  for (const file of parsedFiles) {
    for (const def of file.localDefs) {
      if (!isSwiftNominalType(def)) continue;
      if (def.declarationKind === 'extension') continue;
      const name = simpleName(def);
      if (name !== null && !primaryByName.has(name)) primaryByName.set(name, def);
    }
  }

  const extensionIds = new Map<string, ParsedFile['localDefs'][number]>();
  for (const def of parsed.localDefs) {
    if (!isSwiftNominalType(def) || def.declarationKind !== 'extension') continue;
    const name = simpleName(def);
    const primary = name === null ? undefined : primaryByName.get(name);
    if (primary !== undefined) extensionIds.set(def.nodeId, primary);
  }

  if (extensionIds.size === 0) return;
  for (const def of parsed.localDefs) {
    if (def.ownerId === undefined) continue;
    const primary = extensionIds.get(def.ownerId);
    if (primary === undefined) continue;
    (def as { ownerId?: string; qualifiedName?: string }).ownerId = primary.nodeId;
    const name = simpleName(def);
    const ownerName = simpleName(primary);
    if (name !== null && ownerName !== null) {
      (def as { qualifiedName?: string }).qualifiedName = `${ownerName}.${name}`;
    }
  }
}

function isSwiftNominalType(def: ParsedFile['localDefs'][number]): boolean {
  return def.type === 'Class' || def.type === 'Struct' || def.type === 'Enum';
}

function simpleName(def: ParsedFile['localDefs'][number]): string | null {
  const q = def.qualifiedName;
  if (q === undefined || q.length === 0) return null;
  const dot = q.lastIndexOf('.');
  return dot === -1 ? q : q.slice(dot + 1);
}
