// GET /uploads/xxxxxxxx.jpg … 現場ごとにアップロードされた合図法画像をR2から配信する
export async function onRequestGet({ params, env, request }) {
  const path = Array.isArray(params.path) ? params.path.join('/') : params.path;
  const obj = await env.BOARD_BUCKET.get(`uploads/${path}`);
  if (!obj) return new Response('Not Found', { status: 404 });

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('etag', obj.httpEtag);
  headers.set('Cache-Control', 'public, max-age=300');

  const ifNoneMatch = request.headers.get('if-none-match');
  if (ifNoneMatch && ifNoneMatch === obj.httpEtag) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(obj.body, { headers });
}
