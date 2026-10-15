import * as path from 'node:path';
import type { AnalysisResult, CodeLocation, Confidence, ProposedEdit } from './types.js';

/** JSON Schema handed to the agent as its required output format. Mirrors AnalysisResult. */
export const ANALYSIS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'explanation', 'confidence', 'locations', 'edits'],
  properties: {
    summary: { type: 'string', description: 'One or two sentences: what is wrong and where.' },
    explanation: {
      type: 'string',
      description: 'Markdown. Root cause, how the proposed fix addresses it, and anything the developer should verify.',
    },
    confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
    locations: {
      type: 'array',
      description: 'Most relevant code ranges, most important first.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['file', 'startLine', 'endLine', 'reason'],
        properties: {
          file: { type: 'string', description: 'Path relative to the repository root.' },
          startLine: { type: 'integer', minimum: 1 },
          endLine: { type: 'integer', minimum: 1 },
          reason: { type: 'string', description: 'Why this range matters, in under 80 characters.' },
        },
      },
    },
    edits: {
      type: 'array',
      description: 'Search/replace edits implementing the fix. Empty when no confident fix exists.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['file', 'search', 'replace', 'description'],
        properties: {
          file: { type: 'string', description: 'Path relative to the repository root. Must be an existing file.' },
          search: {
            type: 'string',
            description: 'Exact text copied from the file, including indentation, matching exactly one place.',
          },
          replace: { type: 'string' },
          description: { type: 'string' },
        },
      },
    },
  },
} as const;

const CONFIDENCE: readonly Confidence[] = ['low', 'medium', 'high'];

export class InvalidAnalysisError extends Error {}

/**
 * Validates the agent's structured output and normalizes every path to be
 * relative to `root`. Locations and edits pointing outside `root` are dropped
 * and reported in `dropped`.
 */
export function parseAnalysisResult(value: unknown, root: string): { result: AnalysisResult; dropped: string[] } {
  const obj = asRecord(value, 'result');
  const dropped: string[] = [];

  const locations: CodeLocation[] = [];
  for (const raw of asArray(obj.locations, 'locations')) {
    const loc = asRecord(raw, 'location');
    const file = normalizePath(asString(loc.file, 'location.file'), root);
    if (!file) {
      dropped.push(`location ${String(loc.file)}`);
      continue;
    }
    const startLine = asLine(loc.startLine, 'location.startLine');
    const endLine = Math.max(startLine, asLine(loc.endLine, 'location.endLine'));
    locations.push({ file, startLine, endLine, reason: asString(loc.reason, 'location.reason') });
  }

  const edits: ProposedEdit[] = [];
  for (const raw of asArray(obj.edits, 'edits')) {
    const edit = asRecord(raw, 'edit');
    const file = normalizePath(asString(edit.file, 'edit.file'), root);
    if (!file) {
      dropped.push(`edit ${String(edit.file)}`);
      continue;
    }
    edits.push({
      file,
      search: asString(edit.search, 'edit.search'),
      replace: asString(edit.replace, 'edit.replace'),
      description: asString(edit.description, 'edit.description'),
    });
  }

  const confidence = asString(obj.confidence, 'confidence');
  if (!CONFIDENCE.includes(confidence as Confidence)) {
    throw new InvalidAnalysisError(`Unexpected confidence "${confidence}".`);
  }

  return {
    result: {
      summary: asString(obj.summary, 'summary'),
      explanation: asString(obj.explanation, 'explanation'),
      confidence: confidence as Confidence,
      locations,
      edits,
    },
    dropped,
  };
}

/** Returns a forward-slash path relative to root, or undefined if it escapes root. */
export function normalizePath(file: string, root: string): string | undefined {
  const absolute = path.resolve(root, file);
  const relative = path.relative(root, absolute);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return undefined;
  return relative.split(path.sep).join('/');
}

function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new InvalidAnalysisError(`Expected ${what} to be an object.`);
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown, what: string): unknown[] {
  if (!Array.isArray(value)) throw new InvalidAnalysisError(`Expected ${what} to be an array.`);
  return value;
}

function asString(value: unknown, what: string): string {
  if (typeof value !== 'string') throw new InvalidAnalysisError(`Expected ${what} to be a string.`);
  return value;
}

function asLine(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new InvalidAnalysisError(`Expected ${what} to be a positive integer.`);
  }
  return value;
}
