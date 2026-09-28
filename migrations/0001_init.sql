-- 安全掲示板システム: D1データベース初期スキーマ
-- ボード1件を1行のJSON文字列として保存する(server.jsのファイル保存を置き換え)

CREATE TABLE IF NOT EXISTS boards (
  id TEXT PRIMARY KEY,
  edit_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  data TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_boards_edit_key ON boards (edit_key);
CREATE INDEX IF NOT EXISTS idx_boards_created_at ON boards (created_at);
