/**
 * Barrel re-export closures must bind an imported name to the CALLABLE def.
 *
 * `export const fn = () => {}` emits TWO `SymbolDefinition`s for one source
 * construct: a `Function` (from `@declaration.function` on the inner arrow)
 * AND a `Variable` (from `@declaration.variable` on the wrapping
 * `lexical_declaration`). `findExportByName` already encodes the rule that an
 * importer wants the callable — see its comment block in
 * `finalize-algorithm.ts` — but the phase-2.5 re-export closure builder
 * (`populateFileClosure`) fanned out `targetModule.localDefs` directly with a
 * bare `deriveSimpleName` + first-wins check, so whichever def capture order
 * happened to emit first won.
 *
 * When the `Variable` won, downstream call resolution had no callable to
 * point a CALLS edge at, and the call site silently produced no edge. That
 * is the barrel blind spot: on a real monorepo, `schema.ts` calling
 * `applyPrismaTypeGraphqlDecorators` (defined `export const … = () => {}` in
 * `typegraphql-prisma/decorators.ts`, re-exported by a one-line
 * `export * from './decorators'` barrel) produced no CALLS edge, while two
 * sibling calls whose targets were reached WITHOUT the barrel resolved fine.
 *
 * These tests pin the callable preference across every re-export form that
 * routes through the closure builder, plus the cycle-termination guarantee.
 */

import { describe, it, expect } from 'vitest';
import {
  finalize,
  type FinalizeFile,
  type FinalizeHooks,
  type ParsedImport,
  type SymbolDefinition,
  type ScopeId,
} from 'gitnexus-shared';

// ─── Test helpers (mirroring test/unit/scope-resolution/finalize-algorithm.test.ts) ───

const def = (
  nodeId: string,
  type: SymbolDefinition['type'] = 'Class',
  qualifiedName?: string,
): SymbolDefinition => ({
  nodeId,
  filePath: 'x',
  type,
  ...(qualifiedName !== undefined ? { qualifiedName } : {}),
});

const file = (
  filePath: string,
  localDefs: SymbolDefinition[] = [],
  parsedImports: ParsedImport[] = [],
): FinalizeFile => ({
  filePath,
  moduleScope: `scope:${filePath}#1:0-9999:0:Module`,
  localDefs: localDefs.map((d) => ({ ...d, filePath })),
  parsedImports,
});

const defaultHooks = (files: readonly FinalizeFile[]): FinalizeHooks => ({
  resolveImportTarget(targetRaw) {
    if (targetRaw === null || targetRaw.length === 0) return null;
    return files.some((f) => f.filePath === targetRaw) ? targetRaw : null;
  },
  expandsWildcardTo(targetModuleScope) {
    const target = files.find((f) => f.moduleScope === targetModuleScope);
    if (target === undefined) return [];
    return target.localDefs.map((d) => deriveSimple(d)).filter((n): n is string => n !== null);
  },
  mergeBindings(existing, incoming) {
    return [...existing, ...incoming];
  },
});

function deriveSimple(d: SymbolDefinition): string | null {
  const q = d.qualifiedName;
  if (q === undefined || q.length === 0) return null;
  const dot = q.lastIndexOf('.');
  return dot === -1 ? q : q.slice(dot + 1);
}

const named = (localName: string, importedName: string, targetRaw: string): ParsedImport => ({
  kind: 'named',
  localName,
  importedName,
  targetRaw,
});

const reexport = (localName: string, importedName: string, targetRaw: string): ParsedImport => ({
  kind: 'reexport',
  localName,
  importedName,
  targetRaw,
});

const wildcard = (targetRaw: string): ParsedImport => ({ kind: 'wildcard', targetRaw });

const firstImport = (out: ReturnType<typeof finalize>, scope: ScopeId) => {
  const imports = out.imports.get(scope);
  return imports?.[0];
};

/**
 * The `export const fn = () => {}` dual emit, in the order that loses:
 * the `Variable` def is emitted BEFORE the `Function` def, so a bare
 * first-wins fan-out picks the non-callable one.
 */
const arrowConstDefs = (fileName: string, name: string): SymbolDefinition[] => [
  def(`def:${fileName}.${name}#var`, 'Variable', name),
  def(`def:${fileName}.${name}#fn`, 'Function', name),
];

/** Resolve `name` imported by `importer` and return the linked target def id. */
const linkedDefIdFor = (
  files: readonly FinalizeFile[],
  importer: FinalizeFile,
  name: string,
): string | undefined => {
  const out = finalize({ files, workspaceIndex: undefined }, defaultHooks(files));
  const edges = out.imports.get(importer.moduleScope) ?? [];
  const edge = edges.find((e) => e.localName === name);
  return edge?.targetDefId;
};

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('barrel re-export closures prefer the callable def', () => {
  it('export-star barrel binds to the Function, not the Variable shadow', () => {
    // impl.ts: export const doWork = () => {}   (dual emit)
    // barrel.ts: export * from './impl'
    // app.ts: import { doWork } from './barrel'; doWork()
    const impl = file('impl', arrowConstDefs('impl', 'doWork'));
    const barrel = file('barrel', [], [wildcard('impl')]);
    const app = file('app', [], [named('doWork', 'doWork', 'barrel')]);
    const files = [impl, barrel, app];

    expect(linkedDefIdFor(files, app, 'doWork')).toBe('def:impl.doWork#fn');
  });

  it('named re-export barrel binds to the Function, not the Variable shadow', () => {
    // barrel.ts: export { doWork } from './impl'
    const impl = file('impl', arrowConstDefs('impl', 'doWork'));
    const barrel = file('barrel', [], [reexport('doWork', 'doWork', 'impl')]);
    const app = file('app', [], [named('doWork', 'doWork', 'barrel')]);
    const files = [impl, barrel, app];

    expect(linkedDefIdFor(files, app, 'doWork')).toBe('def:impl.doWork#fn');
  });

  it('two-level barrel chain binds to the Function through both hops', () => {
    // impl → inner (export * from './impl') → outer (export * from './inner')
    const impl = file('impl', arrowConstDefs('impl', 'doWork'));
    const inner = file('inner', [], [wildcard('impl')]);
    const outer = file('outer', [], [wildcard('inner')]);
    const app = file('app', [], [named('doWork', 'doWork', 'outer')]);
    const files = [impl, inner, outer, app];

    expect(linkedDefIdFor(files, app, 'doWork')).toBe('def:impl.doWork#fn');
  });

  it('mixed chain (star hop then named hop) binds to the Function', () => {
    const impl = file('impl', arrowConstDefs('impl', 'doWork'));
    const inner = file('inner', [], [reexport('doWork', 'doWork', 'impl')]);
    const outer = file('outer', [], [wildcard('inner')]);
    const app = file('app', [], [named('doWork', 'doWork', 'outer')]);
    const files = [impl, inner, outer, app];

    expect(linkedDefIdFor(files, app, 'doWork')).toBe('def:impl.doWork#fn');
  });

  it('records the traversed barrel path in transitiveVia', () => {
    const impl = file('impl', arrowConstDefs('impl', 'doWork'));
    const inner = file('inner', [], [wildcard('impl')]);
    const outer = file('outer', [], [wildcard('inner')]);
    const app = file('app', [], [named('doWork', 'doWork', 'outer')]);
    const files = [impl, inner, outer, app];

    const out = finalize({ files, workspaceIndex: undefined }, defaultHooks(files));
    const edge = (out.imports.get(app.moduleScope) ?? []).find((e) => e.localName === 'doWork');
    expect(edge?.transitiveVia).toEqual(['outer', 'inner', 'impl']);
  });

  it('default re-export (`export { default as X } from`) binds to the Function', () => {
    // `export { default as X } from './impl'` decomposes to a `reexport` with
    // `importedName: 'default'`, so it rides the named branch and was already
    // correct; pinned here so the whole re-export family is covered.
    const impl = file('impl', arrowConstDefs('impl', 'default'));
    const barrel = file('barrel', [], [reexport('X', 'default', 'impl')]);
    const app = file('app', [], [named('X', 'X', 'barrel')]);
    const files = [impl, barrel, app];

    expect(linkedDefIdFor(files, app, 'X')).toBe('def:impl.default#fn');
  });

  it('a default-named callable re-exported by a star barrel binds to the Function', () => {
    const impl = file('impl', arrowConstDefs('impl', 'default'));
    const barrel = file('barrel', [], [wildcard('impl')]);
    const app = file('app', [], [named('default', 'default', 'barrel')]);
    const files = [impl, barrel, app];

    expect(linkedDefIdFor(files, app, 'default')).toBe('def:impl.default#fn');
  });

  it('a single non-callable export is still resolvable (no callable available)', () => {
    // Guards against the fix over-reaching into "callable or nothing".
    const impl = file('impl', [def('def:impl.CONFIG', 'Variable', 'CONFIG')]);
    const barrel = file('barrel', [], [wildcard('impl')]);
    const app = file('app', [], [named('CONFIG', 'CONFIG', 'barrel')]);
    const files = [impl, barrel, app];

    expect(linkedDefIdFor(files, app, 'CONFIG')).toBe('def:impl.CONFIG');
  });

  it('terminates on a circular export-star pair rather than hanging', () => {
    // barrel-a: export * from './barrel-b'
    // barrel-b: export * from './barrel-a'  ← cycle
    // impl is reachable only through barrel-b.
    const impl = file('impl', arrowConstDefs('impl', 'doWork'));
    const barrelA = file('barrel-a', [], [wildcard('barrel-b')]);
    const barrelB = file('barrel-b', [], [wildcard('barrel-a'), wildcard('impl')]);
    const app = file('app', [], [named('doWork', 'doWork', 'barrel-a')]);
    const files = [impl, barrelA, barrelB, app];

    // The assertion that matters first is that this returns at all.
    expect(linkedDefIdFor(files, app, 'doWork')).toBe('def:impl.doWork#fn');
  });

  it('terminates on a three-file circular export-star chain', () => {
    const impl = file('impl', arrowConstDefs('impl', 'doWork'));
    const a = file('a', [], [wildcard('b')]);
    const b = file('b', [], [wildcard('c')]);
    const c = file('c', [], [wildcard('a'), wildcard('impl')]);
    const app = file('app', [], [named('doWork', 'doWork', 'a')]);
    const files = [impl, a, b, c, app];

    expect(linkedDefIdFor(files, app, 'doWork')).toBe('def:impl.doWork#fn');
  });

  it('self-referential export-star does not hang', () => {
    const selfRef = file('self-ref', [], [wildcard('self-ref')]);
    const app = file('app', [], [named('nope', 'nope', 'self-ref')]);
    const files = [selfRef, app];

    const out = finalize({ files, workspaceIndex: undefined }, defaultHooks(files));
    const edge = firstImport(out, app.moduleScope);
    expect(edge?.linkStatus).toBe('unresolved');
  });
});
