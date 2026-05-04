/**
 * Phase: tools
 *
 * Detects MCP/RPC tool definitions and creates Tool graph nodes.
 *
 * @deps    parse
 * @reads   allToolDefs (from parse), allPaths
 * @writes  graph (Tool nodes, HANDLES_TOOL edges)
 * @output  toolDefs array
 */

import type { PipelinePhase, PipelineContext, PhaseResult } from './types.js';
import { getPhaseOutput } from './types.js';
import type { ParseOutput } from './parse.js';
import { generateId } from '../../../lib/utils.js';
import { readFileContents } from '../filesystem-walker.js';
import { isDev } from '../utils/env.js';
import type { GraphNode } from 'gitnexus-shared';

export interface ToolDef {
  name: string;
  filePath: string;
  description: string;
  handlerNodeId?: string;
}

export interface ToolsOutput {
  toolDefs: ToolDef[];
}

type SymbolIndex = Map<string, GraphNode[]>;

const TOOL_HANDLER_LABELS = new Set(['Function', 'Method', 'Const', 'Class', 'Struct']);

export const toolsPhase: PipelinePhase<ToolsOutput> = {
  name: 'tools',
  deps: ['parse'],

  async execute(
    ctx: PipelineContext,
    deps: ReadonlyMap<string, PhaseResult<unknown>>,
  ): Promise<ToolsOutput> {
    const { allToolDefs, allPaths } = getPhaseOutput<ParseOutput>(deps, 'parse');

    const toolDefs: ToolDef[] = [];
    const seenToolNames = new Set<string>();
    const symbolIndex = buildSymbolIndex(ctx.graph.nodes);

    const addToolDef = (td: ToolDef): void => {
      if (seenToolNames.has(td.name)) return;
      seenToolNames.add(td.name);
      const handlerNodeId =
        td.handlerNodeId && ctx.graph.getNode(td.handlerNodeId) ? td.handlerNodeId : undefined;
      toolDefs.push({
        name: td.name,
        filePath: td.filePath,
        description: normalizeDescription(td.description),
        ...(handlerNodeId !== undefined ? { handlerNodeId } : {}),
      });
    };

    for (const td of allToolDefs) {
      addToolDef({
        name: td.toolName,
        filePath: td.filePath,
        description: td.description,
        ...(td.handlerNodeId !== undefined ? { handlerNodeId: td.handlerNodeId } : {}),
      });
    }

    // MCP-aware static extraction covers current registerTool(), deprecated server.tool(),
    // Swift MCPTool conformances, and official Swift Tool(...) list entries.
    const toolCandidatePaths = allPaths.filter(isToolExtractionCandidatePath);
    if (toolCandidatePaths.length > 0) {
      const toolContents = await readFileContents(ctx.repoPath, toolCandidatePaths);
      const toolDescriptions = collectToolDescriptionMap(toolContents);
      for (const [filePath, content] of toolContents) {
        if (isTypeScriptLike(filePath)) {
          for (const td of extractTypeScriptMcpTools(
            filePath,
            content,
            toolDescriptions,
            symbolIndex,
          )) {
            addToolDef(td);
          }
        } else if (filePath.endsWith('.swift')) {
          for (const td of extractSwiftMcpTools(filePath, content, symbolIndex)) {
            addToolDef(td);
          }
        }
      }
    }

    // Create Tool nodes and HANDLES_TOOL edges
    if (toolDefs.length > 0) {
      for (const td of toolDefs) {
        const toolNodeId = generateId('Tool', td.name);
        ctx.graph.addNode({
          id: toolNodeId,
          label: 'Tool',
          properties: { name: td.name, filePath: td.filePath, description: td.description },
        });

        const handlerId = td.handlerNodeId ?? generateId('File', td.filePath);
        ctx.graph.addRelationship({
          id: generateId('HANDLES_TOOL', `${handlerId}->${toolNodeId}`),
          sourceId: handlerId,
          targetId: toolNodeId,
          type: 'HANDLES_TOOL',
          confidence: 1.0,
          reason: 'tool-definition',
        });
      }

      if (isDev) {
        console.log(`🔧 Tool registry: ${toolDefs.length} tools detected`);
      }
    }

    return { toolDefs };
  },
};

function isToolExtractionCandidatePath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  const lower = normalized.toLowerCase();
  if (
    lower.includes('/node_modules/') ||
    lower.includes('/vendor/') ||
    lower.includes('/fixtures/') ||
    lower.includes('/test/') ||
    lower.includes('/tests/') ||
    lower.includes('/__') ||
    lower.endsWith('.d.ts')
  ) {
    return false;
  }
  return isTypeScriptLike(lower) || lower.endsWith('.swift');
}

function isTypeScriptLike(filePath: string): boolean {
  return (
    filePath.endsWith('.ts') ||
    filePath.endsWith('.tsx') ||
    filePath.endsWith('.js') ||
    filePath.endsWith('.jsx')
  );
}

function buildSymbolIndex(nodes: readonly GraphNode[]): SymbolIndex {
  const index: SymbolIndex = new Map();
  for (const node of nodes) {
    if (!TOOL_HANDLER_LABELS.has(node.label)) continue;
    const name = typeof node.properties.name === 'string' ? node.properties.name : undefined;
    if (!name) continue;
    const list = index.get(name) ?? [];
    list.push(node);
    index.set(name, list);
  }
  return index;
}

function resolveSymbolNodeId(
  symbolIndex: SymbolIndex,
  name: string | undefined,
  filePath: string,
): string | undefined {
  if (!name) return undefined;
  const candidates = symbolIndex.get(name) ?? [];
  if (candidates.length === 0) return undefined;
  const sameFile = candidates.find((node) => node.properties.filePath === filePath);
  return (sameFile ?? candidates[0]).id;
}

function extractTypeScriptMcpTools(
  filePath: string,
  content: string,
  toolDescriptions: Map<string, string>,
  symbolIndex: SymbolIndex,
): ToolDef[] {
  if (!content.includes('.tool(') && !content.includes('.registerTool(')) return [];

  const tools: ToolDef[] = [];
  for (const args of findMemberCallArguments(content, 'tool')) {
    const name = readQuotedString(args[0]);
    if (!name) continue;
    const handlerNodeId = resolveTypeScriptHandler(symbolIndex, args.at(-1), filePath);
    tools.push({
      name,
      filePath,
      description: resolveTypeScriptDescription(args[1], name, toolDescriptions),
      ...(handlerNodeId !== undefined ? { handlerNodeId } : {}),
    });
  }

  for (const args of findMemberCallArguments(content, 'registerTool')) {
    const name = readQuotedString(args[0]);
    if (!name) continue;
    const handlerNodeId = resolveTypeScriptHandler(symbolIndex, args[2], filePath);
    tools.push({
      name,
      filePath,
      description: resolveTypeScriptDescription(args[1], name, toolDescriptions),
      ...(handlerNodeId !== undefined ? { handlerNodeId } : {}),
    });
  }

  return tools;
}

function collectToolDescriptionMap(toolContents: ReadonlyMap<string, string>): Map<string, string> {
  const descriptions = new Map<string, string>();
  const entryPattern =
    /(?:^|[,{]\s*)(?:['"]?([A-Za-z0-9_.:-]+)['"]?)\s*:\s*(['"`])([\s\S]*?)\2/gm;
  for (const [filePath, content] of toolContents) {
    if (!isTypeScriptLike(filePath) || !content.includes('DESCRIPTION')) continue;
    let match: RegExpExecArray | null;
    while ((match = entryPattern.exec(content)) !== null) {
      descriptions.set(match[1], normalizeDescription(match[3]));
    }
  }
  return descriptions;
}

function resolveTypeScriptDescription(
  descriptionArg: string | undefined,
  toolName: string,
  toolDescriptions: Map<string, string>,
): string {
  const literal = readQuotedString(descriptionArg);
  if (literal !== undefined) return literal;

  const objectDescription = readObjectStringProperty(descriptionArg, 'description');
  if (objectDescription !== undefined) return objectDescription;

  const descCallToolName = readFirstCallStringArg(descriptionArg, 'desc');
  if (descCallToolName !== undefined) {
    return toolDescriptions.get(descCallToolName) ?? '';
  }

  return toolDescriptions.get(toolName) ?? '';
}

function resolveTypeScriptHandler(
  symbolIndex: SymbolIndex,
  handlerArg: string | undefined,
  filePath: string,
): string | undefined {
  if (!handlerArg) return undefined;
  for (const name of extractHandlerCandidateNames(handlerArg)) {
    const nodeId = resolveSymbolNodeId(symbolIndex, name, filePath);
    if (nodeId !== undefined) return nodeId;
  }
  return undefined;
}

function extractHandlerCandidateNames(handlerArg: string): string[] {
  const names: string[] = [];
  const handlerMemberPattern =
    /\b([A-Za-z_$][\w$]*)\s*(?:\.\s*(?!handler\b)[A-Za-z_$][\w$]*)*\s*\.\s*handler\b/g;
  let match: RegExpExecArray | null;
  while ((match = handlerMemberPattern.exec(handlerArg)) !== null) {
    names.push(match[1]);
  }

  const bareIdentifier = /^\s*([A-Za-z_$][\w$]*)\s*$/u.exec(handlerArg);
  if (bareIdentifier) names.push(bareIdentifier[1]);

  return [...new Set(names)];
}

function extractSwiftMcpTools(
  filePath: string,
  content: string,
  symbolIndex: SymbolIndex,
): ToolDef[] {
  if (!content.includes('MCPTool') && !content.includes('Tool(')) return [];
  return [
    ...extractSwiftMcpToolConformances(filePath, content, symbolIndex),
    ...extractSwiftToolInitializers(filePath, content),
  ];
}

function extractSwiftMcpToolConformances(
  filePath: string,
  content: string,
  symbolIndex: SymbolIndex,
): ToolDef[] {
  const tools: ToolDef[] = [];
  const declarationPattern =
    /\b(?:(?:public|internal|private|fileprivate|open|final)\s+)*(?:struct|class)\s+([A-Za-z_]\w*)\s*:[^{]*\bMCPTool\b[^{]*\{/g;
  let match: RegExpExecArray | null;
  while ((match = declarationPattern.exec(content)) !== null) {
    const typeName = match[1];
    const openBrace = declarationPattern.lastIndex - 1;
    const closeBrace = findMatchingDelimiter(content, openBrace, '{', '}');
    if (closeBrace === -1) continue;
    const body = content.slice(openBrace + 1, closeBrace);
    const name = readSwiftStringProperty(body, 'name');
    if (!name) continue;
    const handlerNodeId = resolveSymbolNodeId(symbolIndex, typeName, filePath);
    tools.push({
      name,
      filePath,
      description: readSwiftStringProperty(body, 'description') ?? '',
      ...(handlerNodeId !== undefined ? { handlerNodeId } : {}),
    });
  }
  return tools;
}

function extractSwiftToolInitializers(filePath: string, content: string): ToolDef[] {
  const tools: ToolDef[] = [];
  for (const args of findIdentifierCallArguments(content, 'Tool')) {
    const name = readNamedSwiftStringArg(args, 'name');
    if (!name) continue;
    tools.push({
      name,
      filePath,
      description: readNamedSwiftStringArg(args, 'description') ?? '',
    });
  }
  return tools;
}

function findMemberCallArguments(content: string, methodName: string): string[][] {
  const pattern = new RegExp(`\\b[A-Za-z_$][\\w$]*\\s*\\.\\s*${methodName}\\s*\\(`, 'g');
  return findCallArguments(content, pattern);
}

function findIdentifierCallArguments(content: string, identifier: string): string[][] {
  const pattern = new RegExp(`(^|[^.\\w$])${identifier}\\s*\\(`, 'g');
  return findCallArguments(content, pattern);
}

function findCallArguments(content: string, pattern: RegExp): string[][] {
  const calls: string[][] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) {
    const openParen = content.indexOf('(', match.index);
    if (openParen === -1) continue;
    const closeParen = findMatchingDelimiter(content, openParen, '(', ')');
    if (closeParen === -1) continue;
    calls.push(splitTopLevelArgs(content.slice(openParen + 1, closeParen)));
    pattern.lastIndex = closeParen + 1;
  }
  return calls;
}

function splitTopLevelArgs(source: string): string[] {
  const args: string[] = [];
  let start = 0;
  let depth = 0;
  let quote: string | undefined;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    const next = source[i + 1];

    if (lineComment) {
      if (char === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === '*' && next === '/') {
        blockComment = false;
        i++;
      }
      continue;
    }
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        quote = undefined;
      }
      continue;
    }
    if (char === '/' && next === '/') {
      lineComment = true;
      i++;
      continue;
    }
    if (char === '/' && next === '*') {
      blockComment = true;
      i++;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '(' || char === '[' || char === '{') {
      depth++;
      continue;
    }
    if (char === ')' || char === ']' || char === '}') {
      depth--;
      continue;
    }
    if (char === ',' && depth === 0) {
      args.push(source.slice(start, i).trim());
      start = i + 1;
    }
  }

  const tail = source.slice(start).trim();
  if (tail.length > 0) args.push(tail);
  return args;
}

function findMatchingDelimiter(
  source: string,
  openIndex: number,
  open: string,
  close: string,
): number {
  let depth = 0;
  let quote: string | undefined;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let i = openIndex; i < source.length; i++) {
    const char = source[i];
    const next = source[i + 1];

    if (lineComment) {
      if (char === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === '*' && next === '/') {
        blockComment = false;
        i++;
      }
      continue;
    }
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        quote = undefined;
      }
      continue;
    }
    if (char === '/' && next === '/') {
      lineComment = true;
      i++;
      continue;
    }
    if (char === '/' && next === '*') {
      blockComment = true;
      i++;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === open) {
      depth++;
      continue;
    }
    if (char === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function readQuotedString(source: string | undefined): string | undefined {
  if (!source) return undefined;
  const trimmed = source.trim();
  const quote = trimmed[0];
  if (quote !== '"' && quote !== "'" && quote !== '`') return undefined;
  let escaped = false;
  for (let i = 1; i < trimmed.length; i++) {
    const char = trimmed[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === quote) {
      return normalizeDescription(trimmed.slice(1, i));
    }
  }
  return undefined;
}

function readObjectStringProperty(source: string | undefined, propertyName: string): string | undefined {
  if (!source) return undefined;
  const pattern = new RegExp(
    `(?:^|[,\\{]\\s*)(?:${propertyName}|['"]${propertyName}['"])\\s*:\\s*(['"\`])([\\s\\S]*?)\\1`,
  );
  const match = pattern.exec(source);
  return match ? normalizeDescription(match[2]) : undefined;
}

function readFirstCallStringArg(source: string | undefined, functionName: string): string | undefined {
  if (!source) return undefined;
  const pattern = new RegExp(`\\b${functionName}\\s*\\(\\s*(['"\`])([^'"\`]+)\\1`);
  const match = pattern.exec(source);
  return match?.[2];
}

function readSwiftStringProperty(source: string, propertyName: string): string | undefined {
  const pattern = new RegExp(
    `\\b(?:public|internal|private|fileprivate|open)?\\s*(?:let|var)\\s+${propertyName}\\s*(?::[^=]+)?=\\s*(?:"""([\\s\\S]*?)"""|"([^"]*)")`,
  );
  const match = pattern.exec(source);
  return normalizeDescription(match?.[1] ?? match?.[2] ?? '');
}

function readNamedSwiftStringArg(args: readonly string[], name: string): string | undefined {
  const prefix = `${name}:`;
  const arg = args.find((item) => item.trimStart().startsWith(prefix));
  if (!arg) return undefined;
  return readQuotedString(arg.trimStart().slice(prefix.length));
}

function normalizeDescription(description: string | undefined): string {
  return (description ?? '').slice(0, 200).replace(/\s+/g, ' ').trim();
}
