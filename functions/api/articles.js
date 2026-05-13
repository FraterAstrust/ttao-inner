import {
    requireSession, kvStore, json,
    TIER_RANK, normalizeType, extractExcerpt,
} from '../_shared/utils.js';

export async function onRequestGet({ request, env }) {
    const session = await requireSession(request, env);
    if (!session) return json({ error: 'Unauthorized' }, 401);

    const url         = new URL(request.url);
    const id          = url.searchParams.get('id');
    const contentType = url.searchParams.get('contentType') || 'articles';
    const userRank    = TIER_RANK[session.tier] ?? 0;
    const store       = kvStore(env.ARTICLES_KV);

    try {
        // Single item — full content for client-side gate rendering
        if (id) {
            const item = await store.get(id);
            if (!item?.published)                        return json({ error: 'Not found' }, 404);
            if ((TIER_RANK[item.tier] ?? 0) > userRank) return json({ error: 'Forbidden' }, 403);
            return json(item);
        }

        // List — metadata + excerpt only, filtered by tier and content type
        const keys = await store.list();
        const all  = await Promise.all(keys.map(async ({ key }) => {
            const data = await store.get(key);
            return data ? { id: key, ...data } : null;
        }));

        const visible = all
            .filter(a =>
                a &&
                a.published &&
                normalizeType(a) === contentType &&
                (TIER_RANK[a.tier] ?? 0) <= userRank
            )
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
            .map(({ content, ...meta }) => ({ ...meta, excerpt: extractExcerpt(content) }));

        return json(visible);
    } catch (err) {
        console.error('api/articles error:', err);
        return json({ error: err.message }, 500);
    }
}
