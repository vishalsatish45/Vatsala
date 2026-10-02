import fs from 'fs';
import path from 'path';

import en from '../en.json';
import hi from '../hi.json';
import kn from '../kn.json';

const SRC = path.resolve(__dirname, '../..');

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) {
      if (name !== '__tests__') sourceFiles(p, out);
    } else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

/** Every literal key passed to `t('…')` (or `tEn('…')`) anywhere in src/. Template keys are checked where they are built. */
function usedKeys(): Map<string, string> {
  const keys = new Map<string, string>();
  for (const file of sourceFiles(SRC)) {
    const text = fs.readFileSync(file, 'utf8');
    // Only files that translate (a local helper named `t` elsewhere is not i18n).
    if (!/react-i18next|i18next|@\/lib\/i18n/.test(text)) continue;
    for (const m of text.matchAll(/\bt(?:En)?\(\s*['"]([A-Za-z0-9_.-]+)['"]/g)) {
      if (!keys.has(m[1]!)) keys.set(m[1]!, path.relative(SRC, file));
    }
  }
  return keys;
}

const lookup = (dict: unknown, key: string) =>
  key.split('.').reduce<unknown>((node, part) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined), dict);

/** A key resolves when it is a string, or a plural family (`key_one` / `key_other`, used with `{ count }`). */
const has = (dict: unknown, key: string) => typeof lookup(dict, key) === 'string' || typeof lookup(dict, `${key}_other`) === 'string';

describe('i18n keys', () => {
  const keys = usedKeys();

  it('finds the keys used in the app', () => {
    expect(keys.size).toBeGreaterThan(100);
  });

  it.each([
    ['en', en],
    ['kn', kn],
    ['hi', hi],
  ])('every key used in src/ exists in %s.json', (_lang, dict) => {
    const missing = [...keys].filter(([k]) => !has(dict, k)).map(([k, file]) => `${k} (${file})`);
    expect(missing).toEqual([]);
  });

  // Keys handed around as data (`placeKey: 'family.place.lab'`, `bring: ['family.prep.bring']`) and translated later.
  it('every family key named as a string in the Family code exists in en.json', () => {
    const named = new Map<string, string>();
    for (const file of sourceFiles(SRC).filter((f) => /[\\/]family[\\/]/.test(f))) {
      for (const m of fs.readFileSync(file, 'utf8').matchAll(/['"](family\.[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+)['"]/g)) named.set(m[1]!, path.relative(SRC, file));
    }
    expect(named.size).toBeGreaterThan(5);
    expect([...named].filter(([k]) => !has(en, k)).map(([k, file]) => `${k} (${file})`)).toEqual([]);
  });

  it.each([
    ['kn', kn],
    ['hi', hi],
  ])('%s.json has every key en.json has (keys built at run time included)', (_lang, dict) => {
    const flat = (node: unknown, prefix = ''): string[] =>
      Object.entries(node as Record<string, unknown>).flatMap(([k, v]) => (v && typeof v === 'object' ? flat(v, `${prefix}${k}.`) : [`${prefix}${k}`]));
    expect(flat(en).filter((k) => typeof lookup(dict, k) !== 'string')).toEqual([]);
  });

  it('kn and hi stay marked as drafts pending review', () => {
    expect(String((kn as Record<string, unknown>)._note)).toMatch(/DRAFT/);
    expect(String((hi as Record<string, unknown>)._note)).toMatch(/DRAFT/);
  });
});
