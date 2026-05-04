import type { ParsedFile } from 'gitnexus-shared';
import { SupportedLanguages } from 'gitnexus-shared';
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

  isSuperReceiver: (text) => text.trim() === 'super',

  populateNamespaceSiblings: populateSwiftModuleSiblings,

  fieldFallbackOnMethodLookup: false,
  propagatesReturnTypesAcrossImports: true,
  hoistTypeBindingsToModule: true,
};

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
