import type { ProposedEdit } from './types.js';

export class EditError extends Error {}

/**
 * Applies search/replace edits in order. Each `search` must occur exactly once
 * in the text as it stands after the previous edits. Line endings in the edits
 * are adapted to the file's, since models write `\n`.
 */
export function applyEdits(content: string, edits: Pick<ProposedEdit, 'search' | 'replace'>[]): string {
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  const adapt = (s: string) => s.replace(/\r\n/g, '\n').replace(/\n/g, eol);

  let result = content;
  edits.forEach((edit, i) => {
    const search = adapt(edit.search);
    if (search.length === 0) {
      throw new EditError(`Edit ${i + 1} has an empty search string.`);
    }
    const index = result.indexOf(search);
    if (index === -1) {
      throw new EditError(`Edit ${i + 1}: the text to replace was not found. The file may have changed since the analysis.`);
    }
    if (result.indexOf(search, index + 1) !== -1) {
      throw new EditError(`Edit ${i + 1}: the text to replace appears more than once, so the edit is ambiguous.`);
    }
    result = result.slice(0, index) + adapt(edit.replace) + result.slice(index + search.length);
  });
  return result;
}

/**
 * The smallest single range that turns `before` into `after`, so an editor can
 * replace just that span instead of the whole document.
 */
export function minimalReplacement(before: string, after: string): { start: number; end: number; text: string } {
  let start = 0;
  const maxPrefix = Math.min(before.length, after.length);
  while (start < maxPrefix && before[start] === after[start]) start++;

  let beforeEnd = before.length;
  let afterEnd = after.length;
  while (beforeEnd > start && afterEnd > start && before[beforeEnd - 1] === after[afterEnd - 1]) {
    beforeEnd--;
    afterEnd--;
  }
  return { start, end: beforeEnd, text: after.slice(start, afterEnd) };
}

export function groupEditsByFile(edits: ProposedEdit[]): Map<string, ProposedEdit[]> {
  const byFile = new Map<string, ProposedEdit[]>();
  for (const edit of edits) {
    const list = byFile.get(edit.file) ?? [];
    list.push(edit);
    byFile.set(edit.file, list);
  }
  return byFile;
}
