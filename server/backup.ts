import { backup } from 'node:sqlite';
import { mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { DB } from './db.ts';
import { log } from './util.ts';

const KEEP = 7;

/**
 * One online SQLite backup per UTC day into <db dir>/backups, keeping the last 7.
 * Protects against corruption or a bad deploy. It sits on the same disk, so it is not
 * protection against losing the disk itself; enable your host's disk snapshots for that.
 */
export class Backups {
  private db: DB;
  private dir: string;
  private timer: NodeJS.Timeout | null = null;
  lastAt: number | null = null;
  lastError: string | null = null;

  constructor(db: DB, dbPath: string) {
    this.db = db;
    this.dir = join(dirname(dbPath), 'backups');
    this.lastAt = this.newest()?.at ?? null;
  }

  start() {
    const run = () => this.runIfDue().catch((e) => { this.lastError = String(e?.message ?? e); log.error('Backup failed:', e); });
    setTimeout(run, 60_000);
    this.timer = setInterval(run, 60 * 60_000);
  }
  stop() { if (this.timer) clearInterval(this.timer); }

  private newest(): { file: string; at: number } | null {
    try {
      const files = readdirSync(this.dir).filter((f) => /^radar-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort();
      const f = files[files.length - 1];
      return f ? { file: f, at: statSync(join(this.dir, f)).mtimeMs } : null;
    } catch { return null; }
  }

  async runIfDue(now = Date.now()) {
    const name = `radar-${new Date(now).toISOString().slice(0, 10)}.db`;
    mkdirSync(this.dir, { recursive: true });
    const existing = readdirSync(this.dir);
    if (existing.includes(name)) return false;
    await backup(this.db, join(this.dir, name));
    this.lastAt = Date.now();
    this.lastError = null;
    const all = readdirSync(this.dir).filter((f) => /^radar-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort();
    for (const old of all.slice(0, Math.max(0, all.length - KEEP))) unlinkSync(join(this.dir, old));
    log.info(`Database backed up to backups/${name}`);
    return true;
  }

  status() { return { lastAt: this.lastAt, lastError: this.lastError, keep: KEEP }; }
}
