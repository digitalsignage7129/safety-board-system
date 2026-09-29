// GET  /api/boards   … 現場一覧(管理画面用・要管理者パスワード)
// POST /api/boards   … 現場の新規作成(管理画面用・要管理者パスワード)
import {
  requireAdmin, genId, genKey, saveBoard, listBoards,
  DEFAULT_ROPE_COLORS, DEFAULT_EMERGENCY_CONTACTS, tokyoToday, json,
} from '../../_lib/db.js';

export async function onRequestGet({ request, env }) {
  const authErr = requireAdmin(request, env);
  if (authErr) return authErr;

  const boards = await listBoards(env);
  const list = boards
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
  return json(list);
}

export async function onRequestPost({ request, env }) {
  const authErr = requireAdmin(request, env);
  if (authErr) return authErr;

  const body = await request.json().catch(() => ({}));
  const id = genId();
  const editKey = genKey();
  const now = new Date().toISOString();
  const today = tokyoToday();
  const board = {
    id,
    editKey,
    customerName: String((body && body.customerName) || '').slice(0, 100),
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
  await saveBoard(env, board);
  return json({ id, editKey });
}
