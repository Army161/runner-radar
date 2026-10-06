import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDb } from '../db.ts';
import { Backups } from '../backup.ts';

test('daily backups are readable and only the last 7 are kept', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'rr-bk-'));
  try {
    const dbPath = join(dir, 'radar.db');
    const db = openDb(dbPath);
    db.prepare("INSERT INTO users (id, name, created_at) VALUES ('u1', 'Test', 1)").run();
    const b = new Backups(db, dbPath);
    const day = 86_400_000, start = Date.parse('2026-10-01T05:00:00Z');
    for (let i = 0; i < 9; i++) assert.equal(await b.runIfDue(start + i * day), true);
    assert.equal(await b.runIfDue(start + 8 * day), false, 'one per day');
    const files = readdirSync(join(dir, 'backups')).sort();
    assert.equal(files.length, 7);
    assert.equal(files[0], 'radar-2026-10-03.db');
    const copy = new DatabaseSync(join(dir, 'backups', files[6]));
    assert.equal((copy.prepare('SELECT name FROM users').get() as any).name, 'Test');
    copy.close(); db.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
