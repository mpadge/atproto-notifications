// Offline tests against local mock servers: `node --test` in this directory.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { printNotification } from './lib.mjs';
import { unread as sembleUnread } from './semble.mjs';
import { unread as blueskyUnread } from './bluesky.mjs';

function serve(handler) {
    return new Promise((resolve) => {
        const server = http.createServer(handler).listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` }));
    });
}
const json = (res, body, status = 200) => { res.statusCode = status; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(body)); };
const withEnv = async (env, fn) => {
    const old = {};
    for (const k of Object.keys(env)) { old[k] = process.env[k]; if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k]; }
    try { return await fn(); } finally { for (const k of Object.keys(old)) { if (old[k] === undefined) delete process.env[k]; else process.env[k] = old[k]; } }
};

test('printNotification prints text or JSON', () => {
    const n = { service: 'x', time: 't', reason: 'like', handle: 'h', text: 'a\n b', url: 'https://u' };
    const out = [];
    const orig = console.log; console.log = (s) => out.push(s);
    try { printNotification(n, false); printNotification(n, true); } finally { console.log = orig; }
    assert.match(out[0], /^t {2}like {6}h\n {4}a b\n {4}https:\/\/u$/);
    assert.deepEqual(JSON.parse(out[1]), n);
});

test('semble unread: pages through results, sends the key, skips read items, maps fields', async () => {
    const seen = [];
    const user = { id: 'did:plc:u', name: 'U', handle: 'u.test' };
    const { server, url } = await serve((req, res) => {
        const u = new URL(req.url, 'http://h');
        seen.push({ path: u.pathname, page: u.searchParams.get('page'), unreadOnly: u.searchParams.get('unreadOnly'), key: req.headers['x-api-key'] });
        const page = Number(u.searchParams.get('page'));
        const notifications = page === 1
            ? [{ id: 'n1', user, createdAt: '2026-11-17T00:00:01Z', type: 'USER_ADDED_YOUR_CARD', read: false,
                card: { url: 'https://example.com/a.html', uri: 'at://c/card/1', cardContent: { url: 'u', title: 'A post' } }, collections: [{ name: 'Reading' }] },
                { id: 'n0', user, createdAt: '2026-11-16T00:00:00Z', type: 'USER_FOLLOWED_YOU', read: true }]
            : [{ id: 'n2', user, createdAt: '2026-11-17T00:00:02Z', type: 'USER_FOLLOWED_YOU', read: false }];
        json(res, { notifications, pagination: { hasMore: page < 2 }, unreadCount: 2 });
    });
    try {
        const r = await withEnv({ SEMBLE_API_URL: url, SEMBLE_API_KEY: 'secret' }, () => sembleUnread());
        assert.equal(r.count, 2);
        assert.deepEqual(seen.map((s) => s.page), ['1', '2']);
        assert.ok(seen.every((s) => s.key === 'secret' && s.unreadOnly === 'true' && s.path === '/network.cosmik.notification.list'));
        assert.deepEqual(r.items.map((i) => [i.service, i.reason, i.handle, i.url]), [
            ['semble', 'added-your-card', 'u.test', 'https://example.com/a.html'],
            ['semble', 'followed-you', 'u.test', 'https://semble.so/profile/u.test'],
        ]);
        assert.equal(r.items[0].text, 'A post [Reading]');
    } finally { server.close(); }
});

test('semble unread: missing key and HTTP errors are reported', async () => {
    await assert.rejects(withEnv({ SEMBLE_API_KEY: undefined, PATH: '/nonexistent' }, () => sembleUnread()), /SEMBLE_API_KEY/);
    const { server, url } = await serve((req, res) => json(res, { error: 'no' }, 401));
    try {
        await assert.rejects(withEnv({ SEMBLE_API_URL: url, SEMBLE_API_KEY: 'bad' }, () => sembleUnread()), /401/);
    } finally { server.close(); }
});

test('bluesky unread: logs in, saves a 0600 session, reuses it, stops at the first read item', async () => {
    const calls = [];
    const session = { accessJwt: 'acc', refreshJwt: 'ref', handle: 'me.test', did: 'did:plc:me' };
    const appview = await serve((req, res) => json(res, { did: 'did:plc:me', handle: 'me.test' }));
    const pds = await serve((req, res) => {
        const u = new URL(req.url, 'http://h');
        calls.push(u.pathname.split('.').pop());
        if (u.pathname.endsWith('createSession') || u.pathname.endsWith('refreshSession')) return json(res, session);
        assert.equal(req.headers.authorization, 'Bearer acc');
        assert.equal(req.headers['atproto-proxy'], 'did:web:api.bsky.app#bsky_appview');
        if (u.pathname.endsWith('getUnreadCount')) return json(res, { count: 2 });
        const author = { did: 'did:plc:a', handle: 'a.test' };
        json(res, { notifications: [
            { reason: 'like', reasonSubject: 'at://did:plc:me/app.bsky.feed.post/p1', uri: 'at://did:plc:a/app.bsky.feed.like/l1', author, indexedAt: 't2', isRead: false, record: {} },
            { reason: 'reply', uri: 'at://did:plc:a/app.bsky.feed.post/r1', author, indexedAt: 't1', isRead: false, record: { text: 'hi' } },
            { reason: 'follow', uri: 'at://did:plc:a/app.bsky.graph.follow/f1', author, indexedAt: 't0', isRead: true, record: {} },
        ] });
    });
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'notif-')), 'state', 'session.json');
    const env = { ATPROTO_APPVIEW_URL: appview.url, ATPROTO_PDS: pds.url, ATPROTO_SESSION_FILE: file, ATPROTO_NO_SESSION: undefined, ATPROTO_IDENTIFIER: undefined };
    try {
        const r = await withEnv({ ...env, ATPROTO_APP_PASSWORD: 'pw' }, () => blueskyUnread({ actor: 'me.test' }));
        assert.equal(r.count, 2);
        assert.deepEqual(r.items.map((i) => [i.reason, i.handle, i.url]), [
            ['like', 'a.test', 'https://bsky.app/profile/a.test/post/p1'],
            ['reply', 'a.test', 'https://bsky.app/profile/a.test/post/r1'],
        ]);
        assert.equal(fs.statSync(file).mode & 0o777, 0o600);

        // No password available: only the saved session (refreshed) can work.
        calls.length = 0;
        await withEnv({ ...env, ATPROTO_APP_PASSWORD: undefined, PATH: '/nonexistent' }, () => blueskyUnread({ actor: 'me.test' }));
        assert.ok(calls.includes('refreshSession') && !calls.includes('createSession'), `unexpected login: ${calls}`);

        // Without --actor or ATPROTO_IDENTIFIER there is nobody to log in as.
        await assert.rejects(withEnv(env, () => blueskyUnread({})), /--actor/);
    } finally { pds.server.close(); appview.server.close(); }
});
