import { requireAdmin, kvStore, json } from '../../_shared/utils.js';

export async function onRequest({ request, env }) {
    const admin = await requireAdmin(request, env);
    if (!admin) return json({ error: 'Unauthorized' }, 401);

    const store  = kvStore(env.ARTICLES_KV);
    const method = request.method;

    try {
        if (method === 'GET') {
            const keys    = await store.list();
            const content = await Promise.all(keys.map(async ({ key }) => {
                const data = await store.get(key);
                return data ? { id: key, ...data } : null;
            }));
            const valid = content.filter(Boolean);
            valid.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

            const date = new Date().toISOString().split('T')[0];
            return new Response(JSON.stringify({
                exportedAt: new Date().toISOString(),
                exportedBy: admin.email || admin.userId,
                version:    '1.0',
                itemCount:  valid.length,
                content:    valid,
            }, null, 2), {
                headers: {
                    'Content-Type':        'application/json',
                    'Content-Disposition': `attachment; filename="ttao-backup-${date}.json"`,
                },
            });
        }

        if (method === 'POST') {
            const { content, mode = 'merge' } = await request.json();
            if (!Array.isArray(content)) {
                return json({ error: 'Invalid backup format. Expected { content: [...] }' }, 400);
            }

            if (mode === 'replace') {
                const keys = await store.list();
                await Promise.all(keys.map(({ key }) => store.delete(key)));
            }

            let imported = 0;
            const errors = [];
            for (const item of content) {
                try {
                    const { id, ...data } = item;
                    if (!id) { errors.push('Item missing id — skipped'); continue; }
                    await store.setJSON(id, { ...data, updatedAt: new Date().toISOString() });
                    imported++;
                } catch (err) {
                    errors.push(`${item.id || 'unknown'}: ${err.message}`);
                }
            }
            return json({ imported, errors, mode });
        }

        return json({ error: 'Method not allowed' }, 405);
    } catch (err) {
        console.error('api/admin/export error:', err);
        return json({ error: err.message }, 500);
    }
}
