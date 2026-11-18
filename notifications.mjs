#!/usr/bin/env node
// Unread notifications from Bluesky, Semble and Tangled, in one list. Read-only.
//
//   node notifications.mjs --actor=you.example [--json] [--only=bluesky|semble|tangled]
//                          [--since=7d] [--mark-seen] [--no-session]
//
// --actor        your handle or DID (default: $ATPROTO_IDENTIFIER, else DEFAULT_ACTOR in this file)
// --json         one JSON object per line, with a `service` field instead of text
// --only         one service only
// --mark-seen    Tangled only: remember what was shown, so it is not shown again (see tangled.mjs)
// --since        Tangled only: how far back to look on the first run (default 7d)
// --no-session   do not keep or reuse a Bluesky login session
//
// Logins (see README.md): Bluesky needs an app password (ATPROTO_APP_PASSWORD), Semble an API key
// (SEMBLE_API_KEY); Tangled needs none. If one service fails, the others are still shown and the
// exit code is 1. Needs only Node 18+, no npm install.
import { argValue, hasFlag, printNotification } from './lib.mjs';
import * as bluesky from './bluesky.mjs';
import * as semble from './semble.mjs';
import * as tangled from './tangled.mjs';

// ----- Arg pre-processing -----
const actor = argValue('actor') || process.env.ATPROTO_IDENTIFIER;
const only = argValue('only');
if (only && !['bluesky', 'semble', 'tangled'].includes(only)) {
  console.error('--only must be bluesky, semble or tangled');
  process.exit(2);
}
const asJson = hasFlag('json');

// ----- Set up services array -----
const services = [['bluesky', () => bluesky.unread({ actor })],
    ['semble', () => semble.unread()],
    ['tangled', () => tangled.unread({ actor })]].filter(([name]) => !only || only === name);

// ----- Run each service -----
let failed = 0;
for (const [name, run] of services) {
  try {
    const { count, items } = await run();
    console.error(`# ${name}: ${count} unread; ${items.length} listed`);
    for (const n of items) printNotification(n, asJson);
  } catch (e) {
    failed++;
    console.error(`# ${name} failed: ${e.message}`);
  }
}
process.exit(failed ? 1 : 0);
