/**
 * TypeScript: CALLS edges to symbols reached through an `export *` barrel.
 *
 * Companion to `typescript-hof-callbacks.test.ts`, which fixed the same
 * "importer bound to the `Variable` shadow instead of the `Function`" class of
 * bug on the DIRECT lookup path (`findExportByName`). That fix left the
 * phase-2.5 re-export closure's wildcard fan-out untouched, so the defect
 * survived for any symbol reached through a star barrel.
 *
 * Measured on a real pnpm monorepo: `apps/api/src/schema.ts` called
 * `applyPrismaTypeGraphqlDecorators` (defined `export const … = () => {}` in
 * `typegraphql-prisma/decorators.ts`, re-exported by a one-line
 * `export * from './decorators'` barrel) and produced NO CALLS edge, while the
 * two sibling calls in the same function body — whose targets were reached
 * WITHOUT a barrel — resolved fine. `apps/api/src` alone has 189
 * `export * from` statements, so the blind spot was broad.
 *
 * These assertions are end-to-end through the real pipeline: they fail if the
 * closure binds the name to a non-callable, because
 * `findAllCallableBindingsInScope` then filters the binding out and the call
 * site emits nothing.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import path from 'path';
import {
  FIXTURES,
  getRelationships,
  edgeSet,
  runPipelineFromRepo,
  type PipelineResult,
} from './helpers.js';

describe('TypeScript barrel re-export CALLS edges', () => {
  let result: PipelineResult;

  beforeAll(async () => {
    result = await runPipelineFromRepo(path.join(FIXTURES, 'typescript-barrel-reexport'), () => {});
  }, 60000);

  const callsFrom = (caller: string): string[] =>
    edgeSet(getRelationships(result, 'CALLS').filter((c) => c.source === caller));

  it('emits a CALLS edge through a one-line `export *` barrel', () => {
    expect(callsFrom('buildSchemaSyncWithDecorators')).toContain(
      'buildSchemaSyncWithDecorators → applyPrismaTypeGraphqlDecorators',
    );
  });

  it('emits a CALLS edge for a second symbol from the same barrel', () => {
    expect(callsFrom('buildSchemaSyncWithDecorators')).toContain(
      'buildSchemaSyncWithDecorators → pinBigIntInputs',
    );
  });

  it('emits a CALLS edge through a TWO-level barrel chain', () => {
    expect(callsFrom('buildSchemaSyncWithDecorators')).toContain(
      'buildSchemaSyncWithDecorators → deepHelper',
    );
  });

  it('control: named re-export barrel still emits its CALLS edge', () => {
    expect(callsFrom('buildSchemaSyncWithDecorators')).toContain(
      'buildSchemaSyncWithDecorators → namedHelper',
    );
  });

  it('control: a callable declared in the barrel file itself still resolves', () => {
    expect(callsFrom('buildSchemaSyncWithDecorators')).toContain(
      'buildSchemaSyncWithDecorators → localHelper',
    );
  });

  it('resolves the barrel-routed call to the DEFINING file, not the barrel', () => {
    const edge = getRelationships(result, 'CALLS').find(
      (c) =>
        c.source === 'buildSchemaSyncWithDecorators' &&
        c.target === 'applyPrismaTypeGraphqlDecorators',
    );
    expect(edge?.targetFilePath).toMatch(/decorators\.ts$/);
  });
});
