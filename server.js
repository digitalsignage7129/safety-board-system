/**
 * 安全掲示板システム — サーバー
 *
 * 現場ごとに「表示用URL」(?id=xxxx)と「編集用URL」(?id=xxxx&key=yyyy)を発行する。
 * - 表示用URL: led-cloud.com等からWebページとして指定し、STB(サイネージ)に表示させる。
 * - 編集用URL: 顧客に渡し、玉掛けロープの点検色・無災害記録・お知らせ等を編集してもらう。
 *
 * データはボードごとに data/boards/<id>.json というJSONファイルに保存する
 * (小規模運用を想定した単純な実装。DBサーバーは不要)。
 */
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, 'data');
const BOARDS_DIR = path.join(DATA_DIR, 'boards');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const SHARED_DIR = path.join(DATA_DIR, 'shared');
fs.mkdirSync(BOARDS_DIR, { recursive: true });
fs.mkdirSync(UPLOADS_DIR, { recursive: true });
fs.mkdirSync(SHARED_DIR, { recursive: true });

// 管理画面(現場の新規作成・一覧・共通コンテンツの差し替え)を守るパスワード。
// 必ず環境変数 ADMIN_PASSWORD で独自の値に変更してください。
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin1234';
if (!process.env.ADMIN_PASSWORD) {
  console.warn(
    '[警告] ADMIN_PASSWORD が設定されていません。既定値 "admin1234" を使用しています。' +
      '本番運用の前に必ず環境変数 ADMIN_PASSWORD を設定してください。'
  );
}

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use('/uploads', express.static(UPLOADS_DIR, { maxAge: '5m' }));
app.use('/shared', express.static(SHARED_DIR, { maxAge: '5m' }));
// extensions: ['html'] により、/board や /admin のような拡張子なしURLでも
// public/board.html・public/admin.html がそのまま表示される
// (Cloudflare Pagesでの配信URLと形をそろえるため)。
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

function requireAdmin(req, res, next) {
  const token = req.headers['x-admin-password'];
  if (token !== ADMIN_PASSWORD) return res.status(403).json({ error: 'invalid_admin_password' });
  next();
}

const upload = multer({ limits: { fileSize: 3 * 1024 * 1024 } });

const DEFAULT_ROPE_COLORS = ['赤', '黄', '緑', '白'];
const ID_RE = /^[a-f0-9]{8}$/;

// 表示レイアウト: サイネージの実寸・ピッチによっては一度に全コンテンツを
// 表示すると文字が小さくなりすぎるため、画面に表示するコンテンツの数を
// 絞り込めるようにする(1つだけ/2分割/4分割/全表示)。
const VALID_LAYOUT_MODES = ['all', 'single', 'split2', 'split4'];
const VALID_BLOCK_KEYS = [
  'goals', 'record', 'rope', 'ropeTable', 'cycle', 'rule333', 'signal', 'notice', 'free', 'emergency',
];
// 緊急時連絡先のひな形(担当者名・電話番号を入力するだけで使えるように、よくある項目を用意しておく)
const DEFAULT_EMERGENCY_CONTACTS = [
  { label: '現場代理人', name: '', phone: '' },
  { label: '電気', name: '', phone: '' },
  { label: '水道', name: '', phone: '' },
  { label: 'ガス', name: '', phone: '' },
  { label: '警察', name: '', phone: '' },
  { label: '消防', name: '', phone: '' },
  { label: '病院', name: '', phone: '' },
];
const BLOCKS_PER_MODE = { all: 0, single: 1, split2: 2, split4: 4 };

// ---- ユーティリティ ---------------------------------------------------

function genId() {
  return crypto.randomBytes(4).toString('hex');
}
function genKey() {
  return crypto.randomBytes(16).toString('hex');
}

function boardFilePath(id) {
  if (!ID_RE.test(id)) return null;
  return path.join(BOARDS_DIR, id + '.json');
}

function loadBoard(id) {
  const p = boardFilePath(id);
  if (!p || !fs.existsSync(p)) return null;
  try {
    const board = JSON.parse(fs.readFileSync(p, 'utf8'));
    // 旧バージョンで作成されたボードに新しいフィールドを補う
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
    if (!['s', 'm', 'l', 'xl'].includes(board.noticeFontSize)) board.noticeFontSize = 'm';
    return board;
  } catch (e) {
    return null;
  }
}

function saveBoard(board) {
  fs.writeFileSync(boardFilePath(board.id), JSON.stringify(board, null, 2));
}

// 日本時間(Asia/Tokyo)での「今日」を取得する
function tokyoToday() {
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
function pad(n, len = 2) {
  return String(n).padStart(len, '0');
}

// 玉掛けロープの点検色(4ヶ月周期)を計算する
function computeDisplay(board) {
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

function requireKey(req, board) {
  const key = req.query.key || req.headers['x-edit-key'] || (req.body && req.body.editKey);
  return !!board && typeof key === 'string' && key.length > 0 && key === board.editKey;
}

// ---- 共通コンテンツ(全現場で流用する画像) -------------------------------
// 「玉掛けワイヤーロープの点検」「安全施工サイクル」「3・3・3運動」は
// 原則すべての現場で同じ内容を使い回す想定のため、管理画面から1回アップ
// ロードすればすべてのボードに反映される。

const SHARED_KEYS = ['rope', 'cycle', 'rule333', 'signal'];

app.get('/api/shared', (req, res) => {
  const status = {};
  for (const key of SHARED_KEYS) {
    status[key] = fs.existsSync(path.join(SHARED_DIR, key + '.jpg'));
  }
  res.json(status);
});

app.post('/api/shared/:key/image', requireAdmin, upload.single('image'), (req, res) => {
  const key = req.params.key;
  if (!SHARED_KEYS.includes(key)) return res.status(400).json({ error: 'invalid_key' });
  if (!req.file) return res.status(400).json({ error: 'no_file' });
  fs.writeFileSync(path.join(SHARED_DIR, key + '.jpg'), req.file.buffer);
  res.json({ ok: true });
});

app.delete('/api/shared/:key/image', requireAdmin, (req, res) => {
  const key = req.params.key;
  if (!SHARED_KEYS.includes(key)) return res.status(400).json({ error: 'invalid_key' });
  const p = path.join(SHARED_DIR, key + '.jpg');
  if (fs.existsSync(p)) fs.unlinkSync(p);
  res.json({ ok: true });
});

// ---- 管理API (現場/ボードの一覧・新規作成) -----------------------------

app.get('/api/boards', requireAdmin, (req, res) => {
  const files = fs.readdirSync(BOARDS_DIR).filter((f) => f.endsWith('.json'));
  const list = files
    .map((f) => JSON.parse(fs.readFileSync(path.join(BOARDS_DIR, f), 'utf8')))
    .map((b) => ({
      id: b.id,
      editKey: b.editKey,
      customerName: b.customerName || '',
      createdAt: b.createdAt,
      updatedAt: b.updatedAt,
      displayInfo: b.displayInfo || '',
      layout: b.layout || { mode: 'all', blocks: [] },
    }))
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  res.json(list);
});

app.post('/api/boards', requireAdmin, (req, res) => {
  const id = genId();
  const editKey = genKey();
  const now = new Date().toISOString();
  const today = tokyoToday();
  const board = {
    id,
    editKey,
    customerName: (req.body && String(req.body.customerName || '').slice(0, 100)) || '',
    createdAt: now,
    updatedAt: now,
    ropeColors: DEFAULT_ROPE_COLORS.slice(),
    ropeCycleStartMonth: today.ym,
    safetyGoals: ['', ''],
    noticeText: '',
    noticeFontSize: 'm',
    freeBlocks: [],
    hasCustomSignalImage: false,
    displayInfo: '',
    layout: { mode: 'all', blocks: [] },
    targetHours: 0,
    currentHours: 0,
    currentHoursAsOfDate: today.ymd,
    constructionPeriodStart: '',
    constructionPeriodEnd: '',
    emergencyContacts: DEFAULT_EMERGENCY_CONTACTS.map((c) => ({ ...c })),
  };
  saveBoard(board);
  res.json({ id, editKey });
});

// 表示レイアウト・現場メモの設定(設置業者側の判断のため管理者パスワードで保護)
app.put('/api/boards/:id/layout', requireAdmin, (req, res) => {
  const board = loadBoard(req.params.id);
  if (!board) return res.status(404).json({ error: 'not_found' });

  if (typeof req.body.displayInfo === 'string') {
    board.displayInfo = req.body.displayInfo.slice(0, 200);
  }
  if (req.body.layout && typeof req.body.layout === 'object') {
    const mode = VALID_LAYOUT_MODES.includes(req.body.layout.mode) ? req.body.layout.mode : 'all';
    let blocks = Array.isArray(req.body.layout.blocks)
      ? req.body.layout.blocks.filter((k) => VALID_BLOCK_KEYS.includes(k))
      : [];
    const need = BLOCKS_PER_MODE[mode];
    blocks = blocks.slice(0, need);
    while (blocks.length < need) blocks.push(VALID_BLOCK_KEYS[blocks.length % VALID_BLOCK_KEYS.length]);
    board.layout = { mode, blocks };
  }
  board.updatedAt = new Date().toISOString();
  saveBoard(board);
  res.json({ ok: true, layout: board.layout, displayInfo: board.displayInfo });
});

app.delete('/api/boards/:id', requireAdmin, (req, res) => {
  const board = loadBoard(req.params.id);
  if (!board) return res.status(404).json({ error: 'not_found' });
  fs.unlinkSync(boardFilePath(board.id));
  const img = path.join(UPLOADS_DIR, board.id + '.jpg');
  if (fs.existsSync(img)) fs.unlinkSync(img);
  res.json({ ok: true });
});

// ---- 現場ボードのAPI ----------------------------------------------------

app.get('/api/boards/:id', (req, res) => {
  const board = loadBoard(req.params.id);
  if (!board) return res.status(404).json({ error: 'not_found' });
  const { editKey, ...pub } = board;
  res.json({ ...pub, computed: computeDisplay(board) });
});

const EDITABLE_FIELDS = [
  'customerName',
  'ropeColors',
  'ropeCycleStartMonth',
  'safetyGoals',
  'noticeText',
  'noticeFontSize',
  'freeBlocks',
  'targetHours',
  'currentHours',
  'currentHoursAsOfDate',
  'constructionPeriodStart',
  'constructionPeriodEnd',
  'emergencyContacts',
];

app.put('/api/boards/:id', (req, res) => {
  const board = loadBoard(req.params.id);
  if (!board) return res.status(404).json({ error: 'not_found' });
  if (!requireKey(req, board)) return res.status(403).json({ error: 'invalid_key' });

  for (const key of EDITABLE_FIELDS) {
    if (key in req.body) board[key] = req.body[key];
  }
  if (Array.isArray(board.ropeColors)) board.ropeColors = board.ropeColors.slice(0, 4);
  if (Array.isArray(board.safetyGoals)) board.safetyGoals = board.safetyGoals.slice(0, 4);
  if (Array.isArray(board.freeBlocks)) board.freeBlocks = board.freeBlocks.slice(0, 12);
  if (Array.isArray(board.emergencyContacts)) board.emergencyContacts = board.emergencyContacts.slice(0, 12);
  board.targetHours = Math.max(0, Number(board.targetHours) || 0);
  board.currentHours = Math.max(0, Number(board.currentHours) || 0);
  board.updatedAt = new Date().toISOString();
  saveBoard(board);
  res.json({ ok: true, computed: computeDisplay(board) });
});

app.post('/api/boards/:id/image', upload.single('image'), (req, res) => {
  const board = loadBoard(req.params.id);
  if (!board) return res.status(404).json({ error: 'not_found' });
  if (!requireKey(req, board)) return res.status(403).json({ error: 'invalid_key' });
  if (!req.file) return res.status(400).json({ error: 'no_file' });
  fs.writeFileSync(path.join(UPLOADS_DIR, board.id + '.jpg'), req.file.buffer);
  board.hasCustomSignalImage = true;
  board.updatedAt = new Date().toISOString();
  saveBoard(board);
  res.json({ ok: true });
});

app.delete('/api/boards/:id/image', (req, res) => {
  const board = loadBoard(req.params.id);
  if (!board) return res.status(404).json({ error: 'not_found' });
  if (!requireKey(req, board)) return res.status(403).json({ error: 'invalid_key' });
  const img = path.join(UPLOADS_DIR, board.id + '.jpg');
  if (fs.existsSync(img)) fs.unlinkSync(img);
  board.hasCustomSignalImage = false;
  board.updatedAt = new Date().toISOString();
  saveBoard(board);
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`安全掲示板システム: http://localhost:${PORT}/admin.html`);
});
