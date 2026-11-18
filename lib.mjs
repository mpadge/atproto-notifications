import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';

export const APPVIEW = () => process.env.ATPROTO_APPVIEW_URL || 'https://public.api.bsky.app';
const PLC = () => process.env.ATPROTO_PLC_URL || 'https://plc.directory';

export const argValue = (name) => process.argv.find((x) => x.startsWith(`--${name}=`))?.slice(name.length + 3);
export const hasFlag = (name) => process.argv.includes(`--${name}`);

// One notification: { service, time, reason, handle, did, uri, subject, text, url }.
export function printNotification(n, asJson) {
    if (asJson) console.log(JSON.stringify(n));
        else console.log(`${n.time}  ${n.reason.padEnd(9)} ${n.handle}${n.text ? `\n    ${n.text.replace(/\s+/g, ' ')}` : ''}${n.url ? `\n    ${n.url}` : ''}`);
}

// Follow a cursor until exhausted. fetchPage(cursor) returns a page; getItems picks its array.
export async function paginate(fetchPage, getItems) {
    const out = [];
    let cursor;
    do {
        const page = await fetchPage(cursor);
        out.push(...getItems(page));
        cursor = page.cursor;
    } while (cursor);
    return out;
}

export class HttpError extends Error {
    constructor(what, status, body) {
        super(`${what}: ${status} ${String(body).slice(0, 200)}`);
        this.status = status;
        this.body = body;
    }
}

export async function getJson(url, { headers, what = url } = {}) {
    const res = await fetch(url, { headers });
    if (!res.ok) throw new HttpError(what, res.status, await res.text());
    return res.json();
}

export const query = (params) => new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)]));

// A secret from an environment variable, else the first line of `pass show <passName>` (optional).
export function secret(envName, passName) {
    if (process.env[envName]) return process.env[envName];
    try {
        return execFileSync('pass', ['show', passName], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\n')[0].trim() || undefined;
    } catch { return undefined; }
}

// Where to keep small state files (session, Tangled seen-list): $ATPROTO_NOTIFICATIONS_STATE_DIR,
// else $XDG_STATE_HOME/atproto-notifications, else ~/.local/state/atproto-notifications.
export const stateDir = () => process.env.ATPROTO_NOTIFICATIONS_STATE_DIR
    || path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state'), 'atproto-notifications');

export function writeState(file, data) {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
    fs.chmodSync(tmp, 0o600);
    fs.renameSync(tmp, file);
}
export const readState = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return undefined; } };

// --- identity ---------------------------------------------------------------------------------------
// DID document via plc.directory (did:plc) or the well-known file (did:web); cached.
const docs = new Map();

export async function didDoc(did) {
    if (!docs.has(did)) {
        let url;
        if (did.startsWith('did:plc:')) url = `${PLC()}/${did}`;
            else if (did.startsWith('did:web:')) url = `https://${decodeURIComponent(did.slice(8))}/.well-known/did.json`;
                else throw new Error(`Unsupported DID: ${did}`);
        docs.set(did, await getJson(url, { what: `resolving ${did}` }));
    }
    return docs.get(did);
}

export async function pdsOf(did) {
    const svc = (await didDoc(did)).service?.find((s) => s.id === '#atproto_pds' || s.type === 'AtprotoPersonalDataServer');
    if (!svc) throw new Error(`No PDS in the DID document of ${did}`);
    return svc.serviceEndpoint;
}

const handles = new Map();
export async function handleOf(did) {
    if (!handles.has(did)) {
        let h = did;
        try { h = (await didDoc(did)).alsoKnownAs?.find((a) => a.startsWith('at://'))?.slice(5) || did; } catch { /* leave as DID */ }
        handles.set(did, h);
    }
    return handles.get(did);
}

export const getProfile = (actor) =>
    getJson(`${APPVIEW()}/xrpc/app.bsky.actor.getProfile?${query({ actor })}`, { what: `profile of ${actor}` });
