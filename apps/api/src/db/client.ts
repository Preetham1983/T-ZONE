import { DatabaseSync } from 'node:sqlite';
import { env } from '../config/env.js';
import { runMigrations } from './migrations.js';

let dbInstance: DatabaseSync | null = null;

export function getDb(dbPath = env.DB_PATH): DatabaseSync {
  if (dbInstance) return dbInstance;
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  runMigrations(db);
  dbInstance = db;
  return db;
}

export function createIsolatedDb(dbPath = ':memory:'): DatabaseSync {
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON;');
  runMigrations(db);
  return db;
}
