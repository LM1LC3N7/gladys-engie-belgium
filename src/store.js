// -----------------------------------------------------------------------------
// What must survive a restart, in /data (the only writable place of the
// container), never the e-mail nor the password:
//   - the ENGIE refresh token, with the account it belongs to (a hash of the
//     e-mail), so a restart does not ask for a new code. It rotates at each
//     refresh: every new one is written before it is used;
//   - the end of a 429 pause, and the spaced new try of a refused session
//     (kept across restarts and account changes);
//   - when a code was last sent (one a minute, across restarts).
// The file is readable by the container user only (0600). The waiting
// sign-in between the two code buttons stays in memory (10 minutes at most).
// -----------------------------------------------------------------------------

import { readFile, rename, writeFile } from 'node:fs/promises';

export const STATE_FILE = '/data/engie-state.json';

export function fileStore(path = STATE_FILE) {
  // One write at a time: two saves never share the temporary file.
  let chain = Promise.resolve();
  return {
    async load() {
      try {
        return JSON.parse(await readFile(path, 'utf8'));
      } catch {
        return null;
      }
    },
    save(data) {
      const text = JSON.stringify(data);
      const write = chain.then(async () => {
        const temporary = `${path}.tmp`;
        await writeFile(temporary, text, { mode: 0o600 });
        await rename(temporary, path);
      });
      chain = write.catch(() => {});
      return write;
    },
  };
}

/** A store in memory (tests, or when /data cannot be read). */
export function memoryStore(initial = null) {
  let data = initial;
  return {
    saves: 0,
    async load() {
      return data === null ? null : JSON.parse(JSON.stringify(data));
    },
    async save(value) {
      this.saves += 1;
      data = JSON.parse(JSON.stringify(value));
    },
    peek: () => data,
  };
}

const time = (value) => (Number.isFinite(value) ? value : undefined);

/** The persisted state, repaired. */
export function normalizeMemory(raw) {
  const s = raw?.session;
  const session =
    s &&
    typeof s.account === 'string' &&
    /^[0-9a-f]{16}$/.test(s.account) &&
    typeof s.refreshToken === 'string' &&
    s.refreshToken.length > 0 &&
    s.refreshToken.length < 8192
      ? { account: s.account, refreshToken: s.refreshToken }
      : null;
  const retries = Number(raw?.sessionRetries);
  return {
    session,
    rateLimitedUntil: time(raw?.rateLimitedUntil),
    sessionRetryAt: time(raw?.sessionRetryAt),
    sessionRetries: Number.isInteger(retries) && retries >= 0 && retries < 100 ? retries : 0,
    codeAt: time(raw?.codeAt),
  };
}
