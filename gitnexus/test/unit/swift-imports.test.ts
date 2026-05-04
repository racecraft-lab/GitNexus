import { describe, expect, it } from 'vitest';
import Parser from 'tree-sitter';
import {
  extractSwiftNamedBindings,
  swiftImportPathPreprocessor,
} from '../../src/core/ingestion/languages/swift.js';
import { SWIFT_QUERIES } from '../../src/core/ingestion/tree-sitter-queries.js';

let Swift: unknown;
try {
  Swift = require('tree-sitter-swift');
  const testParser = new Parser();
  testParser.setLanguage(Swift as Parser.Language);
} catch {
  Swift = null;
}

const parseImport = (code: string): Parser.SyntaxNode => {
  if (!Swift) throw new Error('tree-sitter-swift not available');
  const parser = new Parser();
  parser.setLanguage(Swift as Parser.Language);
  const tree = parser.parse(code);
  const importNode = tree.rootNode.namedChildren.find(
    (child) => child.type === 'import_declaration',
  );
  if (!importNode) throw new Error('import_declaration not found');
  return importNode;
};

const capturedSwiftAnnotationNames = (code: string): string[] => {
  if (!Swift) throw new Error('tree-sitter-swift not available');
  const parser = new Parser();
  parser.setLanguage(Swift as Parser.Language);
  const tree = parser.parse(code);
  const query = new Parser.Query(Swift as Parser.Language, SWIFT_QUERIES);
  return query
    .matches(tree.rootNode)
    .filter((match) => match.captures.some((capture) => capture.name === 'definition.annotation'))
    .flatMap((match) =>
      match.captures
        .filter((capture) => capture.name === 'name')
        .slice(-1)
        .map((capture) => capture.node.text),
    );
};

const capturedSwiftDecoratorNames = (code: string): string[] => {
  if (!Swift) throw new Error('tree-sitter-swift not available');
  const parser = new Parser();
  parser.setLanguage(Swift as Parser.Language);
  const tree = parser.parse(code);
  const query = new Parser.Query(Swift as Parser.Language, SWIFT_QUERIES);
  return query
    .matches(tree.rootNode)
    .filter((match) => match.captures.some((capture) => capture.name === 'decorator'))
    .flatMap((match) =>
      match.captures
        .filter((capture) => capture.name === 'decorator.name')
        .slice(-1)
        .map((capture) => capture.node.text),
    );
};

describe.skipIf(!Swift)('Swift import extraction', () => {
  it('captures the whole qualified import source from tree-sitter queries', () => {
    if (!Swift) throw new Error('tree-sitter-swift not available');
    const parser = new Parser();
    parser.setLanguage(Swift as Parser.Language);
    const tree = parser.parse('import struct Models.User\n');
    const query = new Parser.Query(Swift as Parser.Language, SWIFT_QUERIES);
    const importSource = query
      .captures(tree.rootNode)
      .find((capture) => capture.name === 'import.source');
    expect(importSource?.node.text).toBe('Models.User');
  });

  it('captures Swift attributes as AST annotation definitions', () => {
    expect(
      capturedSwiftAnnotationNames(`
        @main
        struct App {
          @Schemable
          struct Input {}

          @SwiftUI.State var state: State
        }

        @testable import Models
        @_exported import struct Models.User

        @available(macOS 14, *)
        func run() {}
      `),
    ).toEqual(['main', 'Schemable', 'State', 'testable', '_exported', 'available']);
  });

  it('captures Swift attributes as AST decorator detections', () => {
    expect(
      capturedSwiftDecoratorNames(`
        @main
        struct App {
          @Schemable
          struct Input {}

          @SwiftUI.State var state: State
        }

        @testable import Models
        @_exported import struct Models.User

        @available(macOS 14, *)
        func run() {}
      `),
    ).toEqual(['main', 'Schemable', 'State', 'testable', '_exported', 'available']);
  });

  it('normalizes attributed Swift imports to their module or declaration path', () => {
    const plainImport = parseImport('@testable import Models\n');
    const explicitImport = parseImport('@_exported import struct Models.User\n');

    expect(swiftImportPathPreprocessor('Models', plainImport)).toBe('Models');
    expect(swiftImportPathPreprocessor('User', explicitImport)).toBe('Models.User');
  });

  it('extracts named bindings for explicit Swift declaration imports', () => {
    const typeImport = parseImport('import struct Models.User\n');
    const functionImport = parseImport('import func Models.makeUser\n');

    expect(extractSwiftNamedBindings(typeImport)).toEqual([{ local: 'User', exported: 'User' }]);
    expect(extractSwiftNamedBindings(functionImport)).toEqual([
      { local: 'makeUser', exported: 'makeUser' },
    ]);
  });

  it('does not report named bindings for whole-module Swift imports', () => {
    const importNode = parseImport('import Foundation\n');
    expect(extractSwiftNamedBindings(importNode)).toBeUndefined();
  });
});
