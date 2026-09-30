import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * `DialogContent` ships `sm:max-w-lg`. A caller passing a bare `max-w-*` does
 * not override it: both declarations are a single class selector, so specificity
 * is equal, and Tailwind emits the responsive variant later in the stylesheet. At
 * desktop width the base wins and the dialog silently stays 512px.
 *
 * Verified against the built CSS rather than assumed - `.sm\:max-w-lg` sits at
 * byte 104719 inside `@media(min-width:40rem)`, the bare `max-w-*` utilities near
 * 23000, and later wins.
 *
 * It shipped that way because a bare `max-w-2xl` on the review dialog read as a
 * working override. It was not: the approve button's label was clipped. So the
 * scan is over source rather than one component, because the failure is invisible
 * at the call site - it only appears in a browser at desktop width.
 */
const SRC = path.resolve(__dirname, '..');

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === '__tests__' ? [] : sourceFiles(full);
    }
    return entry.name.endsWith('.tsx') ? [full] : [];
  });
}

const DIALOG_WIDTH = /<DialogContent[^>]*\bclassName="([^"]*)"/g;

/**
 * A width token, capturing any variant prefix.
 *
 * The prefix has to be part of the match. `\bmax-w-` on its own matches *inside*
 * `sm:max-w-2xl`, because `:` is a non-word character and so is a word boundary -
 * a scanner written that way reports the already-correct `ApprovalQueue`
 * override as broken, which is the exact bug it exists to catch pointed the wrong
 * way round. That is what the first version of this test did.
 */
const WIDTH_TOKEN = /(?:^|\s)((?:[a-z-]+:)*max-w-[\w[\]()/-]+)/g;

describe('DialogContent width overrides', () => {
  const bare: string[] = [];
  let checked = 0;

  for (const file of sourceFiles(SRC)) {
    const source = fs.readFileSync(file, 'utf8');
    const relative = path.relative(SRC, file);

    for (const dialog of source.matchAll(DIALOG_WIDTH)) {
      for (const token of dialog[1].matchAll(WIDTH_TOKEN)) {
        checked += 1;
        if (!token[1].startsWith('sm:')) {
          bare.push(`${relative}: "${token[1]}"`);
        }
      }
    }
  }

  it('finds the width overrides to check', () => {
    // A scanner that silently matched nothing would pass everything below for
    // the wrong reason.
    expect(checked).toBeGreaterThan(10);
  });

  it('every override carries the `sm:` prefix', () => {
    // Each bare one has been rendering at 512px, not the width it asks for.
    expect(bare).toEqual([]);
  });
});
