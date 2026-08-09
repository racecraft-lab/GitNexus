// The DEFINING file, reached only through a barrel.
//
// `export const … = () => {}` is the shape that matters: TypeScript emits BOTH
// a `Function` def (from `@declaration.function` on the inner arrow) and a
// `Variable` def (from `@declaration.variable` on the wrapping
// `lexical_declaration`). An importer must bind to the `Function`, or the call
// site has no callable to point a CALLS edge at.
//
// Mirrors apps/api/src/typegraphql-prisma/decorators.ts in the monorepo where
// this blind spot was found.

export const applyPrismaTypeGraphqlDecorators = (): void => {
  // body intentionally trivial
};

export const pinBigIntInputs = (): void => {
  // second star-re-exported callable, to show the fix is not single-name luck
};
