# Yerel

> **Your localhost. Out in the world.**

Yerel takes its name from the Turkish word for **“local.”** It lets you share one web application running on your computer through a temporary public HTTPS URL.

The primary interface is the Yerel website. A small local Node.js companion runs on your machine, validates the URL you choose, starts Cloudflare Quick Tunnel through `cloudflared`, and reports the real public URL back to the website.

## How it works

```text
Browser website
  │ authenticated loopback HTTP
  ▼
Yerel companion on 127.0.0.1:3847
  │ validates target and manages child process
  ▼
cloudflared → Cloudflare Quick Tunnel → temporary HTTPS URL
                                      │
                                      ▼
                               visitor's browser
```

The website cannot execute commands on your computer by itself. You start the local companion once, pair the website with the token it prints, and then use the browser workspace for normal start/stop operations.

## Requirements

- Node.js 20+ recommended.
- npm.
- `cloudflared` installed locally.
- A local HTTP or HTTPS application.
- Network access to Cloudflare.

Official Cloudflare installation instructions:

<https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/>

Quick Tunnel documentation:

<https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/>

The documented workflow and local automated checks use Windows. The companion uses portable Node APIs and is intended for macOS and Linux as well, but those platforms are not verified here. Automated checks are not evidence of live browser or Cloudflare connectivity.

## Quick start

Use PowerShell with Git, Node.js, and npm installed. Keep the companion, website, and the application you share running in separate terminals.

1. **Clone and enter the repository.**

   ```powershell
   git clone https://github.com/Rudrakshbhardwaj01/Yerel.git
   cd Yerel
   ```

2. **Install dependencies.**

   ```powershell
   npm ci
   ```

3. **Install or locate `cloudflared`.** Follow the [official installation instructions](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/), then verify:

   ```powershell
   cloudflared --version
   ```

4. **If it is not on PATH, set its actual executable path** in the terminal where you will run the companion. For example, if installed at this location:

   ```powershell
   $env:YEREL_CLOUDFLARED_PATH = "C:\Program Files (x86)\cloudflared\cloudflared.exe"
   & $env:YEREL_CLOUDFLARED_PATH --version
   ```

5. **Start the companion** from the repository root:

   ```powershell
   npm run cli
   ```

   It listens on `127.0.0.1:3847` by default. Keep this terminal running.

6. **Copy the session-specific pairing token** printed in that terminal. Keep it private.

7. **Start the website in another terminal**, also from the repository root:

   ```powershell
   npm run dev
   ```

8. **Open `http://127.0.0.1:3000`** and select **Get Started**. If Next.js uses another port, either free port 3000 or configure that exact website origin as described in [Configuration](#configuration).

9. **Paste the current token into Pairing token.** The workspace automatically requests authenticated status; **Refresh** can request it again. There is no separate Connect button.

10. **Start your own local application in a separate terminal**, using its normal command. Yerel does not create or start it for you. Verify it loads locally first; `http://127.0.0.1:5173` is an example, not a service bundled with Yerel.

11. **Enter your application's actual local URL**, check the public-sharing consent box, and select **Start sharing**.

12. **Wait for active status and the real public HTTPS URL.** Use **Copy link** or **Open** to share or test it.

13. **Select Stop sharing when finished.** This stops the tunnel, not your local application.

## First sharing session

Follow [Quick start](#quick-start) for the complete setup. The companion prints a **session-specific pairing token** at startup. It remains usable for authenticated requests throughout that companion process's lifetime; restarting the companion generates a new token.

The companion owns tunnel state; closing the browser does not implicitly stop a tunnel. After a full page reload, reopen the workspace and re-enter the current companion token to recover the active share. The token is deliberately memory-only and is not saved in browser storage.

Yerel synchronizes tunnel status with the local companion, recovers from delayed start responses, and restores the current tunnel state when the workspace is refreshed. It displays only the public URL returned by the companion. A browser request timeout does not necessarily mean the tunnel failed; allow status recovery to finish instead of repeatedly starting it. See [Architecture](docs/ARCHITECTURE.md) for synchronization details.

## CLI usage

The CLI remains independently usable for troubleshooting and terminal-first workflows:

```powershell
npm run cli -- http://127.0.0.1:5173
```

This starts a foreground tunnel directly, prints the public URL, and stops on `Ctrl+C`.

Help:

```powershell
npm run cli:help
```

The companion mode is the no-argument command:

```powershell
npm run cli
```

It prints a pairing token and waits for website requests.

## Companion API

The normal CLI binds the API to `127.0.0.1`; it is not a public API. The programmatic `createCompanion()` helper accepts a host override, so callers must preserve loopback binding.

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/health` | Unauthenticated reachability check |
| `GET` | `/status` | Authenticated tunnel status |
| `POST` | `/pair` | Validate `{ token }` in a JSON body; no Bearer header needed |
| `POST` | `/tunnels` | Authenticated start request with `{ url, consent: true }` |
| `DELETE` | `/tunnels/:id` | Authenticated stop request |
| `DELETE` | `/pair` | Authenticated acknowledgement only; does not revoke the token or stop a tunnel |

Protected requests use:

```http
Authorization: Bearer <pairing-token>
Origin: http://127.0.0.1:3000
```

The workspace uses the entered token directly as a Bearer token for `/status` and tunnel requests; it does not need to call `/pair` first. Browser requests must match an allowed Origin. Requests without an Origin are accepted subject to endpoint authentication, and allowed-origin OPTIONS preflights do not require authentication. The current API does not validate the HTTP Host header.

JSON bodies are limited to 8 KiB. Starts require `consent: true` and a valid local target. The API does not provide a general shell, filesystem, or proxy API.

## Configuration

| Variable | Purpose | Default |
|---|---|---|
| `YEREL_CLOUDFLARED_PATH` | Explicit `cloudflared` executable path | PATH/PATHEXT discovery |
| `YEREL_ALLOWED_ORIGINS` | Comma-separated website origins | `http://localhost:3000,http://127.0.0.1:3000` |
| `YEREL_CONTROL_PORT` | Companion loopback port | `3847` |

The website currently uses `http://127.0.0.1:3847` in `app/page.tsx`. Changing only `YEREL_CONTROL_PORT` will disconnect it; keep the default for the standard workflow.

You can also configure origins with the CLI:

```powershell
npm run cli -- --origin http://127.0.0.1:3000
```

For a deployed website, substitute its exact origin (scheme, host, and port if non-default; no path or trailing slash):

```powershell
npm run cli -- --origin https://tryyerel.vercel.app
```

`http://127.0.0.1:3000`, `http://localhost:3000`, and a deployed HTTPS URL are different origins. Without configuration, both listed local origins are allowed. Environment origins and repeated `--origin` flags are combined; a nonempty configured list replaces the defaults. Include every origin you actually use. Do not use wildcard origins, bind the companion to `0.0.0.0`, or disable browser security.

For the deployed site in this repository, start the companion with the production origin explicitly:

```powershell
npm run cli -- --origin https://tryyerel.vercel.app
```

The companion answers Chromium/Edge Private Network Access preflights with `Access-Control-Allow-Private-Network: true` only for an allowlisted Origin. This header is required for an HTTPS website to request the HTTP loopback companion, but it does not grant browser permission by itself. Edge may show a local-network permission prompt or apply an enterprise/browser policy; allow the prompt for `tryyerel.vercel.app` if shown. The companion cannot bypass a browser policy that denies local-network access.

## Security

Sharing makes the selected local service publicly reachable. HTTPS protects transport; it does not authenticate visitors or secure the application itself. Anyone who obtains the temporary URL may be able to access it.

The companion provides:

- Loopback binding in the normal CLI workflow.
- A session-specific pairing token from 24 cryptographically random bytes, encoded as hex.
- Exact allowlist checks when an Origin header is supplied.
- Constant-time comparison of SHA-256 token digests.
- Local HTTP/HTTPS target validation.
- Rejection of external targets, credentials, malformed URLs, and invalid ports.
- Explicit consent before tunnel start.
- Shell-disabled process spawning with argument arrays.
- Single active tunnel policy.
- JSON request bodies limited to 8 KiB.
- Attempts to clean up the tunnel on graceful shutdown, stop, or startup failure; hard crashes cannot guarantee cleanup.

Targets must use `localhost`, `127.0.0.1`, or `::1`; the companion also rejects its own control port. Readiness requires a parsed Quick Tunnel URL, a registered-connection log, and a local HTTP response—not an independent check of public connectivity. See [Security notes](docs/SECURITY.md) for boundaries and limitations.

Do not share credentials, admin panels, debug endpoints, private data, or production services without application-level authorization. Temporary Quick Tunnel URLs are not a replacement for authentication, a firewall, or production hosting.

Modern browsers may require local-network permission when an HTTPS-hosted website accesses a local HTTP companion. Yerel returns the required Private Network Access preflight header without weakening its exact-origin allowlist, but it does not disable browser security. If Edge still reports that loopback access is denied, allow local-network access for the site or use the locally served website/foreground CLI; an ordinary CORS header alone cannot override that browser decision.

## Website and Vercel

The website is a standard Next.js application and can be deployed independently:

```powershell
npm run build
```

Deploy the repository root to Vercel with the normal Next.js build configuration. The companion and `cloudflared` still run on the developer's computer. Vercel cannot launch a process on a visitor's computer or reach the visitor's `localhost`.

Configure the deployed website's exact origin using [Configuration](#configuration). HTTPS-to-local-HTTP requests may be allowed, permission-gated, or blocked depending on browser local-network and security policies. A successful Next.js build does not verify this deployed workflow; it must be tested in the target browser. Use the locally served website or foreground CLI if browser policy blocks access.

## Development commands

```powershell
npm ci
npm run dev
npm run cli
npm run cli:help
npm run typecheck
npm test
npm run lint
npm run build
npm start
```

`npm start` serves the built Next.js website locally. It does not start the companion automatically.

## Testing

### Automated checks

The automated suite covers:

- Valid and invalid loopback targets.
- IPv4 and IPv6 loopback handling.
- Credential, fragment, protocol, port, and remote-target rejection.
- Cloudflare URL parsing.
- Fake-process tunnel startup, registered-connection readiness, and clean stop.
- CLI parsing and direct foreground output.
- Companion health, status authentication, Origin checks, pairing, single-tunnel policy, start, and stop.
- Frontend response mapping, delayed start/refresh races, repeated polling, timeout reconciliation without duplicate starts, restored active state, stop ids, and disposal of stale workspace requests.

Run:

```powershell
npm run typecheck
npm test
npm run lint
npm run build
```

Tests use controlled child-process doubles and mocked frontend requests. They do not by themselves prove Cloudflare connectivity or successful live-browser behavior. Backend timeout and unexpected-exit branches are not comprehensively covered by the current tests.

### Manual end-to-end verification

This is a procedure to run, not a claim that a live or deployed test has passed.

1. Start a non-sensitive sample app on a known port. For a minimal test-only HTTP response, run this in a separate PowerShell terminal (no dependencies or files needed):

   ```powershell
   node -e "require('node:http').createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/plain','Cache-Control':'no-store'});res.end('Yerel smoke test');}).listen(5173,'127.0.0.1')"
   ```

2. Open `http://127.0.0.1:5173` and confirm **Yerel smoke test** loads locally. Use another available port if necessary.
3. Start the companion and website as in [Quick start](#quick-start), then enter the current token in the workspace.
4. Enter the sample app URL, explicitly consent, and click **Start sharing**. Confirm the workspace leaves validating/starting and displays **active**, a real `https://<assigned-name>.trycloudflare.com` URL, and active-share controls.
5. Use **Open** and **Copy link**. Verify the public URL serves the same response, not just that a URL was displayed.
6. Click **Refresh** and confirm the same active tunnel is recovered. For reload recovery, reload the page, reopen the workspace, and re-enter the token.
7. Click **Stop sharing** and wait for **stopped**. Request the public URL again without relying on a cached page; it should stop serving the sample app after any provider propagation delay. Confirm the local URL still works.
8. Stop the sample server, companion, and website with `Ctrl+C` when finished. Record the OS/browser and actual outcomes when reporting verification; do not publish pairing tokens or temporary session URLs.

## Troubleshooting

### Companion is unavailable

Confirm that `npm run cli` is still running and listening on `127.0.0.1:3847`. Restart it and use the fresh token printed in the terminal.

### Pairing fails

Use the token from the current companion process, not an older terminal. Configure the website origin if necessary:

```powershell
npm run cli -- --origin http://127.0.0.1:3000
```

### `cloudflared` is not detected

```powershell
cloudflared --version
$env:YEREL_CLOUDFLARED_PATH = "C:\Program Files (x86)\cloudflared\cloudflared.exe"
npm run cli
```

### Target is rejected

Use a local URL such as:

```text
http://127.0.0.1:5173
```

Remote hosts, unsupported protocols, credentials, fragments, malformed URLs, and invalid ports are rejected intentionally.

### Target is unreachable

Open it directly first or run:

```powershell
Invoke-WebRequest http://127.0.0.1:5173 -UseBasicParsing
```

Start the application before starting the tunnel.

### Tunnel startup fails or times out

Inspect the companion terminal. The CLI waits for a real Quick Tunnel URL and registered connection. It does not treat child-process startup as readiness.

### Public URL remains briefly available after stopping

Wait for the companion to report stopped. Provider-side route invalidation can take a short time after process termination.

## Project structure

```text
yerel/
├─ app/                 # Next.js website and companion workspace
├─ cli/index.ts         # Companion API and foreground CLI entry point
├─ server/tunnel.ts     # Cloudflared process lifecycle
├─ shared/target.ts     # Local-target security policy
├─ shared/cloudflared.ts # PATH/PATHEXT and explicit-path discovery
├─ shared/frontend-state.ts # Response normalization and UI phases
├─ shared/frontend-controller.ts # Polling and request ordering
├─ shared/types.ts      # Tunnel and target types
├─ components/Brand.tsx # Ghost mark and wordmark
├─ tests/               # CLI, target, tunnel, and frontend tests
├─ public/              # Brand assets, font, background, illustrations
└─ docs/                # Architecture and security documentation
```

## Limitations

- One active tunnel per companion.
- Quick Tunnel URLs are temporary and can change.
- The local application, companion, network, and tunnel must remain available.
- No permanent URLs, custom domains, accounts, password gate, analytics, or multi-service proxy.
- No automatic binary downloader.
- The companion must be started manually after installation.
- Browser-to-loopback requests from a hosted HTTPS site may require browser local-network permission.
- Cross-platform behavior should be smoke-tested on each target OS.

## FAQ

### Does the website work without the companion?

The landing page does. Sharing requires the local companion because only a local process can reach your application and start `cloudflared` on your computer.

### Do I need a Cloudflare account?

Quick Tunnels do not require a Cloudflare API token or custom domain. Provider terms and limits still apply.

### Is the URL private?

No. Treat it as public while the tunnel is active.

### Can I use React, Vite, or Next.js?

Yes, when the app is already running as a reachable HTTP/HTTPS service and its routing works through a direct tunnel.

### Does the tunnel include my backend automatically?

No. Yerel shares one selected service. Configure your frontend development proxy for backend calls.

## Contributing

1. Create a branch or fork.
2. Run `npm ci`.
3. Make a focused change.
4. Add tests for behavior changes.
5. Run typecheck, tests, lint, and build.
6. Submit a pull request with actual verification results.

Do not commit tokens, private URLs, credentials, or local application data.

## License

The repository does not currently contain a `LICENSE` file or declare a license in `package.json`. Do not assume redistribution rights without confirmation from the project owner.

## GitHub setup guide

<https://github.com/Rudrakshbhardwaj01/Yerel>

The workspace's **Setup guide** link opens [Quick start](https://github.com/Rudrakshbhardwaj01/Yerel#quick-start) in a new tab.
