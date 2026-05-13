import { requireAdmin, kvStore, json } from '../../_shared/utils.js';

export async function onRequest({ request, env }) {
    const admin = await requireAdmin(request, env);
    if (!admin) return json({ error: 'Unauthorized' }, 401);

    const url    = new URL(request.url);
    const id     = url.searchParams.get('id');
    const store  = kvStore(env.STUDENTS_KV);
    const method = request.method;

    try {
        if (method === 'GET') {
            const keys     = await store.list();
            const students = await Promise.all(keys.map(async ({ key }) => {
                const data = await store.get(key);
                return data ? { id: key, ...data } : null;
            }));
            const valid = students.filter(Boolean);
            valid.sort((a, b) => new Date(b.lastSeen) - new Date(a.lastSeen));
            return json(valid);
        }

        if (method === 'PUT') {
            if (!id) return json({ error: 'id required' }, 400);
            const existing = await store.get(id);
            if (!existing) return json({ error: 'Not found' }, 404);
            const { tier } = await request.json();
            const updated  = { ...existing, tier, tierOverride: true, updatedAt: new Date().toISOString() };
            await store.setJSON(id, updated);
            return json(updated);
        }

        return json({ error: 'Method not allowed' }, 405);
    } catch (err) {
        console.error('api/admin/students error:', err);
        return json({ error: err.message }, 500);
    }
}
