/* Chunked keystore storage: a write killed half-way never loses the value that was there before. */
import { secureStorage } from '../secureStorage';

const mockKeys = new Map<string, string>();
let mockFailAfter = Infinity; // simulated kill: the n-th write from now throws

jest.mock('expo-secure-store', () => ({
  getItemAsync: async (k: string) => mockKeys.get(k) ?? null,
  setItemAsync: async (k: string, v: string) => {
    if (mockFailAfter-- <= 0) throw new Error('killed');
    mockKeys.set(k, v);
  },
  deleteItemAsync: async (k: string) => void mockKeys.delete(k),
}));

beforeEach(() => {
  mockKeys.clear();
  mockFailAfter = Infinity;
});

const big = (c: string) => c.repeat(4000); // three chunks

it('reads back what it wrote, and an overwrite leaves no chunks of the old value', async () => {
  await secureStorage.setItem('q', big('a'));
  expect(await secureStorage.getItem('q')).toBe(big('a'));
  await secureStorage.setItem('q', 'short');
  expect(await secureStorage.getItem('q')).toBe('short');
  expect([...mockKeys.keys()].filter((k) => k !== 'q.n')).toHaveLength(1);
});

it('keeps the previous value when a write is killed before it completes', async () => {
  await secureStorage.setItem('q', big('a'));
  mockFailAfter = 2; // two of the three new chunks land, then the app dies
  await expect(secureStorage.setItem('q', big('b'))).rejects.toThrow('killed');
  expect(await secureStorage.getItem('q')).toBe(big('a'));
});

it('reads the first (ungenerationed) format and replaces it on the next write', async () => {
  mockKeys.set('q.n', '2');
  mockKeys.set('q.0', 'hel');
  mockKeys.set('q.1', 'lo');
  expect(await secureStorage.getItem('q')).toBe('hello');
  await secureStorage.setItem('q', 'world');
  expect(await secureStorage.getItem('q')).toBe('world');
  expect(mockKeys.has('q.0')).toBe(false);
});

it('removes every chunk', async () => {
  await secureStorage.setItem('q', big('a'));
  await secureStorage.removeItem('q');
  expect(await secureStorage.getItem('q')).toBeNull();
  expect(mockKeys.size).toBe(0);
});
