import { redirect } from '../_shared/utils.js';

export async function onRequestGet({ env }) {
    const params = new URLSearchParams({
        response_type: 'code',
        client_id:     env.PATREON_CLIENT_ID,
        redirect_uri:  env.PATREON_REDIRECT_URI_ADMIN,
        scope:         'identity identity[email]',
        state:         'admin',
    });
    return redirect(`https://www.patreon.com/oauth2/authorize?${params}`);
}
