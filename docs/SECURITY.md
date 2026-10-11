# Security notes

Yerel is a consent-based public exposure tool. The local API binds to loopback by default and checks Host and Origin headers before control operations. It accepts only small JSON payloads and exposes no arbitrary shell, filesystem, project-script, or port-scanning endpoint.

Targets must use HTTP or HTTPS and resolve to localhost, `127.0.0.1`, or `::1`. Credentials and URL fragments are rejected. Yerel also refuses its own control port. `cloudflared` is launched with `spawn()` and an argument array with shell execution disabled. Provider output is bounded and only a strict Quick Tunnel HTTPS hostname is accepted after a registered connection and local reachability check.

The public URL is not authentication. Anyone who receives it can access the selected development service while the tunnel runs. Do not expose secrets, admin panels, debug endpoints, production data, or unsafe test routes. Quick Tunnel URLs are temporary and have provider limitations.

There is no password gate, account system, telemetry, automatic binary downloader, reverse proxy, or multi-service routing in this MVP. Install and update `cloudflared` through official channels and verify it is the executable you intend to run.
