import { signJWT, cookieHeader, redirect, getTier, kvStore } from '../../_shared/utils.js';

export async function onRequestGet({ request, env }) {
    const url   = new URL(request.url);
    const code  = url.searchParams.get('code');
    const error = url.searchParams.get('error');

    if (error || !code) return redirect('/?auth=denied');

    try {
        // Exchange code for access token
        const tokenRes = await fetch('https://www.patreon.com/api/oauth2/token', {
            method:  'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body:    new URLSearchParams({
                code,
                grant_type:    'authorization_code',
                client_id:     env.PATREON_CLIENT_ID,
                client_secret: env.PATREON_CLIENT_SECRET,
                redirect_uri:  env.PATREON_REDIRECT_URI,
            }),
        });
        const tokenData = await tokenRes.json();
        if (!tokenData.access_token) return redirect('/?auth=failed');

        // Fetch identity + memberships
        const identityRes = await fetch(
            'https://www.patreon.com/api/oauth2/v2/identity' +
            '?fields%5Buser%5D=full_name,email' +
            '&include=memberships' +
            '&fields%5Bmember%5D=currently_entitled_amount_cents,patron_status',
            { headers: { Authorization: `Bearer ${tokenData.access_token}` } }
        );
        const identity = await identityRes.json();
        const user     = identity.data;
        if (!user?.id) return redirect('/?auth=identity_failed');

        const active = (identity.included || []).find(
            m => m.type === 'member' && m.attributes.patron_status === 'active_patron'
        );
        const amountCents = active?.attributes.currently_entitled_amount_cents || 0;
        const tier        = getTier(amountCents, user.id, env);

        // Upsert student record
        try {
            const store    = kvStore(env.STUDENTS_KV);
            const existing = await store.get(user.id);
            await store.setJSON(user.id, {
                userId:       user.id,
                email:        user.attributes?.email,
                name:         user.attributes?.full_name,
                tier,
                tierOverride: existing?.tierOverride || false,
                firstSeen:    existing?.firstSeen || new Date().toISOString(),
                lastSeen:     new Date().toISOString(),
            });
        } catch (e) { console.error('Student upsert:', e); }

        // Sign session JWT
        const token = await signJWT(
            { userId: user.id, email: user.attributes?.email, name: user.attributes?.full_name, tier },
            env.JWT_SECRET,
            604800 // 7 days
        );

        return redirect('/dashboard', {
            'Set-Cookie': cookieHeader('ttao_session', token, { maxAge: 604800, secure: true }),
        });
    } catch (err) {
        console.error('Patreon callback error:', err);
        return redirect('/?auth=error');
    }
}
