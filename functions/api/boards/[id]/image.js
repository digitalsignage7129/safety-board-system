// POST   /api/boards/:id/image … 合図法画像のアップロード(現場ごと・要編集キー)
// DELETE /api/boards/:id/image … アップロード画像を削除し既定表示に戻す(要編集キー)
import { loadBoard, saveBoard, requireKeyFromRequest, json } from '../../../_lib/db.js';

const MAX_FILE_SIZE = 3 * 1024 * 1024; // 3MB (元のmulter設定と同じ上限)

export async function onRequestPost({ request, env, params }) {
  const board = await loadBoard(env, params.id);
  if (!board) return json({ error: 'not_found' }, { status: 404 });
  if (!requireKeyFromRequest(request, board)) return json({ error: 'invalid_key' }, { status: 403 });

  const form = await request.formData().catch(() => null);
  const file = form && form.get('image');
  if (!file || typeof file === 'string') return json({ error: 'no_file' }, { status: 400 });
  if (file.size > MAX_FILE_SIZE) return json({ error: 'file_too_large' }, { status: 400 });

  await env.BOARD_BUCKET.put(`uploads/${board.id}.jpg`, file.stream(), {
    httpMetadata: { contentType: file.type || 'image/jpeg' },
  });
  board.hasCustomSignalImage = true;
  board.updatedAt = new Date().toISOString();
  await saveBoard(env, board);
  return json({ ok: true });
}

export async function onRequestDelete({ request, env, params }) {
  const board = await loadBoard(env, params.id);
  if (!board) return json({ error: 'not_found' }, { status: 404 });
  if (!requireKeyFromRequest(request, board)) return json({ error: 'invalid_key' }, { status: 403 });

  await env.BOARD_BUCKET.delete(`uploads/${board.id}.jpg`);
  board.hasCustomSignalImage = false;
  board.updatedAt = new Date().toISOString();
  await saveBoard(env, board);
  return json({ ok: true });
}
