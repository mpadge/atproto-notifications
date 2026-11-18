# atproto-notifications

Scripts to print unread atproto notifications to the terminal, including notifications from:

- [Bluesky](https://bsky.app)
- [Semble](https://semble.so)
- [Tangled](https://tangled.org)

Set your atproto handle as `ATPROTO_IDENTIFIER`, for example in `~/.bashrc`, or
pass as `--actor` argument. It's all read-only, and no notifications are marked
as read. Also has no dependencies, so no `npm install` is needed.

Requirements: >= Node 18

```sh
node notifications.mjs
node notifications.mjs --actor=you.example.com --only=semble --json
```

| Option | Meaning |
| --- | --- |
| `--actor=<handle or DID>` | whose notifications (default: `$ATPROTO_IDENTIFIER`, else `DEFAULT_ACTOR` at the top of `notifications.mjs`, currently `mpadge.eu`) |
| `--json` | one JSON object per line, with a `service` field |
| `--only=bluesky\|semble\|tangled` | one service only |
| `--mark-seen` | Tangled: remember what was shown so it is not shown again |
| `--since=7d` | Tangled: how far back to look on the first run |
| `--no-session` | do not keep or reuse a Bluesky login session |


Notifications go to stdout, the `# service: N unread` summaries to stderr. If one service fails the others
are still shown and the exit code is 1.

## Logins

Best way to enable easy logins is to store as local password-store entires.
Otherwise they can also be stored as environment variables.

| Service | Variable | `pass` entry | Notes |
| --- | --- | --- | --- |
| Bluesky | `ATPROTO_APP_PASSWORD` | `atproto/app-password` | an *app password*, never your main one; also `ATPROTO_IDENTIFIER` if it differs from `--actor` |
| Semble | `SEMBLE_API_KEY` | `semble/api-key` | create at <https://semble.so/settings/api-keys> |
| Tangled | none | | uses the public AppView |


Optional overrides: `ATPROTO_PDS` (default: found from your DID document), `SEMBLE_API_URL`, `TANGLED_API_URL`.

## State

Small files in `$ATPROTO_NOTIFICATIONS_STATE_DIR`, else `$XDG_STATE_HOME/atproto-notifications`, else
`~/.local/state/atproto-notifications` (directory `0700`, files `0600`):

- `session.json`: the Bluesky session, to replace an app-password lookup on
every run.
- `tangled-seen.json` to record what `--mark-seen` has shown.

## How each service works

- **Bluesky**: Calls `listNotifications` through your PDS, proxied to the
  Bluesky AppView. "Unread" is the AppView's `seenAt`.
- **Semble**: `network.cosmik.notification.list` from `unreadOnly`.
- **Tangled**: has no notifications API, so this approximates one from Bobbin
  (<https://api.tangled.org>): stars, issues, pull requests and comments on
  repos you own, and new follows.

## Tests

`node --test` runs offline tests against local mock servers.
