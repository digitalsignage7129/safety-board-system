// GET    /api/boards/:id   … 表示用(誰でも閲覧可)
// PUT    /api/boards/:id   … 編集(要編集キー)
// DELETE /api/boards/:id   … 削除(管理画面用・要管理者パスワード)
import {
  loadBoard, saveBoard, deleteBoard, computeDisplay,
  requireKeyFromRequest, requireAdmin, EDITABLE_FIELDS, json,
} from '../../../_lib/db.js';

export async function onRequestGet({ params, env }) {
  const board = await loadBoard(env, params.id);
  if (!board) return json({ error: 'not_found' }, { status: 404 });
  const { editKey, ...pub } = board;
  return json({ ...pub, computed: computeDisplay(board) });
}

export async function onRequestPut({ request, env, params }) {
  const board = await loadBoard(env, params.id);
  if (!board) return json({ error: 'not_found' }, { status: 404 });
  if (!requireKeyFromRequest(request, board)) return json({ error: 'invalid_key' }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  for (const key of EDITABLE_FIELDS) {
    if (key in body) board[key] = body[key];
  }
  if (Array.isArray(board.ropeColors)) board.ropeColors = board.ropeColors.slice(0, 4);
  if (Array.isArray(board.safetyGoals)) board.safetyGoals = board.safetyGoals.slice(0, 4);
  if (Array.isArray(board.freeBlocks)) board.freeBlocks = board.freeBlocks.slice(0, 12);
  if (Array.isArray(board.emergencyContacts)) board.emergencyContacts = board.emergencyContacts.slice(0, 12);
  board.targetHours = Math.max(0, Number(board.targetHours) || 0);
  board.currentHours = Math.max(0, Number(board.currentHours) || 0);
  board.updatedAt = new Date().toISOString();
  await saveBoard(env, board);
  return json({ ok: true, computed: computeDisplay(board) });
}

export async function onRequestDelete({ request, env, params }) {
  const authErr = requireAdmin(request, env);
  if (authErr) return authErr;
  const board = await loadBoard(env, params.id);
  if (!board) return json({ error: 'not_found' }, { status: 404 });
  await deleteBoard(env, board.id);
  await env.BOARD_BUCKET.delete(`uploads/${board.id}.jpg`).catch(() => {});
  return json({ ok: true });
}
