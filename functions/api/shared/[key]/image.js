// POST   /api/shared/:key/image … 共通コンテンツ画像のアップロード(管理画面用・要管理者パスワード)
// DELETE /api/shared/:key/image … 共通コンテンツ画像の削除(管理画面用・要管理者パスワード)
import { requireAdmin, SHARED_KEYS, json } from '../../../_lib/db.js';

const MAX_FILE_SIZE = 3 * 1024 * 1024; // 3MB

export async function onRequestPost({ request, env, params }) {
  const authErr = requireAdmin(request, env);
  if (authErr) return authErr;
  const key = params.key;
  if (!SHARED_KEYS.includes(key)) return json({ error: 'invalid_key' }, { status: 400 });

  const form = await request.formData().catch(() => null);
  const file = form && form.get('image');
  if (!file || typeof file === 'string') return json({ error: 'no_file' }, { status: 400 });
  if (file.size > MAX_FILE_SIZE) return json({ error: 'file_too_large' }, { status: 400 });

  await env.BOARD_BUCKET.put(`shared/${key}.jpg`, file.stream(), {
    httpMetadata: { contentType: file.type || 'image/jpeg' },
  });
  return json({ ok: true });
}

export async function onRequestDelete({ request, env, params }) {
  const authErr = requireAdmin(request, env);
  if (authErr) return authErr;
  const key = params.key;
  if (!SHARED_KEYS.includes(key)) return json({ error: 'invalid_key' }, { status: 400 });

  await env.BOARD_BUCKET.delete(`shared/${key}.jpg`);
  return json({ ok: true });
}
