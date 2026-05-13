import { redirect } from '../_shared/utils.js';

export async function onRequestGet({ env }) {
    const params = new URLSearchParams({
        response_type: 'code',
        client_id:     env.PATREON_CLIENT_ID,
        redirect_uri:  env.PATREON_REDIRECT_URI,
        scope:         'identity identity[email] identity.memberships',
    });
    return redirect(`https://www.patreon.com/oauth2/authorize?${params}`);
}
