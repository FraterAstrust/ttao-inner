/**
 * functions/_shared/utils.js
 * Shared utilities for all Cloudflare Pages Functions.
 * Uses Web Crypto API — no external dependencies required.
 */

// ── TEXT CODECS ───────────────────────────────────────────────────────────────
const enc = new TextEncoder();
const dec = new TextDecoder();

// ── BASE64URL ─────────────────────────────────────────────────────────────────
function b64url(data) {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    let str = '';
    bytes.forEach(b => (str += String.fromCharCode(b)));
    return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function fromB64url(str) {
    const padded = str.replace(/-/g, '+').replace(/_/g, '/');
    const b64    = padded + '='.repeat((4 - (padded.length % 4)) % 4);
    return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}

// ── JWT (HMAC-SHA256) ─────────────────────────────────────────────────────────
async function hmacKey(secret, usage) {
    return crypto.subtle.importKey(
        'raw', enc.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false, usage
    );
}

export async function signJWT(payload, secret, expiresInSec = 604800) {
    const header = b64url(enc.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
    const claims = b64url(enc.encode(JSON.stringify({
        ...payload,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + expiresInSec,
    })));
    const input = `${header}.${claims}`;
    const key   = await hmacKey(secret, ['sign']);
    const sig   = await crypto.subtle.sign('HMAC', key, enc.encode(input));
    return `${input}.${b64url(sig)}`;
}

export async function verifyJWT(token, secret) {
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error('Malformed token');
    const input = `${parts[0]}.${parts[1]}`;
    const key   = await hmacKey(secret, ['verify']);
    const valid = await crypto.subtle.verify('HMAC', key, fromB64url(parts[2]), enc.encode(input));
    if (!valid) throw new Error('Invalid signature');
    const payload = JSON.parse(dec.decode(fromB64url(parts[1])));
    if (payload.exp < Math.floor(Date.now() / 1000)) throw new Error('Token expired');
    return payload;
}

// ── COOKIES ───────────────────────────────────────────────────────────────────
export function parseCookies(request) {
    const cookies = {};
    (request.headers.get('Cookie') || '').split(';').forEach(part => {
        const [k, ...v] = part.trim().split('=');
        if (k) cookies[k.trim()] = v.join('=').trim();
    });
    return cookies;
}

/**
 * Build a Set-Cookie header value.
 * Note: do NOT pass httpOnly for session/admin tokens —
 * the frontend JS needs to read them to extract user info.
 */
export function cookieHeader(name, value, { maxAge, secure, httpOnly, sameSite = 'Lax', path = '/' } = {}) {
    const parts = [`${name}=${value}`, `Path=${path}`, `SameSite=${sameSite}`];
    if (maxAge   !== undefined) parts.push(`Max-Age=${maxAge}`);
    if (secure)   parts.push('Secure');
    if (httpOnly) parts.push('HttpOnly');
    return parts.join('; ');
}

// ── RESPONSE HELPERS ──────────────────────────────────────────────────────────
export function json(data, status = 200, extraHeaders = {}) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json', ...extraHeaders },
    });
}

export function redirect(url, extraHeaders = {}) {
    return new Response(null, {
        status: 302,
        headers: { Location: url, ...extraHeaders },
    });
}

// ── TIER LOGIC ────────────────────────────────────────────────────────────────
export const TIER_RANK = { tyro: 0, initiate: 1, adept: 2, patron: 2 };

export function getAdminIds(env) {
    return (env.PATREON_ADMIN_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
}

export function getTier(amountCents, userId, env) {
    if (getAdminIds(env).includes(userId)) return 'adept';
    if (amountCents >= 3300) return 'patron';
    if (amountCents >= 1500) return 'adept';
    if (amountCents >= 500)  return 'initiate';
    return 'tyro';
}

// ── AUTH GUARDS ───────────────────────────────────────────────────────────────
export async function requireSession(request, env) {
    const token = parseCookies(request).ttao_session;
    if (!token) return null;
    try { return await verifyJWT(token, env.JWT_SECRET); }
    catch { return null; }
}

export async function requireAdmin(request, env) {
    const token = parseCookies(request).ttao_admin;
    if (!token) return null;
    try {
        const payload = await verifyJWT(token, env.JWT_ADMIN_SECRET);
        return payload.role === 'admin' ? payload : null;
    } catch { return null; }
}

// ── CONTENT HELPERS ───────────────────────────────────────────────────────────
export function slugify(str) {
    return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

export function normalizeType(item) {
    return item.contentType || 'articles';
}

export function extractExcerpt(content, maxLen = 180) {
    return content
        .replace(/^\[gate:[^\]]+\]\s*/gm, '')
        .replace(/^#{1,6}\s+/gm, '')
        .replace(/[*_`~]/g, '')
        .replace(/\n+/g, ' ')
        .trim()
        .slice(0, maxLen)
        .replace(/\s\S*$/, '…');
}

// ── KV STORE WRAPPER ──────────────────────────────────────────────────────────
// Wraps Cloudflare KV to match the interface used throughout the codebase.
export function kvStore(kv) {
    return {
        async get(key) {
            return kv.get(key, { type: 'json' }); // null if not found
        },
        async setJSON(key, value) {
            await kv.put(key, JSON.stringify(value));
        },
        async delete(key) {
            await kv.delete(key);
        },
        async list(prefix = '') {
            const result = await kv.list(prefix ? { prefix } : undefined);
            return result.keys.map(k => ({ key: k.name }));
        },
    };
}
