// Unread Semble notifications (https://docs.cosmik.network/semble-api/notifications).
//
//   node semble.mjs [--json]
//
// Needs SEMBLE_API_KEY env var or  the first line of `pass show
// semble/api-key`. It is sent as the `x-api-key` header to
// https://api.semble.so/xrpc (override with SEMBLE_API_URL). It's read-only;
// markRead and markAllRead are never called, so the unread badge on semble.so
// remains.
import { fileURLToPath } from 'url';
import { getJson, hasFlag, paginate, printNotification, query, secret } from './lib.mjs';

const base = () => process.env.SEMBLE_API_URL || 'https://api.semble.so/xrpc';
const PAGE_SIZE = 50;

function apiKey() {
    const key = secret('SEMBLE_API_KEY', 'semble/api-key');
    if (!key) throw new Error('Set SEMBLE_API_KEY or add semble/api-key to pass (key from https://semble.so/settings/api-keys)');
    return key;
}

// One-line description of what the notification is about.
function describe(n) {
    const card = n.card?.cardContent?.title || n.card?.url;
    const colls = (n.collections || []).map((c) => c.name).filter(Boolean).join(', ');
    switch (n.type) {
        case 'USER_FOLLOWED_YOU': return undefined;
        case 'USER_FOLLOWED_YOUR_COLLECTION': return colls || undefined;
        case 'USER_CONNECTED_YOUR_URL': case 'USER_CONNECTED_YOUR_POST': case 'USER_CONNECTED_YOUR_COLLECTION':
        case 'SUBSCRIBED_USER_MADE_CONNECTION': case 'USER_CONNECTED_SUBSCRIBED_COLLECTION': {
            const c = n.connection?.connection;
            return [n.connection?.source?.url, c?.type, n.connection?.target?.url].filter(Boolean).join(' -> ') || undefined;
        }
        default: return [card, colls && `[${colls}]`].filter(Boolean).join(' ') || n.mentionCollection?.name || undefined;
    }
}

// Where to look: the saved URL for card activity, else the other user's Semble profile.
function link(n) {
    if (n.card?.url) return n.card.url;
    return n.user?.handle ? `https://semble.so/profile/${n.user.handle}` : undefined;
}

// Returns { count, items } in the common notification shape; prints nothing.
export async function unread() {
    const headers = { 'x-api-key': apiKey(), 'x-semble-client': 'atproto-notifications' };
    let count = 0;
    const items = await paginate(async (cursor) => {
        const page = cursor ?? 1;
        const r = await getJson(`${base()}/network.cosmik.notification.list?${query({ page, limit: PAGE_SIZE, sortOrder: 'desc', unreadOnly: 'true' })}`,
            { headers, what: 'Semble notification.list' });
        count = r.unreadCount ?? count;
        return { notifications: r.notifications || [], cursor: r.pagination?.hasMore ? page + 1 : undefined };
    }, (r) => r.notifications.filter((n) => !n.read));
    return {
        count,
        items: items.map((n) => ({
            service: 'semble', time: n.createdAt, reason: n.type.toLowerCase().replace(/^user_/, '').replace(/_/g, '-'),
            handle: n.user?.handle, did: n.user?.id, uri: n.card?.uri || n.id, text: describe(n), url: link(n),
        })),
    };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    const { count, items } = await unread();
    console.error(`# ${count} unread (Semble); ${items.length} listed`);
    for (const n of items) printNotification(n, hasFlag('json'));
}
