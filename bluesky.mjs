// Unread Bluesky notifications
//
//   node bluesky.mjs --actor=you.example [--json]
//
// Login: ATPROTO_IDENTIFIER (default: --actor) and ATPROTO_APP_PASSWORD, or
// the first line of `pass show atproto/app-password`. PDS can be over-ridden
// with ATPROTO_PDS. The session is kept in the state dir (see lib.mjs; 0600,
// plaintext) and reused; disable with --no-session or ATPROTO_NO_SESSION=1.
//
// "Unread" is a `seenAt` timestamp the AppView keeps for your account. This only READS it:
// updateSeen is never called, so the unread badge in Bluesky is unaffected.
import path from 'path';
import { fileURLToPath } from 'url';
import { argValue, hasFlag, getJson, getProfile, paginate, pdsOf, printNotification, query, readState, secret, stateDir,
    writeState, HttpError } from './lib.mjs';

const sessionFile = () => process.env.ATPROTO_SESSION_FILE || path.join(stateDir(), 'session.json');
const sessionsOn = () => !hasFlag('no-session') && process.env.ATPROTO_NO_SESSION !== '1';

async function post(pds, method, body, token) {
    const res = await fetch(`${pds}/xrpc/com.atproto.server.${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) },
        body: body && JSON.stringify(body),
    });
    if (!res.ok) throw new HttpError(method, res.status, await res.text());
    return res.json();
}

// Returns a session { accessJwt, refreshJwt, did, handle } for identifier on pds: the saved one
// (refreshed if need be) or a fresh login.
async function session(pds, identifier) {
    const saved = sessionsOn() ? readState(sessionFile()) : undefined;
    const ok = saved?.pds === pds && [saved.session?.did, saved.session?.handle].includes(identifier);
    let s;
    if (ok) {
        try { s = await post(pds, 'refreshSession', undefined, saved.session.refreshJwt); } catch { /* log in again */ }
    }
    if (!s) {
        const password = secret('ATPROTO_APP_PASSWORD', 'atproto/app-password');
        if (!password) throw new Error('Set ATPROTO_APP_PASSWORD or add atproto/app-password to pass (needed to read your unread notifications)');
        s = await post(pds, 'createSession', { identifier, password });
    }
    if (sessionsOn()) writeState(sessionFile(), { pds, session: s });
    return s;
}

// Returns { count, items } in the common notification shape; prints nothing.
export async function unread({ actor, identifier = process.env.ATPROTO_IDENTIFIER || actor } = {}) {
    if (!identifier) throw new Error('Set --actor=<handle> or ATPROTO_IDENTIFIER');
    const me = (await getProfile(actor || identifier)).did;
    const pds = process.env.ATPROTO_PDS || await pdsOf(me);
    const { accessJwt, did } = await session(pds, identifier);
    if (did !== me) console.error(`# note: logged in as ${did}, not ${me}`);
    // Notification calls go through the PDS, proxied to the Bluesky AppView.
    const headers = { authorization: `Bearer ${accessJwt}`, 'atproto-proxy': 'did:web:api.bsky.app#bsky_appview' };
    const call = (method, params) => getJson(`${pds}/xrpc/app.bsky.notification.${method}?${query(params)}`, { headers, what: `Bluesky ${method}` });
    const { count } = await call('getUnreadCount', {});
    const items = [];
    let done = false;
    // Newest first; stop at the first notification that is already read.
    await paginate(async (cursor) => {
        const data = await call('listNotifications', { limit: 100, cursor });
        for (const n of data.notifications) {
            if (n.isRead) { done = true; break; }
            items.push({ service: 'bluesky', time: n.indexedAt, reason: n.reason, handle: n.author.handle, did: n.author.did,
                uri: n.uri, subject: n.reasonSubject, text: n.record?.text,
                // likes/reposts: link to YOUR post that was liked; everything else: the notifying record
                url: httpsUrl(['like', 'repost'].includes(n.reason) && n.reasonSubject ? n.reasonSubject : n.uri, n.author.handle) });
        }
        return done || items.length >= count + 100 ? { ...data, cursor: undefined } : data;
    }, () => []);
    return { count, items };
}

// at:// URIs only open in atproto tools. Posts map to bsky.app; follows to the follower's profile;
// everything else (Semble, Tangled, ...) to the atproto.at record viewer, which works for any record.
function httpsUrl(uri, who) {
    const m = /^at:\/\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(uri || '');
    if (!m) return undefined;
    const [, repo, collection, rkey] = m;
    if (collection === 'app.bsky.feed.post') return `https://bsky.app/profile/${who || repo}/post/${rkey}`;
    if (collection === 'app.bsky.graph.follow') return `https://bsky.app/profile/${who || repo}`;
    return `https://atproto.at/uri/${uri}`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    const { count, items } = await unread({ actor: argValue('actor') });
    console.error(`# ${count} unread (AppView getUnreadCount); ${items.length} listed`);
    for (const n of items) printNotification(n, hasFlag('json'));
}
