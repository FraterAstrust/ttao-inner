import { signJWT, cookieHeader, redirect, getAdminIds } from '../../_shared/utils.js';

export async function onRequestGet({ request, env }) {
    const url   = new URL(request.url);
    const code  = url.searchParams.get('code');
    const error = url.searchParams.get('error');

    if (error || !code) return redirect('/admin?error=denied');

    try {
        const tokenRes = await fetch('https://www.patreon.com/api/oauth2/token', {
            method:  'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body:    new URLSearchParams({
                code,
                grant_type:    'authorization_code',
                client_id:     env.PATREON_CLIENT_ID,
                client_secret: env.PATREON_CLIENT_SECRET,
                redirect_uri:  env.PATREON_REDIRECT_URI_ADMIN,
            }),
        });
        const tokenData = await tokenRes.json();
        if (!tokenData.access_token) return redirect('/admin?error=token_failed');

        const identityRes = await fetch(
            'https://www.patreon.com/api/oauth2/v2/identity?fields%5Buser%5D=full_name,email',
            { headers: { Authorization: `Bearer ${tokenData.access_token}` } }
        );
        const identity = await identityRes.json();
        const user     = identity.data;
        if (!user?.id)                        return redirect('/admin?error=identity_failed');
        if (!getAdminIds(env).includes(user.id)) return redirect('/admin?error=unauthorized');

        const token = await signJWT(
            { userId: user.id, email: user.attributes?.email, name: user.attributes?.full_name, role: 'admin' },
            env.JWT_ADMIN_SECRET,
            28800 // 8 hours
        );

        return redirect('/admin', {
            'Set-Cookie': cookieHeader('ttao_admin', token, { maxAge: 28800, secure: true }),
        });
    } catch (err) {
        console.error('Admin callback error:', err);
        return redirect('/admin?error=exception');
    }
}
