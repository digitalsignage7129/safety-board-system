/**
 * Cloudflare Pages Functions 共通ロジック
 *
 * 元のserver.js(Node/Express + ローカルファイル保存)と同じデータ構造・
 * 同じ判定ロジックを、D1(データベース)・R2(画像保存)向けに移植したもの。
 * ボード1件を1行のJSON文字列としてD1に保存する(スキーマ変更を減らし、
 * server.js側のロジックとほぼ同じ形を保つため)。
 */

export const DEFAULT_ROPE_COLORS = ['赤', '黄', '緑', '白'];
export const ID_RE = /^[a-f0-9]{8}$/;

export const VALID_LAYOUT_MODES = ['all', 'single', 'split2', 'split4'];
export const VALID_BLOCK_KEYS = [
  'goals', 'record', 'rope', 'ropeTable', 'cycle', 'rule333', 'signal', 'notice', 'free', 'emergency',
];
export const BLOCKS_PER_MODE = { all: 0, single: 1, split2: 2, split4: 4 };

export const DEFAULT_EMERGENCY_CONTACTS = [
  { label: '現場代理人', name: '', phone: '' },
  { label: '電気', name: '', phone: '' },
  { label: '水道', name: '', phone: '' },
  { label: 'ガス', name: '', phone: '' },
  { label: '警察', name: '', phone: '' },
  { label: '消防', name: '', phone: '' },
  { label: '病院', name: '', phone: '' },
];

export const EDITABLE_FIELDS = [
  'customerName',
  'ropeColors',
  'ropeCycleStartMonth',
  'safetyGoals',
  'noticeText',
  'freeBlocks',
  'targetHours',
  'currentHours',
  'currentHoursAsOfDate',
  'constructionPeriodStart',
  'constructionPeriodEnd',
  'emergencyContacts',
];

export const SHARED_KEYS = ['rope', 'cycle', 'rule333', 'signal'];

// ---- ID/キー生成 ----------------------------------------------------

export function genId() {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}
export function genKey() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ---- 日付ユーティリティ ------------------------------------------------

export function tokyoToday() {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = fmt.formatToParts(new Date());
  const y = +parts.find((p) => p.type === 'year').value;
  const m = +parts.find((p) => p.type === 'month').value;
  const d = +parts.find((p) => p.type === 'day').value;
  return { y, m, d, ymd: `${pad(y, 4)}-${pad(m)}-${pad(d)}`, ym: `${pad(y, 4)}-${pad(m)}` };
}
export function pad(n, len = 2) {
  return String(n).padStart(len, '0');
}

// 玉掛けロープの点検色(4ヶ月周期)を計算する
export function computeDisplay(board) {
  const today = tokyoToday();
  const colors =
    Array.isArray(board.ropeColors) && board.ropeColors.length === 4
      ? board.ropeColors
      : DEFAULT_ROPE_COLORS;
  const startYm = /^\d{4}-\d{2}$/.test(board.ropeCycleStartMonth)
    ? board.ropeCycleStartMonth
    : today.ym;
  const [sy, sm] = startYm.split('-').map(Number);
  const monthsDiff = (today.y - sy) * 12 + (today.m - sm);
  const idx = ((monthsDiff % 4) + 4) % 4;
  const currentRopeColor = colors[idx];
  return {
    todayYmd: today.ymd,
    currentRopeColor,
    currentRopeColorIndex: idx,
  };
}

// ---- D1でのボード読み書き ---------------------------------------------

function backfillBoard(board) {
  if (typeof board.displayInfo !== 'string') board.displayInfo = '';
  if (!board.layout || typeof board.layout !== 'object') board.layout = { mode: 'all', blocks: [] };
  if (!VALID_LAYOUT_MODES.includes(board.layout.mode)) board.layout.mode = 'all';
  if (!Array.isArray(board.layout.blocks)) board.layout.blocks = [];
  if (typeof board.targetHours !== 'number') board.targetHours = Number(board.targetHours) || 0;
  if (typeof board.currentHours !== 'number') board.currentHours = Number(board.currentHours) || 0;
  if (typeof board.currentHoursAsOfDate !== 'string') board.currentHoursAsOfDate = '';
  if (typeof board.constructionPeriodStart !== 'string') board.constructionPeriodStart = '';
  if (typeof board.constructionPeriodEnd !== 'string') board.constructionPeriodEnd = '';
  if (!Array.isArray(board.emergencyContacts)) board.emergencyContacts = DEFAULT_EMERGENCY_CONTACTS.map((c) => ({ ...c }));
  return board;
}

export async function loadBoard(env, id) {
  if (!ID_RE.test(id)) return null;
  const row = await env.DB.prepare('SELECT data FROM boards WHERE id = ?').bind(id).first();
  if (!row) return null;
  try {
    return backfillBoard(JSON.parse(row.data));
  } catch (e) {
    return null;
  }
}

export async function listBoards(env) {
  const { results } = await env.DB.prepare('SELECT data FROM boards ORDER BY created_at DESC').all();
  return (results || []).map((r) => backfillBoard(JSON.parse(r.data)));
}

export async function saveBoard(env, board) {
  await env.DB.prepare(
    `INSERT INTO boards (id, edit_key, created_at, updated_at, data)
     VALUES (?1, ?2, ?3, ?4, ?5)
     ON CONFLICT(id) DO UPDATE SET edit_key = ?2, updated_at = ?4, data = ?5`
  )
    .bind(board.id, board.editKey, board.createdAt, board.updatedAt, JSON.stringify(board))
    .run();
}

export async function deleteBoard(env, id) {
  await env.DB.prepare('DELETE FROM boards WHERE id = ?').bind(id).run();
}

// ---- 認証 ----------------------------------------------------------

export function requireAdmin(request, env) {
  const token = request.headers.get('x-admin-password');
  const expected = env.ADMIN_PASSWORD || 'admin1234';
  if (token !== expected) {
    return Response.json({ error: 'invalid_admin_password' }, { status: 403 });
  }
  return null;
}

export function requireKeyFromRequest(request, board) {
  const url = new URL(request.url);
  const key = url.searchParams.get('key') || request.headers.get('x-edit-key');
  return !!board && typeof key === 'string' && key.length > 0 && key === board.editKey;
}

export function json(data, init) {
  return Response.json(data, init);
}
