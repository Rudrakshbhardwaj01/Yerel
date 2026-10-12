# Architecture

Yerel has a browser workspace backed by a local companion process.

```text
Next.js website
  ├─ landing page and brand surface
  └─ browser workspace
       │ authenticated loopback HTTP
       ▼
Local companion (127.0.0.1:3847)
  ├─ pairing token and exact-origin checks
  ├─ validates one loopback target
  ├─ discovers cloudflared
  ├─ starts and monitors cloudflared
  └─ reports the real Quick Tunnel URL
       │
       ▼
Cloudflare Quick Tunnel → temporary public HTTPS URL
```

The website is independently deployable with Next.js/Vercel. It does not run commands or start a tunnel on the server. The workspace requests status on mount; authenticated access requires the current companion token. Hosting does not guarantee browser permission to access a loopback HTTP service.

## Companion API

`cli/index.ts` starts the companion when no positional target is supplied. It binds to `127.0.0.1` by default and exposes:

- `GET /health` for unauthenticated reachability.
- `GET /status` for authenticated state.
- `POST /pair` to validate the current token.
- `POST /tunnels` to start one consented tunnel.
- `DELETE /tunnels/:id` to stop it.

Protected requests require a Bearer token. A supplied `Origin` must match the exact allowlist; requests without an Origin are accepted subject to authentication. `/pair` validates a token in its JSON body, but the workspace uses the entered token directly for authenticated requests. `DELETE /pair` is an authenticated acknowledgement, not revocation. The companion owns authoritative tunnel state.

## Frontend synchronization

`shared/frontend-state.ts` normalizes direct or legacy nested responses. Start returns `id`; status returns `tunnelId`; both become `id` for the Stop endpoint. Backend `state` determines the UI phase, and active-share rendering also requires the returned URL. No URL is generated client-side.

`shared/frontend-controller.ts` owns request ordering independently of React rendering:

- Status reads are single-flight and reschedule 2.5 seconds after settlement, including unchanged states. Refresh joins an existing read or starts `/status` directly.
- Mutations are single-flight. Starting and completing a mutation advance an epoch to invalidate older GET snapshots. Dispatching a GET does not invalidate a mutation result.
- Successful mutations apply their response immediately. A failed or timed-out mutation triggers a fresh status read after an older read drains; the controller never automatically replays POST.
- `app/page.tsx` gives each browser request a seven-second timeout. The companion can still finish after the browser aborts, so status polling reconciles the outcome.
- Token changes or workspace unmount dispose the controller, cancel its polling timer, and suppress late callbacks. Tokens remain in React memory; a full reload or closing/reopening the workspace requires re-entry, not a new tunnel.

Backend readiness separately uses local reachability checks (10-second request timeout) and a 30-second post-spawn deadline for a parsed URL and registered connection. These checks do not fetch the public URL. Graceful termination attempts an initial kill, then escalates after 1.5 seconds and reports failure if the child still does not exit.

## Foreground CLI

The same entry point supports terminal-first use when passed a positional target:

```text
Yerel CLI
  ├─ validates one loopback target
  ├─ discovers cloudflared
  ├─ starts and monitors cloudflared
  ├─ prints the real Quick Tunnel URL
  └─ stops and cleans up on shutdown
```

## Shared modules

`server/tunnel.ts` is the reusable process-lifecycle module. It performs local reachability checks, starts `cloudflared` with an argument array and `shell: false`, parses provider output, waits for readiness, handles errors and unexpected exits, and terminates the child process.

`shared/target.ts` is the local-target policy. `shared/cloudflared.ts` performs PATH, PATHEXT, and explicit-path discovery, including Windows paths containing spaces. `shared/types.ts` contains the target and tunnel status contracts shared by the companion and lifecycle code.

The local companion must run on the developer's computer because the tunnel must originate there and reach the developer's local application. Vercel can host the website but cannot launch `cloudflared` on a visitor's machine.
