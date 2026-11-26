import type { DatabaseSync } from 'node:sqlite';

export function runMigrations(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      playbook_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      tool_traces_json TEXT NOT NULL DEFAULT '[]',
      citations_json TEXT NOT NULL DEFAULT '[]',
      provider_label TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS pending_actions (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      tool_name TEXT NOT NULL,
      title TEXT NOT NULL,
      target_description TEXT NOT NULL,
      args_json TEXT NOT NULL,
      preview_text TEXT NOT NULL,
      status TEXT NOT NULL,
      result_text TEXT,
      created_at TEXT NOT NULL,
      resolved_at TEXT,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS chats_cache (
      id TEXT PRIMARY KEY,
      chat_type TEXT NOT NULL,
      topic TEXT,
      display_title TEXT NOT NULL,
      last_updated TEXT NOT NULL,
      members_json TEXT NOT NULL DEFAULT '[]',
      last_message_json TEXT,
      synced_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS teams_cache (
      id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      description TEXT,
      channels_json TEXT NOT NULL DEFAULT '[]',
      synced_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS transcripts (
      id TEXT PRIMARY KEY,
      meeting_id TEXT NOT NULL,
      transcript_id TEXT NOT NULL,
      subject TEXT NOT NULL,
      organizer_name TEXT NOT NULL,
      start_dt TEXT NOT NULL,
      end_dt TEXT NOT NULL,
      join_url TEXT NOT NULL,
      created_dt TEXT NOT NULL,
      raw_vtt TEXT NOT NULL,
      plain_text TEXT NOT NULL,
      segments_json TEXT NOT NULL,
      speaker_stats_json TEXT NOT NULL,
      insights_status TEXT NOT NULL,
      insights_json TEXT NOT NULL DEFAULT '[]',
      extracted_at TEXT NOT NULL
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS fts_items USING fts5(
      id UNINDEXED,
      source_type UNINDEXED,
      source_id UNINDEXED,
      parent_id UNINDEXED,
      title,
      speaker_or_sender,
      occurred_at UNINDEXED,
      body
    );

    CREATE TABLE IF NOT EXISTS skill_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      command TEXT NOT NULL,
      duration_ms INTEGER NOT NULL,
      ok INTEGER NOT NULL,
      error_message TEXT,
      created_at TEXT NOT NULL
    );
  `);
}
