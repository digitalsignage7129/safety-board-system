// GET /api/shared … 共通コンテンツ(点検表・安全施工サイクル・3-3-3運動・合図法既定画像)の設定状況
import { SHARED_KEYS, json } from '../../_lib/db.js';

export async function onRequestGet({ env }) {
  const status = {};
  for (const key of SHARED_KEYS) {
    const obj = await env.BOARD_BUCKET.head(`shared/${key}.jpg`);
    status[key] = !!obj;
  }
  return json(status);
}
