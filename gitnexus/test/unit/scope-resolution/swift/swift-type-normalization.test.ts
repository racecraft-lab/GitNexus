/**
 * Swift type-name normalization for receiver-typed resolution
 * (`interpretSwiftTypeBinding`). Re-homes the fork's `swift-scope.test.ts`
 * type-normalization block (CAT-B #12) onto the current modular
 * `interpret.ts`; the fork's version imported the since-deleted
 * `interpretSwiftTypeBinding` from `swift/scope.js`.
 *
 * Nested single-arg wrappers unwrap to a fixpoint. Multi-arg generics
 * (`Result<T, E>`, `Dictionary<K, V>`) and dictionary literals (`[K: V]`) are
 * a DELIBERATE accepted-upstream divergence (sync ledger §4z) — element
 * semantics aren't unambiguous — and are asserted to stay unchanged.
 */
import { describe, it, expect } from 'vitest';
import type { Capture, CaptureMatch } from 'gitnexus-shared';
import { interpretSwiftTypeBinding } from '../../../../src/core/ingestion/languages/swift/interpret.js';

const ZERO_RANGE = { startLine: 0, startCol: 0, endLine: 0, endCol: 0 } as const;

function cap(name: string, text: string): Capture {
  return { name, text, range: ZERO_RANGE };
}

/** Build a minimal parameter-annotation type binding and return its
 *  normalized `rawTypeName`. */
function normalized(typeText: string): string {
  const match: CaptureMatch = {
    '@type-binding.name': cap('@type-binding.name', 'value'),
    '@type-binding.type': cap('@type-binding.type', typeText),
  };
  const binding = interpretSwiftTypeBinding(match);
  expect(binding).not.toBeNull();
  return binding!.rawTypeName;
}

describe('Swift type-name normalization (interpretSwiftTypeBinding)', () => {
  it('unwraps single-layer optional, array sugar, and single-arg generics', () => {
    expect(normalized('User?')).toBe('User');
    expect(normalized('User!')).toBe('User');
    expect(normalized('[User]')).toBe('User');
    expect(normalized('Array<User>')).toBe('User');
    expect(normalized('Optional<User>')).toBe('User');
    expect(normalized('Foundation.URL')).toBe('URL');
  });

  it('unwraps nested single-arg wrappers to a fixpoint', () => {
    expect(normalized('Array<Optional<User>>')).toBe('User');
    expect(normalized('Optional<Array<User>>')).toBe('User');
    expect(normalized('[User?]')).toBe('User');
    expect(normalized('Set<Optional<User>>')).toBe('User');
  });

  it('leaves multi-arg generics and dictionary literals unchanged (accepted divergence)', () => {
    expect(normalized('Result<User, Error>')).toBe('Result<User, Error>');
    expect(normalized('Dictionary<String, User>')).toBe('Dictionary<String, User>');
    expect(normalized('[String: User]')).toBe('[String: User]');
  });

  it('does not corrupt a module-qualified type nested inside a multi-arg generic', () => {
    // `stripQualifier`'s naive `lastIndexOf('.')` used to slice into the
    // multi-arg generic's inner type list instead of leaving the whole
    // (deliberately unstripped) spelling alone — `Result<Foundation.URL,
    // Error>` became `"URL, Error>"`.
    expect(normalized('Result<Foundation.URL, Error>')).toBe('Result<Foundation.URL, Error>');
    expect(normalized('Dictionary<String, Foundation.URL>')).toBe(
      'Dictionary<String, Foundation.URL>',
    );
  });
});
