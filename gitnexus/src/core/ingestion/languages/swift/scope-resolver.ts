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

  populateOwners: (parsed: ParsedFile) => populateClassOwnedMembers(parsed),

  isSuperReceiver: (text) => text.trim() === 'super',

  populateNamespaceSiblings: populateSwiftModuleSiblings,

  fieldFallbackOnMethodLookup: false,
  propagatesReturnTypesAcrossImports: true,
  hoistTypeBindingsToModule: true,
};
