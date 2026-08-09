// The call sites. Every import here routes through a barrel, so every CALLS
// edge below depends on the re-export closure binding the name to the
// `Function` def rather than its `Variable` shadow.
//
// Mirrors apps/api/src/schema.ts, where `buildSchemaSyncWithDecorators`
// called a star-re-exported function and produced no CALLS edge.

import { applyPrismaTypeGraphqlDecorators, pinBigIntInputs } from './index';
import { deepHelper } from './deep-outer';
import { namedHelper } from './named-barrel';
import { localHelper } from './local-in-barrel';

export const buildSchemaSyncWithDecorators = (): void => {
  // Star-re-exported through a one-line barrel — the confirmed blind spot.
  applyPrismaTypeGraphqlDecorators();
  pinBigIntInputs();
  // Star-re-exported through TWO barrel hops.
  deepHelper();
  // Named re-export (control — already worked).
  namedHelper();
  // Defined in the barrel file itself (control — already worked).
  localHelper();
};
