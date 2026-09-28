// GET /api/health … 稼働確認用(cron-job.orgなど外部監視サービスから定期的にアクセスする想定)
export async function onRequestGet({ env }) {
  try {
    await env.DB.prepare('SELECT 1').first();
    return Response.json({ ok: true, time: new Date().toISOString() });
  } catch (e) {
    return Response.json({ ok: false, error: String((e && e.message) || e) }, { status: 500 });
  }
}
