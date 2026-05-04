import Parser from 'tree-sitter';
import type {
  BindingRef,
  Capture,
  CaptureMatch,
  ImportEdge,
  ParsedFile,
  ParsedImport,
  ParsedTypeBinding,
  Scope,
  ScopeId,
  ScopeTree,
  SymbolDefinition,
  TypeRef,
} from 'gitnexus-shared';
import { SupportedLanguages } from 'gitnexus-shared';
import { getLanguageGrammar } from '../../../tree-sitter/parser-loader.js';
import { getTreeSitterBufferSize } from '../../constants.js';
import { nodeToCapture, syntheticCapture, type SyntaxNode } from '../../utils/ast-helpers.js';
import type { ScopeResolutionIndexes } from '../../model/scope-resolution-indexes.js';
import {
  loadSwiftPackageConfig,
  parseSwiftPackageManifest,
  type SwiftPackageConfig,
} from '../../language-config.js';
import { lookupBindingsAt, namesAtScope } from '../../scope-resolution/scope/walkers.js';

let swiftParser: Parser | null = null;

function getSwiftParser(): Parser {
  if (swiftParser === null) {
    swiftParser = new Parser();
    swiftParser.setLanguage(
      getLanguageGrammar(SupportedLanguages.Swift) as Parameters<Parser['setLanguage']>[0],
    );
  }
  return swiftParser;
}

interface SwiftResolutionConfig {
  readonly swiftPackageConfig: SwiftPackageConfig | null;
}

export async function loadSwiftResolutionConfig(repoRoot: string): Promise<SwiftResolutionConfig> {
  return { swiftPackageConfig: await loadSwiftPackageConfig(repoRoot) };
}

export function emitSwiftScopeCaptures(
  sourceText: string,
  _filePath: string,
  cachedTree?: unknown,
): readonly CaptureMatch[] {
  const tree =
    (cachedTree as { rootNode: SyntaxNode } | undefined) ??
    getSwiftParser().parse(sourceText, undefined, {
      bufferSize: getTreeSitterBufferSize(sourceText),
    });

  const out: CaptureMatch[] = [];
  const root = tree.rootNode;
  out.push({ '@scope.module': nodeToCapture('@scope.module', root) });

  const visit = (node: SyntaxNode): void => {
    emitStructuralCaptures(node, out);
    emitTypeBindingCaptures(node, out);
    emitReferenceCaptures(node, out);

    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (child !== null) visit(child);
    }
  };

  visit(root);
  out.push(...emitModuleSelectorReferences(sourceText));
  return out;
}

function emitStructuralCaptures(node: SyntaxNode, out: CaptureMatch[]): void {
  switch (node.type) {
    case 'class_declaration': {
      out.push({ '@scope.class': nodeToCapture('@scope.class', node) });
      const name = typeLikeNameNode(node);
      if (name === null) return;
      const kind = declarationKind(node);
      const tag =
        kind === 'struct'
          ? '@declaration.struct'
          : kind === 'enum'
            ? '@declaration.enum'
            : '@declaration.class';
      const match: Record<string, Capture> = {
        [tag]: nodeToCapture(tag, node),
        '@declaration.name': nodeToCapture('@declaration.name', name),
        '@declaration.visibility': syntheticCapture(
          '@declaration.visibility',
          node,
          swiftVisibilityForDeclaration(node),
        ),
        '@declaration.kind': syntheticCapture('@declaration.kind', node, kind),
      };
      out.push(match);
      return;
    }
    case 'protocol_declaration': {
      out.push({ '@scope.class': nodeToCapture('@scope.class', node) });
      const name = typeLikeNameNode(node);
      if (name !== null) {
        out.push({
          '@declaration.interface': nodeToCapture('@declaration.interface', node),
          '@declaration.name': nodeToCapture('@declaration.name', name),
          '@declaration.visibility': syntheticCapture(
            '@declaration.visibility',
            node,
            swiftVisibilityForDeclaration(node),
          ),
          '@declaration.kind': syntheticCapture('@declaration.kind', node, 'protocol'),
        });
      }
      return;
    }
    case 'function_declaration': {
      out.push({ '@scope.function': nodeToCapture('@scope.function', node) });
      const name = functionNameNode(node);
      if (name !== null) {
        const match: Record<string, Capture> = {
          '@declaration.function': nodeToCapture('@declaration.function', node),
          '@declaration.name': nodeToCapture('@declaration.name', name),
          '@declaration.visibility': syntheticCapture(
            '@declaration.visibility',
            node,
            swiftVisibilityForDeclaration(node),
          ),
          '@declaration.kind': syntheticCapture('@declaration.kind', node, 'function'),
        };
        addArityMetadata(match, node);
        out.push(match);
      }
      return;
    }
    case 'protocol_function_declaration': {
      out.push({ '@scope.function': nodeToCapture('@scope.function', node) });
      const name = functionNameNode(node);
      if (name !== null) {
        const match: Record<string, Capture> = {
          '@declaration.method': nodeToCapture('@declaration.method', node),
          '@declaration.name': nodeToCapture('@declaration.name', name),
          '@declaration.visibility': syntheticCapture(
            '@declaration.visibility',
            node,
            swiftVisibilityForDeclaration(node),
          ),
          '@declaration.kind': syntheticCapture('@declaration.kind', node, 'protocol_function'),
        };
        addArityMetadata(match, node);
        out.push(match);
      }
      return;
    }
    case 'subscript_declaration': {
      out.push({ '@scope.function': nodeToCapture('@scope.function', node) });
      const match: Record<string, Capture> = {
        '@declaration.method': nodeToCapture('@declaration.method', node),
        '@declaration.name': syntheticCapture('@declaration.name', node, 'subscript'),
        '@declaration.visibility': syntheticCapture(
          '@declaration.visibility',
          node,
          swiftVisibilityForDeclaration(node),
        ),
        '@declaration.kind': syntheticCapture('@declaration.kind', node, 'subscript'),
      };
      addArityMetadata(match, node);
      out.push(match);
      return;
    }
    case 'init_declaration':
    case 'deinit_declaration': {
      out.push({ '@scope.function': nodeToCapture('@scope.function', node) });
      return;
    }
    case 'typealias_declaration': {
      const name = typeLikeNameNode(node);
      if (name !== null) {
        out.push({
          '@declaration.typealias': nodeToCapture('@declaration.typealias', node),
          '@declaration.name': nodeToCapture('@declaration.name', name),
          '@declaration.visibility': syntheticCapture(
            '@declaration.visibility',
            node,
            swiftVisibilityForDeclaration(node),
          ),
          '@declaration.kind': syntheticCapture('@declaration.kind', node, 'typealias'),
        });
      }
      return;
    }
    case 'associatedtype_declaration': {
      const name = typeLikeNameNode(node);
      if (name !== null) {
        out.push({
          '@declaration.typealias': nodeToCapture('@declaration.typealias', node),
          '@declaration.name': nodeToCapture('@declaration.name', name),
          '@declaration.visibility': syntheticCapture(
            '@declaration.visibility',
            node,
            swiftVisibilityForDeclaration(node),
          ),
          '@declaration.kind': syntheticCapture('@declaration.kind', node, 'associatedtype'),
        });
      }
      return;
    }
    case 'property_declaration': {
      if (!isClassStoredProperty(node)) return;
      const name = propertyNameNode(node);
      if (name !== null) {
        out.push({
          '@declaration.property': nodeToCapture('@declaration.property', node),
          '@declaration.name': nodeToCapture('@declaration.name', name),
          '@declaration.visibility': syntheticCapture(
            '@declaration.visibility',
            node,
            swiftVisibilityForDeclaration(node),
          ),
          '@declaration.kind': syntheticCapture('@declaration.kind', node, 'property'),
        });
      }
      return;
    }
    case 'enum_entry': {
      const name = firstDescendant(node, new Set(['simple_identifier']));
      if (name !== null) {
        out.push({
          '@declaration.property': nodeToCapture('@declaration.property', node),
          '@declaration.name': nodeToCapture('@declaration.name', name),
        });
      }
      return;
    }
    case 'import_declaration': {
      const parts = swiftImportIdentifierParts(node);
      if (parts.length === 0) return;
      const source = parts.join('.');
      out.push({
        '@import.statement': nodeToCapture('@import.statement', node),
        '@import.source': syntheticCapture('@import.source', node, source),
        '@import.name': syntheticCapture('@import.name', node, parts[parts.length - 1]!),
      });
      return;
    }
  }
}

function emitTypeBindingCaptures(node: SyntaxNode, out: CaptureMatch[]): void {
  if (node.type === 'function_declaration' || node.type === 'protocol_function_declaration') {
    for (const param of directChildren(node, 'parameter')) {
      const name = parameterLocalName(param);
      const type = parameterTypeText(param);
      if (name !== null && type !== null) {
        out.push(typeBindingMatch(param, '@type-binding.parameter', name, type));
      }
    }

    const fnName = functionNameNode(node);
    const returnType = returnTypeText(node);
    if (fnName !== null && returnType !== null) {
      out.push(typeBindingMatch(node, '@type-binding.return', fnName.text, returnType));
    }
  }

  if (node.type === 'subscript_declaration') {
    for (const param of directChildren(node, 'parameter')) {
      const name = parameterLocalName(param);
      const type = parameterTypeText(param);
      if (name !== null && type !== null) {
        out.push(typeBindingMatch(param, '@type-binding.parameter', name, type));
      }
    }
  }

  if (node.type === 'init_declaration') {
    for (const param of directChildren(node, 'parameter')) {
      const name = parameterLocalName(param);
      const type = parameterTypeText(param);
      if (name !== null && type !== null) {
        out.push(typeBindingMatch(param, '@type-binding.parameter', name, type));
      }
    }
  }

  if (node.type === 'function_declaration' || node.type === 'init_declaration') {
    for (const receiver of synthesizeSwiftReceiverBindings(node)) out.push(receiver);
  }

  if (node.type === 'property_declaration') {
    const name = propertyNameNode(node);
    if (name === null) return;

    const annotation = propertyAnnotationType(node);
    if (annotation !== null) {
      out.push(typeBindingMatch(node, '@type-binding.annotation', name.text, annotation));
    }

    const value = node.childForFieldName('value');
    if (value !== null) {
      const inferred = inferTypeFromExpression(value);
      if (inferred !== null) {
        const tag = startsWithUppercase(inferred)
          ? '@type-binding.constructor'
          : '@type-binding.alias';
        out.push(typeBindingMatch(node, tag, name.text, inferred));
      }
    }
  }

  if (node.type === 'if_statement' || node.type === 'guard_statement') {
    const bound =
      node.childForFieldName('bound_identifier') ?? firstDirectChild(node, 'simple_identifier');
    const value = firstDirectChild(node, 'call_expression');
    if (bound !== null && value !== null) {
      const inferred = inferTypeFromExpression(value);
      if (inferred !== null)
        out.push(typeBindingMatch(node, '@type-binding.alias', bound.text, inferred));
    }
  }

  if (node.type === 'for_statement') {
    const item = node.childForFieldName('item');
    const bound = item === null ? null : firstDescendant(item, new Set(['simple_identifier']));
    const collection = node.childForFieldName('collection');
    if (bound !== null && collection !== null) {
      out.push(typeBindingMatch(node, '@type-binding.alias', bound.text, collection.text));
    }
  }

  if (node.type === 'call_expression') {
    for (const binding of closureElementBindings(node)) out.push(binding);
  }
}

function emitReferenceCaptures(node: SyntaxNode, out: CaptureMatch[]): void {
  if (node.type === 'assignment') {
    const target = node.childForFieldName('target');
    const nav = firstDescendant(target, new Set(['navigation_expression']));
    if (nav !== null) {
      const parts = navigationParts(nav);
      if (parts !== null) {
        out.push({
          '@reference.write.member': nodeToCapture('@reference.write.member', node),
          '@reference.name': syntheticCapture('@reference.name', parts.nameNode, parts.member),
          '@reference.receiver': syntheticCapture(
            '@reference.receiver',
            parts.receiverNode,
            parts.receiverText,
          ),
        });
      }
    }
    return;
  }

  if (node.type === 'call_expression') {
    const callee = firstCallCallee(node);
    if (callee === null) return;
    const arity = countCallArguments(node);
    const argumentTypes = inferCallArgumentTypes(node);
    const argumentLabels = inferCallArgumentLabels(node);

    if (callee.type === 'simple_identifier') {
      const tag = startsWithUppercase(callee.text)
        ? '@reference.call.constructor'
        : '@reference.call.free';
      const match: Record<string, Capture> = {
        [tag]: nodeToCapture(tag, node),
        '@reference.name': nodeToCapture('@reference.name', callee),
        '@reference.arity': syntheticCapture('@reference.arity', node, String(arity)),
      };
      addArgumentTypes(match, node, argumentTypes);
      addArgumentLabels(match, node, argumentLabels);
      out.push(match);
      return;
    }

    if (callee.type === 'navigation_expression') {
      const nav = navigationParts(callee);
      if (nav === null) return;
      const match: Record<string, Capture> = {
        '@reference.call.member': nodeToCapture('@reference.call.member', node),
        '@reference.name': syntheticCapture('@reference.name', nav.nameNode, nav.member),
        '@reference.receiver': syntheticCapture(
          '@reference.receiver',
          nav.receiverNode,
          nav.receiverText,
        ),
        '@reference.arity': syntheticCapture('@reference.arity', node, String(arity)),
      };
      addArgumentTypes(match, node, argumentTypes);
      addArgumentLabels(match, node, argumentLabels);
      out.push(match);
    }
    return;
  }

  if (node.type === 'navigation_expression' && isMemberRead(node)) {
    const nav = navigationParts(node);
    if (nav === null) return;
    out.push({
      '@reference.read.member': nodeToCapture('@reference.read.member', node),
      '@reference.name': syntheticCapture('@reference.name', nav.nameNode, nav.member),
      '@reference.receiver': syntheticCapture(
        '@reference.receiver',
        nav.receiverNode,
        nav.receiverText,
      ),
    });
  }
}

export function interpretSwiftImport(captures: CaptureMatch): ParsedImport | null {
  const source = captures['@import.source']?.text.trim();
  if (!source) return null;
  const parts = source.split('.').filter(Boolean);
  if (parts.length === 0) return null;

  if (parts.length > 1) {
    const importedName = parts[parts.length - 1]!;
    return {
      kind: 'named',
      localName: importedName,
      importedName,
      targetRaw: source,
    };
  }

  return {
    kind: 'namespace',
    localName: parts[0]!,
    importedName: parts[0]!,
    targetRaw: source,
  };
}

export function interpretSwiftTypeBinding(captures: CaptureMatch): ParsedTypeBinding | null {
  const name = captures['@type-binding.name']?.text;
  const type = captures['@type-binding.type']?.text;
  if (name === undefined || type === undefined) return null;

  let source: TypeRef['source'] = 'annotation';
  if (captures['@type-binding.parameter'] !== undefined) source = 'parameter-annotation';
  else if (captures['@type-binding.return'] !== undefined) source = 'return-annotation';
  else if (captures['@type-binding.self'] !== undefined) source = 'self';
  else if (captures['@type-binding.constructor'] !== undefined) source = 'constructor-inferred';
  else if (captures['@type-binding.alias'] !== undefined) source = 'assignment-inferred';

  return { boundName: name, rawTypeName: normalizeTypeName(type), source };
}

export function swiftBindingScopeFor(
  decl: CaptureMatch,
  innermost: Scope,
  tree: ScopeTree,
): ScopeId | null {
  if (decl['@type-binding.return'] !== undefined) {
    let cur: Scope | undefined = innermost;
    while (cur !== undefined && cur.kind !== 'Module') {
      if (cur.parent === null) break;
      cur = tree.getScope(cur.parent);
    }
    return cur?.kind === 'Module' ? cur.id : null;
  }
  return null;
}

export function swiftImportOwningScope(
  _imp: ParsedImport,
  innermost: Scope,
  _tree: ScopeTree,
): ScopeId | null {
  return innermost.kind === 'Function' ? innermost.id : null;
}

export function swiftReceiverBinding(functionScope: Scope): TypeRef | null {
  if (functionScope.kind !== 'Function') return null;
  return functionScope.typeBindings.get('self') ?? functionScope.typeBindings.get('super') ?? null;
}

export function swiftMergeBindings(bindings: readonly BindingRef[]): readonly BindingRef[] {
  const tier = (ref: BindingRef): number => {
    switch (ref.origin) {
      case 'local':
        return 0;
      case 'import':
      case 'namespace':
      case 'reexport':
        return 1;
      case 'wildcard':
        return 2;
    }
  };

  const sorted = [...bindings].sort((a, b) => tier(a) - tier(b));
  const seen = new Set<string>();
  const out: BindingRef[] = [];
  for (const ref of sorted) {
    if (seen.has(ref.def.nodeId)) continue;
    seen.add(ref.def.nodeId);
    out.push(ref);
  }
  return out;
}

export function swiftArityCompatibility(
  def: SymbolDefinition,
  callsite: { readonly arity: number },
): 'compatible' | 'unknown' | 'incompatible' {
  const max = def.parameterCount;
  const min = def.requiredParameterCount;
  if (max === undefined && min === undefined) return 'unknown';
  const argCount = callsite.arity;
  if (!Number.isFinite(argCount) || argCount < 0) return 'unknown';
  const hasVariadic = def.parameterTypes?.some((t) => t === '...' || t.endsWith('...')) === true;
  if (min !== undefined && argCount < min) return 'incompatible';
  if (max !== undefined && argCount > max && !hasVariadic) return 'incompatible';
  return 'compatible';
}

export function resolveSwiftImportTarget(
  targetRaw: string,
  _fromFile: string,
  allFilePaths: ReadonlySet<string>,
  resolutionConfig?: unknown,
): string | null {
  const cfg = resolutionConfig as SwiftResolutionConfig | undefined;
  const files = [...allFilePaths].filter((f) => f.endsWith('.swift')).sort();
  const parts = targetRaw.split('.').filter(Boolean);
  if (parts.length === 0) return null;

  const moduleName = parts[0]!;
  const declarationName = parts.length > 1 ? parts[parts.length - 1]! : null;

  const targetDir = cfg?.swiftPackageConfig?.targets.get(moduleName);
  if (targetDir !== undefined) {
    const prefix = targetDir.replace(/\\/g, '/').replace(/\/+$/, '') + '/';
    const candidates = files.filter((f) => normalizePath(f).startsWith(prefix));
    const selected = selectSwiftTargetFile(candidates, declarationName);
    if (selected !== null) return selected;
  }

  const direct = selectSwiftTargetFile(
    files.filter((f) => {
      const normalized = normalizePath(f);
      return (
        normalized === `${targetRaw}.swift` ||
        normalized.endsWith(`/${targetRaw}.swift`) ||
        normalized === `${targetRaw.replace(/\./g, '/')}.swift` ||
        normalized.endsWith(`/${targetRaw.replace(/\./g, '/')}.swift`)
      );
    }),
    declarationName,
  );
  if (direct !== null) return direct;

  const moduleDir = `${moduleName}/`;
  const dirMatch = selectSwiftTargetFile(
    files.filter((f) => normalizePath(f).includes(moduleDir)),
    declarationName,
  );
  if (dirMatch !== null) return dirMatch;

  return selectSwiftTargetFile(
    files.filter((f) => basenameWithoutExtension(f) === (declarationName ?? moduleName)),
    declarationName,
  );
}

export function resolveSwiftImportTargetForProvider(
  parsedImport: ParsedImport,
  workspaceIndex: unknown,
): string | null {
  const ws = workspaceIndex as
    | {
        readonly fromFile?: string;
        readonly allFilePaths?: ReadonlySet<string>;
        readonly resolutionConfig?: unknown;
      }
    | undefined;
  if (
    parsedImport.targetRaw === null ||
    ws?.fromFile === undefined ||
    ws.allFilePaths === undefined
  ) {
    return null;
  }
  return resolveSwiftImportTarget(
    parsedImport.targetRaw,
    ws.fromFile,
    ws.allFilePaths,
    ws.resolutionConfig,
  );
}

export function populateSwiftModuleSiblings(
  parsedFiles: readonly ParsedFile[],
  indexes: ScopeResolutionIndexes,
  ctx?: {
    readonly fileContents: ReadonlyMap<string, string>;
    readonly resolutionConfig?: unknown;
  },
): void {
  const swiftPackageConfig = swiftPackageConfigFromContext(ctx);
  const groups = groupSwiftFilesByModule(
    parsedFiles.map((p) => p.filePath),
    swiftPackageConfig,
  );
  const parsedByPath = new Map(parsedFiles.map((p) => [p.filePath, p]));
  const augmentations = indexes.bindingAugmentations as Map<ScopeId, Map<string, BindingRef[]>>;
  const importMap = indexes.imports as Map<ScopeId, ImportEdge[]>;
  const groupByFile = new Map<string, string>();
  const allSwiftFiles = new Set(parsedFiles.map((p) => p.filePath));
  for (const [groupName, files] of groups) {
    for (const file of files) groupByFile.set(file, groupName);
  }

  const visibleRefsByFile = new Map<string, BindingRef[]>();
  for (const group of groups.values()) {
    if (group.length <= 1) continue;

    for (const filePath of group) {
      const parsed = parsedByPath.get(filePath);
      const moduleScope = parsed?.scopes.find((s) => s.id === parsed.moduleScope);
      if (parsed === undefined || moduleScope === undefined) continue;

      const refs: BindingRef[] = [];
      for (const [, bindings] of moduleScope.bindings) {
        for (const ref of bindings) {
          if (ref.origin !== 'local') continue;
          if (!isSwiftSameModuleVisibleDef(ref.def)) continue;
          refs.push(ref);
        }
      }
      sortBindingRefs(refs);
      visibleRefsByFile.set(filePath, refs);
    }

    for (const sourceFile of group) {
      const source = parsedByPath.get(sourceFile);
      if (source === undefined) continue;
      for (const targetFile of group) {
        if (targetFile === sourceFile) continue;
        const target = parsedByPath.get(targetFile);
        if (target === undefined) continue;
        addImplicitImportEdge(importMap, source.moduleScope, target);

        addVisibleRefsToScope(
          augmentations,
          source.moduleScope,
          visibleRefsByFile.get(targetFile) ?? [],
        );
      }
    }
  }

  for (let iteration = 0; iteration < Math.max(1, parsedFiles.length); iteration++) {
    let added = 0;
    for (const source of parsedFiles) {
      for (const moduleName of swiftExportedImportModules(source, ctx?.fileContents)) {
        const targetFile = resolveSwiftImportTarget(
          moduleName,
          source.filePath,
          allSwiftFiles,
          ctx?.resolutionConfig,
        );
        if (targetFile === null) continue;
        const targetGroupName = groupByFile.get(targetFile);
        if (targetGroupName === undefined) continue;
        const targetGroup = groups.get(targetGroupName) ?? [];
        for (const filePath of targetGroup) {
          if (filePath === source.filePath) continue;
          const refs = visibleImportRefsForFile(parsedByPath.get(filePath), indexes, false);
          added += addVisibleRefsToScope(augmentations, source.moduleScope, refs, 'reexport');
        }
      }
    }
    if (added === 0) break;
  }

  for (const source of parsedFiles) {
    const imports = importMap.get(source.moduleScope) ?? [];
    for (const edge of imports) {
      if (edge.kind !== 'namespace' || edge.targetFile === null) continue;
      const targetGroupName = groupByFile.get(edge.targetFile);
      if (targetGroupName === undefined) continue;
      const targetGroup = groups.get(targetGroupName) ?? [];
      const testable = isTestableImport(source, edge.localName, ctx?.fileContents);
      for (const targetFile of targetGroup) {
        if (targetFile === source.filePath) continue;
        const refs = visibleImportRefsForFile(parsedByPath.get(targetFile), indexes, testable);
        addVisibleRefsToScope(augmentations, source.moduleScope, refs);
      }
    }
  }
}

function emitModuleSelectorReferences(sourceText: string): CaptureMatch[] {
  const lineStarts = computeLineStarts(sourceText);
  const out: CaptureMatch[] = [];
  const selector = /\b([A-Z][A-Za-z0-9_]*)::([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)/g;
  for (const match of sourceText.matchAll(selector)) {
    const full = match[0]!;
    const receiver = match[1]!;
    const name = match[2]!;
    const args = match[3] ?? '';
    const start = match.index ?? 0;
    const receiverStart = start + full.indexOf(receiver);
    const nameStart = start + full.indexOf(name, receiver.length);
    const arity = countCommaSeparatedArguments(args);
    const callCap = captureFromOffsets(
      '@reference.call.member',
      sourceText,
      start,
      start + full.length,
      lineStarts,
    );
    out.push({
      '@reference.call.member': callCap,
      '@reference.name': captureFromOffsets(
        '@reference.name',
        sourceText,
        nameStart,
        nameStart + name.length,
        lineStarts,
      ),
      '@reference.receiver': captureFromOffsets(
        '@reference.receiver',
        sourceText,
        receiverStart,
        receiverStart + receiver.length,
        lineStarts,
      ),
      '@reference.arity': { ...callCap, name: '@reference.arity', text: String(arity) },
    });
  }
  return out;
}

function synthesizeSwiftReceiverBindings(fnNode: SyntaxNode): CaptureMatch[] {
  if (hasStaticModifier(fnNode)) return [];
  const typeNode = enclosingSwiftType(fnNode);
  if (typeNode === null) return [];
  const typeName = typeLikeNameNode(typeNode);
  if (typeName === null) return [];
  const body = fnNode.childForFieldName('body');
  if (body === null) return [];

  const out = [typeBindingMatch(body, '@type-binding.self', 'self', typeName.text)];
  const base = firstInheritedType(typeNode);
  if (base !== null) out.push(typeBindingMatch(body, '@type-binding.self', 'super', base));
  return out;
}

function typeBindingMatch(
  anchorNode: SyntaxNode,
  tag: string,
  boundName: string,
  rawType: string,
): CaptureMatch {
  return {
    [tag]: nodeToCapture(tag, anchorNode),
    '@type-binding.name': syntheticCapture('@type-binding.name', anchorNode, boundName),
    '@type-binding.type': syntheticCapture('@type-binding.type', anchorNode, rawType),
  };
}

function closureElementBindings(callNode: SyntaxNode): CaptureMatch[] {
  const callee = firstCallCallee(callNode);
  if (callee?.type !== 'navigation_expression') return [];
  const nav = navigationParts(callee);
  if (nav === null || !COLLECTION_CLOSURE_METHODS.has(nav.member)) return [];
  const suffix = firstDirectChild(callNode, 'call_suffix');
  if (suffix === null) return [];
  const closures = directChildren(suffix, 'lambda_literal');
  if (closures.length === 0) return [];

  const out: CaptureMatch[] = [];
  for (const closure of closures) {
    const params = firstDescendant(closure, new Set(['lambda_function_type_parameters']));
    const explicitParams = params === null ? [] : directChildren(params, 'lambda_parameter');
    for (const param of explicitParams) {
      const name = firstDescendant(param, new Set(['simple_identifier']));
      if (name !== null) {
        out.push(typeBindingMatch(param, '@type-binding.alias', name.text, nav.receiverText));
      }
    }
    if (explicitParams.length === 0 && closure.text.includes('$0')) {
      out.push(typeBindingMatch(closure, '@type-binding.alias', '$0', nav.receiverText));
    }
  }
  return out;
}

const COLLECTION_CLOSURE_METHODS: ReadonlySet<string> = new Set([
  'forEach',
  'map',
  'compactMap',
  'flatMap',
  'filter',
  'reduce',
  'sorted',
  'contains',
  'first',
]);

function addArityMetadata(match: Record<string, Capture>, fnNode: SyntaxNode): void {
  const params = directChildren(fnNode, 'parameter');
  let optional = 0;
  let variadic = false;
  const types: string[] = [];
  const labels: string[] = [];
  for (const param of params) {
    if (/\.\.\./.test(param.text)) variadic = true;
    if (hasDefaultValue(param)) optional++;
    const type = parameterTypeText(param);
    if (type !== null) types.push(normalizeTypeName(type));
    labels.push(parameterExternalLabel(param));
  }
  if (variadic) types.push('...');
  if (!variadic) {
    match['@declaration.parameter-count'] = syntheticCapture(
      '@declaration.parameter-count',
      fnNode,
      String(params.length),
    );
  }
  match['@declaration.required-parameter-count'] = syntheticCapture(
    '@declaration.required-parameter-count',
    fnNode,
    String(Math.max(0, params.length - optional - (variadic ? 1 : 0))),
  );
  if (types.length > 0) {
    match['@declaration.parameter-types'] = syntheticCapture(
      '@declaration.parameter-types',
      fnNode,
      JSON.stringify(types),
    );
  }
  if (labels.length > 0) {
    match['@declaration.parameter-labels'] = syntheticCapture(
      '@declaration.parameter-labels',
      fnNode,
      JSON.stringify(labels),
    );
  }
}

function addArgumentTypes(
  match: Record<string, Capture>,
  node: SyntaxNode,
  types: readonly string[],
): void {
  if (types.length === 0) return;
  match['@reference.parameter-types'] = syntheticCapture(
    '@reference.parameter-types',
    node,
    JSON.stringify(types),
  );
}

function addArgumentLabels(
  match: Record<string, Capture>,
  node: SyntaxNode,
  labels: readonly string[],
): void {
  if (labels.length === 0) return;
  match['@reference.argument-labels'] = syntheticCapture(
    '@reference.argument-labels',
    node,
    JSON.stringify(labels),
  );
}

function inferTypeFromExpression(expr: SyntaxNode): string | null {
  const unwrapped = unwrapEffectExpression(expr);
  if (unwrapped.type === 'simple_identifier') return unwrapped.text;
  if (unwrapped.type !== 'call_expression') return null;
  const callee = firstCallCallee(unwrapped);
  if (callee === null) return null;
  if (callee.type === 'simple_identifier') return callee.text;
  if (callee.type === 'navigation_expression') {
    const nav = navigationParts(callee);
    if (nav === null) return null;
    if (nav.member === 'init') return nav.receiverText.split('.').pop() ?? nav.receiverText;
    return `${nav.receiverText}.${nav.member}`;
  }
  return null;
}

function unwrapEffectExpression(node: SyntaxNode): SyntaxNode {
  if (node.type !== 'await_expression' && node.type !== 'try_expression') return node;
  return (
    node.childForFieldName('expr') ?? firstDescendant(node, new Set(['call_expression'])) ?? node
  );
}

function navigationParts(node: SyntaxNode): {
  readonly receiverNode: SyntaxNode;
  readonly receiverText: string;
  readonly nameNode: SyntaxNode;
  readonly member: string;
} | null {
  const receiverNode = node.childForFieldName('target');
  const suffixNode = node.childForFieldName('suffix');
  const nameNode =
    suffixNode?.childForFieldName('suffix') ??
    firstDescendant(suffixNode ?? node, new Set(['simple_identifier']));
  if (receiverNode === null || receiverNode === undefined || nameNode === null) return null;
  return {
    receiverNode,
    receiverText: receiverNode.text,
    nameNode,
    member: nameNode.text,
  };
}

function isMemberRead(node: SyntaxNode): boolean {
  if (isSwiftAssignmentTarget(node)) return false;
  const parent = node.parent;
  if (parent === null) return false;
  if (parent.type === 'navigation_expression') return true;
  if (parent.type === 'call_expression' && firstCallCallee(parent)?.id === node.id) return false;
  return parent.type !== 'call_expression';
}

function isSwiftAssignmentTarget(node: SyntaxNode): boolean {
  let cur: SyntaxNode | null = node;
  while (cur !== null) {
    const parent = cur.parent;
    if (parent === null) return false;
    if (parent.type === 'assignment') return parent.childForFieldName('target')?.id === cur.id;
    cur = parent;
  }
  return false;
}

function firstCallCallee(node: SyntaxNode): SyntaxNode | null {
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (child === null || child.type === 'call_suffix') continue;
    return child;
  }
  return null;
}

function countCallArguments(callNode: SyntaxNode): number {
  const args = firstDescendant(callNode, new Set(['value_arguments']));
  const valueCount = args === null ? 0 : directChildren(args, 'value_argument').length;
  return valueCount + trailingClosureCount(callNode);
}

function inferCallArgumentTypes(callNode: SyntaxNode): readonly string[] {
  const args = firstDescendant(callNode, new Set(['value_arguments']));
  const types = args === null ? [] : directChildren(args, 'value_argument').map(inferArgumentType);
  for (let i = 0; i < trailingClosureCount(callNode); i++) types.push('() -> Void');
  return types;
}

function inferCallArgumentLabels(callNode: SyntaxNode): readonly string[] {
  const args = firstDescendant(callNode, new Set(['value_arguments']));
  const labels = args === null ? [] : directChildren(args, 'value_argument').map(argumentLabel);
  for (let i = 0; i < trailingClosureCount(callNode); i++) labels.push('');
  return labels;
}

function inferArgumentType(argNode: SyntaxNode): string {
  const value = argNode.childForFieldName('value') ?? lastNamedChild(argNode);
  if (value === null) return '';
  switch (value.type) {
    case 'integer_literal':
      return 'Int';
    case 'float_literal':
      return 'Double';
    case 'line_string_literal':
    case 'multi_line_string_literal':
      return 'String';
    case 'boolean_literal':
      return 'Bool';
    case 'call_expression': {
      const inferred = inferTypeFromExpression(value);
      return inferred !== null && startsWithUppercase(inferred) ? inferred : '';
    }
    default:
      return '';
  }
}

function argumentLabel(argNode: SyntaxNode): string {
  const label = firstDirectChild(argNode, 'value_argument_label');
  const name = firstDescendant(label, new Set(['simple_identifier']));
  return name?.text ?? '';
}

function propertyAnnotationType(node: SyntaxNode): string | null {
  const ann = firstDirectChild(node, 'type_annotation');
  if (ann === null) return null;
  const typeNode = ann.childForFieldName('name') ?? lastNamedChild(ann);
  return typeNode?.text ?? null;
}

function parameterTypeText(node: SyntaxNode): string | null {
  for (let i = node.namedChildCount - 1; i >= 0; i--) {
    const child = node.namedChild(i);
    if (child === null) continue;
    if (child.type !== 'simple_identifier') return child.text;
  }
  return null;
}

function parameterLocalName(node: SyntaxNode): string | null {
  const names = directChildren(node, 'simple_identifier').map((n) => n.text);
  const candidates = names.filter((n) => n !== '_');
  return candidates[candidates.length - 1] ?? null;
}

function parameterExternalLabel(node: SyntaxNode): string {
  const names = directChildren(node, 'simple_identifier').map((n) => n.text);
  if (names.length === 0) return '';
  return names[0] === '_' ? '' : names[0]!;
}

function trailingClosureCount(callNode: SyntaxNode): number {
  const suffix = firstDirectChild(callNode, 'call_suffix');
  if (suffix === null) return 0;
  return directChildren(suffix, 'lambda_literal').length;
}

function returnTypeText(node: SyntaxNode): string | null {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child === null || child.text !== '->') continue;
    for (let j = i + 1; j < node.childCount; j++) {
      const next = node.child(j);
      if (next !== null && next.isNamed) return next.text;
    }
  }
  return null;
}

function functionNameNode(node: SyntaxNode): SyntaxNode | null {
  return firstDirectChild(node, 'simple_identifier');
}

function propertyNameNode(node: SyntaxNode): SyntaxNode | null {
  const nameField = node.childForFieldName('name');
  if (nameField === null) return null;
  return firstDescendant(nameField, new Set(['simple_identifier']));
}

function typeLikeNameNode(node: SyntaxNode): SyntaxNode | null {
  const name = node.childForFieldName('name');
  if (name === null)
    return firstDescendant(node, new Set(['type_identifier', 'simple_identifier']));
  if (name.type === 'type_identifier') return name;
  return firstDescendant(name, new Set(['type_identifier', 'simple_identifier']));
}

function declarationKind(node: SyntaxNode): string {
  return node.childForFieldName('declaration_kind')?.text ?? 'class';
}

function swiftVisibilityForDeclaration(node: SyntaxNode): string {
  const explicit = explicitSwiftVisibility(node);
  if (explicit !== null) return explicit;

  const owner = enclosingSwiftType(node);
  if (owner !== null && owner !== node) {
    const ownerVisibility = explicitSwiftVisibility(owner);
    if (ownerVisibility === 'private' || ownerVisibility === 'fileprivate') return ownerVisibility;
    if (owner.type === 'protocol_declaration' && ownerVisibility === 'public') return 'public';
  }
  return 'internal';
}

function explicitSwiftVisibility(node: SyntaxNode): string | null {
  const modifiers = firstDirectChild(node, 'modifiers');
  if (modifiers === null) return null;
  for (const part of modifiers.text.split(/\s+/)) {
    if (
      part === 'open' ||
      part === 'public' ||
      part === 'package' ||
      part === 'internal' ||
      part === 'fileprivate' ||
      part === 'private'
    ) {
      return part;
    }
  }
  return null;
}

function swiftImportIdentifierParts(importNode: SyntaxNode): string[] {
  const identifierNode = firstDirectChild(importNode, 'identifier');
  if (identifierNode === null) return [];
  const parts: string[] = [];
  const visit = (node: SyntaxNode): void => {
    if (node.type === 'simple_identifier' || node.type === 'type_identifier') parts.push(node.text);
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (child !== null) visit(child);
    }
  };
  visit(identifierNode);
  return parts;
}

function isClassStoredProperty(node: SyntaxNode): boolean {
  let cur = node.parent;
  while (cur !== null) {
    if (
      cur.type === 'function_declaration' ||
      cur.type === 'init_declaration' ||
      cur.type === 'deinit_declaration' ||
      cur.type === 'protocol_function_declaration'
    ) {
      return false;
    }
    if (cur.type === 'class_declaration' || cur.type === 'protocol_declaration') return true;
    cur = cur.parent;
  }
  return false;
}

function enclosingSwiftType(node: SyntaxNode): SyntaxNode | null {
  let cur = node.parent;
  while (cur !== null) {
    if (cur.type === 'class_declaration' || cur.type === 'protocol_declaration') return cur;
    cur = cur.parent;
  }
  return null;
}

function firstInheritedType(node: SyntaxNode): string | null {
  const inheritance = firstDirectChild(node, 'inheritance_specifier');
  if (inheritance === null) return null;
  const type = firstDescendant(inheritance, new Set(['type_identifier']));
  return type?.text ?? null;
}

function hasStaticModifier(node: SyntaxNode): boolean {
  const modifiers = firstDirectChild(node, 'modifiers');
  return (
    modifiers?.text.split(/\s+/).some((part) => part === 'static' || part === 'class') === true
  );
}

function hasDefaultValue(node: SyntaxNode): boolean {
  for (let i = 0; i < node.childCount; i++) {
    if (node.child(i)?.text === '=') return true;
  }
  return false;
}

function directChildren(node: SyntaxNode, type: string): SyntaxNode[] {
  const out: SyntaxNode[] = [];
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (child !== null && child.type === type) out.push(child);
  }
  return out;
}

function firstDirectChild(node: SyntaxNode, type: string): SyntaxNode | null {
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (child !== null && child.type === type) return child;
  }
  return null;
}

function lastNamedChild(node: SyntaxNode): SyntaxNode | null {
  for (let i = node.namedChildCount - 1; i >= 0; i--) {
    const child = node.namedChild(i);
    if (child !== null) return child;
  }
  return null;
}

function firstDescendant(
  node: SyntaxNode | null | undefined,
  types: ReadonlySet<string>,
): SyntaxNode | null {
  if (node === null || node === undefined) return null;
  const stack: SyntaxNode[] = [node];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (types.has(cur.type)) return cur;
    for (let i = cur.namedChildCount - 1; i >= 0; i--) {
      const child = cur.namedChild(i);
      if (child !== null) stack.push(child);
    }
  }
  return null;
}

function normalizeTypeName(text: string): string {
  let out = text.trim();
  while (out.endsWith('?') || out.endsWith('!')) out = out.slice(0, -1).trim();
  const sugar = unwrapSwiftCollectionSugar(out);
  if (sugar !== null) out = sugar;
  const generic = unwrapSwiftGeneric(out);
  if (generic !== null) out = generic;
  const dot = out.lastIndexOf('.');
  if (dot !== -1) out = out.slice(dot + 1);
  return out.trim();
}

function unwrapSwiftCollectionSugar(text: string): string | null {
  if (!text.startsWith('[') || !text.endsWith(']')) return null;
  const inner = text.slice(1, -1);
  const colon = findTopLevelSeparator(inner, ':');
  return normalizeTypeName(colon === -1 ? inner : inner.slice(colon + 1));
}

function unwrapSwiftGeneric(text: string): string | null {
  const open = text.indexOf('<');
  if (open === -1 || !text.endsWith('>')) return null;
  const base = text.slice(0, open).trim().split('.').pop() ?? '';
  if (!GENERIC_ELEMENT_WRAPPERS.has(base)) return null;
  const inner = text.slice(open + 1, -1);
  const comma = findTopLevelSeparator(inner, ',');
  const selected = base === 'Dictionary' ? (comma === -1 ? inner : inner.slice(comma + 1)) : inner;
  const success = base === 'Result' && comma !== -1 ? inner.slice(0, comma) : selected;
  return normalizeTypeName(success);
}

const GENERIC_ELEMENT_WRAPPERS: ReadonlySet<string> = new Set([
  'Array',
  'Optional',
  'Set',
  'Sequence',
  'AnySequence',
  'Result',
  'Dictionary',
]);

function findTopLevelSeparator(text: string, separator: string): number {
  let angle = 0;
  let square = 0;
  let paren = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === '<') angle++;
    else if (ch === '>') angle = Math.max(0, angle - 1);
    else if (ch === '[') square++;
    else if (ch === ']') square = Math.max(0, square - 1);
    else if (ch === '(') paren++;
    else if (ch === ')') paren = Math.max(0, paren - 1);
    else if (ch === separator && angle === 0 && square === 0 && paren === 0) return i;
  }
  return -1;
}

function startsWithUppercase(text: string): boolean {
  return /^[A-Z]/.test(text);
}

function selectSwiftTargetFile(
  files: readonly string[],
  declarationName: string | null,
): string | null {
  if (files.length === 0) return null;
  const sorted = [...files].sort();
  if (declarationName !== null) {
    const exact = sorted.find((f) => basenameWithoutExtension(f) === declarationName);
    if (exact !== undefined) return exact;
  }
  return sorted[0] ?? null;
}

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

function basenameWithoutExtension(filePath: string): string {
  const normalized = normalizePath(filePath);
  const slash = normalized.lastIndexOf('/');
  return normalized.slice(slash + 1).replace(/\.swift$/i, '');
}

function groupSwiftFilesByModule(
  filePaths: readonly string[],
  swiftPackageConfig: SwiftPackageConfig | null,
): Map<string, string[]> {
  if (swiftPackageConfig !== null && swiftPackageConfig.targets.size > 0) {
    return groupSwiftFilesByPackageTarget(filePaths, swiftPackageConfig);
  }

  const out = new Map<string, string[]>();
  for (const filePath of filePaths) {
    const normalized = normalizePath(filePath);
    const match = normalized.match(/(?:^|\/)(?:Sources|Source|src|srcs|Tests)\/([^/]+)\//);
    const key = match?.[1] ?? '__default__';
    const group = out.get(key) ?? [];
    group.push(filePath);
    out.set(key, group);
  }
  return out;
}

function groupSwiftFilesByPackageTarget(
  filePaths: readonly string[],
  swiftPackageConfig: SwiftPackageConfig,
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const targets = [...swiftPackageConfig.targets.entries()].map(([name, targetPath]) => ({
    name,
    prefix: normalizePath(targetPath).replace(/\/+$/, '') + '/',
  }));
  const defaultGroup: string[] = [];
  for (const filePath of filePaths) {
    const normalized = normalizePath(filePath);
    const target = targets.find((entry) => normalized.startsWith(entry.prefix));
    const key = target?.name;
    if (key === undefined) {
      defaultGroup.push(filePath);
      continue;
    }
    const group = out.get(key) ?? [];
    group.push(filePath);
    out.set(key, group);
  }
  if (defaultGroup.length > 0) out.set('__default__', defaultGroup);
  return out;
}

function swiftPackageConfigFromContext(
  ctx:
    | {
        readonly fileContents: ReadonlyMap<string, string>;
        readonly resolutionConfig?: unknown;
      }
    | undefined,
): SwiftPackageConfig | null {
  const cfg = ctx?.resolutionConfig as SwiftResolutionConfig | undefined;
  if (cfg?.swiftPackageConfig !== undefined && cfg.swiftPackageConfig !== null) {
    return cfg.swiftPackageConfig;
  }
  if (ctx === undefined) return null;
  for (const [filePath, content] of ctx.fileContents) {
    if (normalizePath(filePath).endsWith('Package.swift')) {
      const parsed = parseSwiftPackageManifest(content);
      return parsed.targets.size > 0 ? parsed : null;
    }
  }
  return null;
}

function isSwiftSameModuleVisibleDef(def: SymbolDefinition): boolean {
  if (!isSwiftVisibleDefType(def)) return false;
  return def.visibility !== 'private' && def.visibility !== 'fileprivate';
}

function isSwiftImportVisibleDef(def: SymbolDefinition, testable: boolean): boolean {
  if (!isSwiftVisibleDefType(def)) return false;
  const visibility = def.visibility ?? 'internal';
  if (visibility === 'open' || visibility === 'public' || visibility === 'package') return true;
  return testable && visibility === 'internal';
}

function isSwiftVisibleDefType(def: SymbolDefinition): boolean {
  return (
    def.type === 'Class' ||
    def.type === 'Struct' ||
    def.type === 'Enum' ||
    def.type === 'Interface' ||
    def.type === 'Function' ||
    def.type === 'TypeAlias'
  );
}

function visibleImportRefsForFile(
  parsed: ParsedFile | undefined,
  indexes: ScopeResolutionIndexes,
  testable: boolean,
): BindingRef[] {
  if (parsed === undefined) return [];
  const moduleScope = parsed.scopes.find((s) => s.id === parsed.moduleScope);
  if (moduleScope === undefined) return [];
  const refs: BindingRef[] = [];
  const seen = new Set<string>();
  for (const [, bindings] of moduleScope.bindings) {
    for (const ref of bindings) {
      if (ref.origin !== 'local') continue;
      if (!isSwiftImportVisibleDef(ref.def, testable)) continue;
      if (seen.has(ref.def.nodeId)) continue;
      seen.add(ref.def.nodeId);
      refs.push(ref);
    }
  }

  for (const name of namesAtScope(moduleScope.id, indexes)) {
    for (const ref of lookupBindingsAt(moduleScope.id, name, indexes)) {
      if (ref.origin !== 'wildcard' && ref.origin !== 'reexport') continue;
      if (!isSwiftImportVisibleDef(ref.def, false)) continue;
      if (seen.has(ref.def.nodeId)) continue;
      seen.add(ref.def.nodeId);
      refs.push(ref);
    }
  }

  sortBindingRefs(refs);
  return refs;
}

function addVisibleRefsToScope(
  augmentations: Map<ScopeId, Map<string, BindingRef[]>>,
  scopeId: ScopeId,
  refs: readonly BindingRef[],
  origin: BindingRef['origin'] = 'import',
): number {
  let added = 0;
  for (const ref of refs) {
    const name = simpleDefName(ref.def);
    if (name === null) continue;
    const bucket = getAugmentationBucket(augmentations, scopeId, name);
    if (bucket.some((b) => b.def.nodeId === ref.def.nodeId)) continue;
    bucket.push({ def: ref.def, origin });
    sortBindingRefs(bucket);
    added++;
  }
  return added;
}

function isTestableImport(
  source: ParsedFile,
  moduleName: string,
  fileContents: ReadonlyMap<string, string> | undefined,
): boolean {
  const content = fileContents?.get(source.filePath);
  if (content === undefined) return false;
  const escaped = moduleName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`@testable\\s+import\\s+${escaped}\\b`).test(content);
}

function swiftExportedImportModules(
  source: ParsedFile,
  fileContents: ReadonlyMap<string, string> | undefined,
): readonly string[] {
  const content = fileContents?.get(source.filePath);
  if (content === undefined) return [];
  const modules: string[] = [];
  const re = /@_exported\s+import\s+([A-Za-z_][A-Za-z0-9_.]*)/g;
  for (const match of content.matchAll(re)) {
    const moduleName = match[1];
    if (moduleName !== undefined) modules.push(moduleName);
  }
  return modules;
}

function sortBindingRefs(refs: BindingRef[]): void {
  refs.sort(
    (a, b) =>
      a.def.filePath.length - b.def.filePath.length || a.def.filePath.localeCompare(b.def.filePath),
  );
}

function simpleDefName(def: SymbolDefinition): string | null {
  const q = def.qualifiedName;
  if (q === undefined || q.length === 0) return null;
  const dot = q.lastIndexOf('.');
  return dot === -1 ? q : q.slice(dot + 1);
}

function getAugmentationBucket(
  augmentations: Map<ScopeId, Map<string, BindingRef[]>>,
  scopeId: ScopeId,
  name: string,
): BindingRef[] {
  let scopeBindings = augmentations.get(scopeId);
  if (scopeBindings === undefined) {
    scopeBindings = new Map<string, BindingRef[]>();
    augmentations.set(scopeId, scopeBindings);
  }
  let bucket = scopeBindings.get(name);
  if (bucket === undefined) {
    bucket = [];
    scopeBindings.set(name, bucket);
  }
  return bucket;
}

function addImplicitImportEdge(
  imports: Map<ScopeId, ImportEdge[]>,
  sourceModuleScope: ScopeId,
  target: ParsedFile,
): void {
  const targetScope = target.moduleScope;
  const existing = imports.get(sourceModuleScope) ?? [];
  if (existing.some((edge) => edge.targetFile === target.filePath && edge.kind === 'side-effect')) {
    return;
  }
  imports.set(sourceModuleScope, [
    ...existing,
    {
      localName: '',
      targetFile: target.filePath,
      targetExportedName: '',
      targetModuleScope: targetScope,
      kind: 'side-effect',
    },
  ]);
}

function computeLineStarts(sourceText: string): number[] {
  const starts = [0];
  for (let i = 0; i < sourceText.length; i++) {
    if (sourceText.charCodeAt(i) === 10) starts.push(i + 1);
  }
  return starts;
}

function captureFromOffsets(
  name: string,
  sourceText: string,
  start: number,
  end: number,
  lineStarts: readonly number[],
): Capture {
  const startPos = positionForOffset(start, lineStarts);
  const endPos = positionForOffset(end, lineStarts);
  return {
    name,
    range: {
      startLine: startPos.line,
      startCol: startPos.col,
      endLine: endPos.line,
      endCol: endPos.col,
    },
    text: sourceText.slice(start, end),
  };
}

function positionForOffset(
  offset: number,
  lineStarts: readonly number[],
): { line: number; col: number } {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (lineStarts[mid]! <= offset) lo = mid + 1;
    else hi = mid - 1;
  }
  const lineIndex = Math.max(0, hi);
  return { line: lineIndex + 1, col: offset - lineStarts[lineIndex]! };
}

function countCommaSeparatedArguments(text: string): number {
  const trimmed = text.trim();
  if (trimmed.length === 0) return 0;
  let depth = 0;
  let count = 1;
  for (const ch of trimmed) {
    if (ch === '(' || ch === '[' || ch === '<') depth++;
    else if (ch === ')' || ch === ']' || ch === '>') depth = Math.max(0, depth - 1);
    else if (ch === ',' && depth === 0) count++;
  }
  return count;
}
