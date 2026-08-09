/**
 * Regression tests for fabricated TS/JS import edges.
 *
 * suffixResolve walks progressively shorter suffixes, so its final iteration
 * matches on the last path segment alone. For TypeScript/JavaScript a bare
 * specifier names an npm package or a workspace package, never a path, so that
 * final match is a basename coincidence — and it silently produced an edge to
 * an arbitrary file elsewhere in the repo.
 *
 * Observed live in a real pnpm monorepo before the fix (inbanx/platform, 104
 * cross-app IMPORTS edges out of apps/api, none genuine):
 *   'graphql/index'          -> apps/frontend/src/index.tsx        (matched "index")
 *   '@jest/types'            -> packages/visa-dps-types/src/types.ts (matched "types")
 *   '@api/loanPro/apiClient' -> apps/visa-dps-inbound/.../apiClient.ts
 * Markdown files including CLAUDE.md were reachable as import targets the same way.
 *
 * The guard must not cost specificity: a genuine workspace hit resolves through
 * an EXTENSIONS entry that carries its own separator ('/index.ts'), so it still
 * has a directory segment and still resolves.
 */

import { describe, it, expect } from 'vitest';
import {
  buildSuffixIndex,
  suffixResolve,
} from '../../src/core/ingestion/import-resolvers/utils.js';
import { resolveImportPath } from '../../src/core/ingestion/import-resolvers/standard.js';
import { SupportedLanguages } from '../../src/config/supported-languages.js';

function makeCtx(files: string[]) {
  const normalized = files.map((f) => f.replace(/\\/g, '/'));
  return {
    files,
    normalized,
    allFilesSet: new Set(files),
    index: buildSuffixIndex(normalized, files),
    cache: new Map<string, string | null>(),
  };
}

function resolve(
  currentFile: string,
  importPath: string,
  language: SupportedLanguages,
  ctx: ReturnType<typeof makeCtx>,
): string | null {
  return resolveImportPath(
    currentFile,
    importPath,
    ctx.allFilesSet,
    ctx.files,
    ctx.normalized,
    ctx.cache,
    language,
    null,
    ctx.index,
  );
}

// Mirrors the shape of the monorepo where the fabrications were observed.
const MONOREPO = [
  'apps/api/src/custom-fields/resolvers/DeleteOneCustomFieldResolver.ts',
  'apps/api/src/unit-tests/jest.integration.config.ts',
  'apps/api/src/cards/integrations/loanPro/createCard.ts',
  'apps/frontend/src/index.tsx',
  'apps/frontend/src/services/apollo/mutations/plaid.ts',
  'apps/visa-dps-inbound/src/spade/api/apiClient.ts',
  'packages/visa-dps-types/src/types.ts',
  'packages/typescript-config/index.ts',
  'CLAUDE.md',
];

describe('TypeScript bare specifiers do not fabricate edges by basename', () => {
  it('does not resolve an npm subpath import to a same-basename file elsewhere', () => {
    const ctx = makeCtx(MONOREPO);
    const result = resolve(
      'apps/api/src/custom-fields/resolvers/DeleteOneCustomFieldResolver.ts',
      'graphql/index',
      SupportedLanguages.TypeScript,
      ctx,
    );
    expect(result).toBeNull();
  });

  it('does not resolve a scoped npm package to an unrelated types.ts', () => {
    const ctx = makeCtx(MONOREPO);
    const result = resolve(
      'apps/api/src/unit-tests/jest.integration.config.ts',
      '@jest/types',
      SupportedLanguages.TypeScript,
      ctx,
    );
    expect(result).toBeNull();
  });

  it('does not resolve an unconfigured path alias across app boundaries', () => {
    const ctx = makeCtx(MONOREPO);
    const result = resolve(
      'apps/api/src/cards/integrations/loanPro/createCard.ts',
      '@api/loanPro/apiClient',
      SupportedLanguages.TypeScript,
      ctx,
    );
    expect(result).toBeNull();
  });

  it('never returns a markdown file for a TS import', () => {
    const ctx = makeCtx(MONOREPO);
    for (const spec of ['graphql/index', '@jest/types', 'some-pkg/CLAUDE']) {
      const result = resolve(
        'apps/api/src/custom-fields/resolvers/DeleteOneCustomFieldResolver.ts',
        spec,
        SupportedLanguages.TypeScript,
        ctx,
      );
      expect(result === null || !result.endsWith('.md')).toBe(true);
    }
  });

  it('STILL resolves a genuine workspace package via its index file', () => {
    const ctx = makeCtx(MONOREPO);
    const result = resolve(
      'apps/api/src/cards/integrations/loanPro/createCard.ts',
      '@repo/typescript-config',
      SupportedLanguages.TypeScript,
      ctx,
    );
    // 'typescript-config' + '/index.ts' keeps a directory segment, so the
    // guard admits it. Regressing this would trade fabrication for blindness.
    expect(result).toBe('packages/typescript-config/index.ts');
  });

  it('STILL resolves relative imports unchanged', () => {
    const ctx = makeCtx(['src/services/auth.ts', 'src/services/user.ts', 'src/models/user.ts']);
    const result = resolve('src/services/auth.ts', './user', SupportedLanguages.TypeScript, ctx);
    expect(result).toBe('src/services/user.ts');
  });
});

describe('suffixResolve requireDirectorySegment flag', () => {
  const files = ['apps/frontend/src/index.tsx', 'packages/typescript-config/index.ts'];
  const ctx = makeCtx(files);

  it('is off by default, preserving behaviour for non-TS languages', () => {
    expect(suffixResolve(['graphql', 'index'], ctx.normalized, ctx.files, ctx.index)).toBe(
      'apps/frontend/src/index.tsx',
    );
  });

  it('rejects bare-filename matches when enabled', () => {
    expect(
      suffixResolve(['graphql', 'index'], ctx.normalized, ctx.files, ctx.index, true),
    ).toBeNull();
  });

  it('admits matches that carry a directory segment when enabled', () => {
    expect(suffixResolve(['typescript-config'], ctx.normalized, ctx.files, ctx.index, true)).toBe(
      'packages/typescript-config/index.ts',
    );
  });

  it('applies the same guard on the linear-scan path (no index)', () => {
    expect(
      suffixResolve(['graphql', 'index'], ctx.normalized, ctx.files, undefined, true),
    ).toBeNull();
  });
});
