import {
    requireAdmin, kvStore, json,
    normalizeType, slugify,
} from '../../_shared/utils.js';

export async function onRequest({ request, env }) {
    const admin = await requireAdmin(request, env);
    if (!admin) return json({ error: 'Unauthorized' }, 401);

    const url         = new URL(request.url);
    const id          = url.searchParams.get('id');
    const contentType = url.searchParams.get('contentType');
    const store       = kvStore(env.ARTICLES_KV);
    const method      = request.method;

    try {
        if (method === 'GET') {
            if (id) {
                const item = await store.get(id);
                if (!item) return json({ error: 'Not found' }, 404);
                return json(item);
            }
            const keys     = await store.list();
            const all      = await Promise.all(keys.map(async ({ key }) => {
                const data = await store.get(key);
                return data ? { id: key, ...data } : null;
            }));
            const filtered = (contentType
                ? all.filter(a => a && normalizeType(a) === contentType)
                : all
            ).filter(Boolean);
            filtered.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
            return json(filtered);
        }

        if (method === 'POST') {
            const body = await request.json();
            const {
                title, content, tier = 'tyro', published = false,
                contentType: ct = 'articles',
                moduleNumber, bulletinNumber, glyph,
            } = body;
            if (!title || !content) return json({ error: 'title and content required' }, 400);

            const prefix = ct !== 'articles' ? `${ct}-` : '';
            const newId  = prefix + slugify(title) + '-' + Date.now();
            const now    = new Date().toISOString();
            const item   = {
                id: newId, title, content, tier, published, contentType: ct,
                ...(moduleNumber   && { moduleNumber }),
                ...(bulletinNumber && { bulletinNumber }),
                ...(glyph          && { glyph }),
                createdAt: now, updatedAt: now,
            };
            await store.setJSON(newId, item);
            return json(item, 201);
        }

        if (method === 'PUT') {
            if (!id) return json({ error: 'id required' }, 400);
            const existing = await store.get(id);
            if (!existing) return json({ error: 'Not found' }, 404);
            const body    = await request.json();
            const updated = { ...existing, ...body, id, updatedAt: new Date().toISOString() };
            await store.setJSON(id, updated);
            return json(updated);
        }

        if (method === 'DELETE') {
            if (!id) return json({ error: 'id required' }, 400);
            await store.delete(id);
            return json({ deleted: id });
        }

        return json({ error: 'Method not allowed' }, 405);
    } catch (err) {
        console.error('api/admin/articles error:', err);
        return json({ error: err.message }, 500);
    }
}
