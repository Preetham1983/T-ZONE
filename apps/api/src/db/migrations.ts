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

    CREATE TABLE IF NOT EXISTS meeting_missions (
      id TEXT PRIMARY KEY,
      subject TEXT NOT NULL,
      organizer_name TEXT NOT NULL DEFAULT '',
      start_dt TEXT NOT NULL DEFAULT '',
      end_dt TEXT NOT NULL DEFAULT '',
      join_url TEXT,
      meeting_chat_id TEXT,
      bot_display_name TEXT NOT NULL DEFAULT 'T-ZONE Agent',
      attendees_json TEXT NOT NULL DEFAULT '[]',
      role_preset TEXT NOT NULL DEFAULT 'researcher',
      role_title TEXT NOT NULL,
      role_instructions TEXT NOT NULL,
      focus_topics_json TEXT NOT NULL DEFAULT '[]',
      auto_notes INTEGER NOT NULL DEFAULT 1,
      auto_respond_chat INTEGER NOT NULL DEFAULT 0,
      auto_extract_transcript INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'scheduled',
      conversation_id TEXT,
      prep_brief TEXT NOT NULL DEFAULT '',
      live_notes TEXT NOT NULL DEFAULT '',
      utterances_json TEXT NOT NULL DEFAULT '[]',
      linked_transcript_id TEXT,
      joined_at TEXT,
      ended_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tzone_boards (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      color TEXT NOT NULL DEFAULT '#2563eb',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tzone_tasks (
      id TEXT PRIMARY KEY,
      board_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'todo',
      priority TEXT NOT NULL DEFAULT 'medium',
      due_date TEXT,
      tags_json TEXT NOT NULL DEFAULT '[]',
      assignee TEXT NOT NULL DEFAULT '',
      checklist_json TEXT NOT NULL DEFAULT '[]',
      source_type TEXT NOT NULL DEFAULT 'manual',
      source_id TEXT,
      position INTEGER NOT NULL DEFAULT 0,
      completed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (board_id) REFERENCES tzone_boards(id) ON DELETE CASCADE
    );
  `);

  try {
    db.exec(
      "ALTER TABLE meeting_missions ADD COLUMN bot_display_name TEXT NOT NULL DEFAULT 'T-ZONE Agent'"
    );
  } catch {
    // Column already exists on newer schemas
  }
}
