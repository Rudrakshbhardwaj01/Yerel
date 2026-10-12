# Security notes

Yerel deliberately exposes a selected local service to the public internet. The local companion is therefore the security boundary.

## Companion controls

The companion:

- Binds to `127.0.0.1` in the normal CLI workflow; programmatic callers must not use the helper's host override to expose it remotely.
- Accepts only HTTP and HTTPS loopback targets.
- Rejects remote hosts, credentials, fragments, malformed URLs, and invalid ports.
- Uses a session-specific token generated from 24 random bytes, hex-encoded, for protected routes. `/health` is unauthenticated and `/pair` validates the token in its JSON body.
- Uses constant-time comparison of SHA-256 token digests.
- Checks supplied Origin headers against exact configured origins; requests without an Origin are accepted subject to authentication. It does not use wildcard CORS.
- Does not currently validate the HTTP Host header; loopback binding is not Host-header validation.
- Limits JSON request bodies to 8 KiB.
- Requires explicit `consent: true` before a tunnel starts.
- Does not expose a shell, filesystem, arbitrary proxy, or request-controlled executable path.
- Uses `spawn()` with shell execution disabled and argument arrays.
- Bounds provider output and accepts only validated Quick Tunnel HTTPS URLs.
- Reports active after a parsed URL, registered-connection log, and local HTTP response. It does not independently verify the public URL or require HTTP 200 from the local probe.
- Allows one active tunnel per companion.
- Attempts to terminate the tunnel on stop, Ctrl+C, SIGTERM, startup failure, timeout, and unexpected lifecycle paths.

The pairing token is memory-only in the website and remains reusable for the companion session. A full page reload requires re-entry; a fresh companion process creates a fresh token. `DELETE /pair` currently does not revoke it. Keep the token private and do not paste it into issue trackers, logs, or source files.

## Public exposure

HTTPS protects transport to the public URL; it does not authenticate visitors or secure the selected application. Anyone who receives the URL may be able to reach the service. Do not expose credentials, admin panels, private data, debug endpoints, or production systems without application-level access control.

Treat every shared development service as public while the tunnel is active. Stop the tunnel when it is no longer needed.

## Browser boundary

The website cannot execute the CLI directly. It can issue only the small authenticated loopback API requests implemented by the companion. A deployed HTTPS website may be subject to browser local-network permission or mixed-content policies when calling a local HTTP companion; Yerel does not bypass those browser protections. Running the website locally or using the foreground CLI is the fallback.

## Target validation limits

Target validation is a policy boundary, not a complete guarantee against every DNS or operating-system networking issue. The selected local application remains responsible for its own authentication, authorization, CSRF protection, host checks, and sensitive-data handling.
