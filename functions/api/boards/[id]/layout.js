// PUT /api/boards/:id/layout … 表示レイアウト・現場メモの設定(管理画面用・要管理者パスワード)
import {
  loadBoard, saveBoard, requireAdmin,
  VALID_LAYOUT_MODES, VALID_BLOCK_KEYS, BLOCKS_PER_MODE, json,
} from '../../../_lib/db.js';

export async function onRequestPut({ request, env, params }) {
  const authErr = requireAdmin(request, env);
  if (authErr) return authErr;

  const board = await loadBoard(env, params.id);
  if (!board) return json({ error: 'not_found' }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  if (typeof body.displayInfo === 'string') {
    board.displayInfo = body.displayInfo.slice(0, 200);
  }
  if (body.layout && typeof body.layout === 'object') {
    const mode = VALID_LAYOUT_MODES.includes(body.layout.mode) ? body.layout.mode : 'all';
    let blocks = Array.isArray(body.layout.blocks)
      ? body.layout.blocks.filter((k) => VALID_BLOCK_KEYS.includes(k))
      : [];
    const need = BLOCKS_PER_MODE[mode];
    blocks = blocks.slice(0, need);
    while (blocks.length < need) blocks.push(VALID_BLOCK_KEYS[blocks.length % VALID_BLOCK_KEYS.length]);
    board.layout = { mode, blocks };
  }
  board.updatedAt = new Date().toISOString();
  await saveBoard(env, board);
  return json({ ok: true, layout: board.layout, displayInfo: board.displayInfo });
}
