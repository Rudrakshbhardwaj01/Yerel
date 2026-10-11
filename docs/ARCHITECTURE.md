# Architecture

Yerel intentionally uses one local Node process. `server/index.ts` starts Next.js in custom-server mode, serves the browser UI, and handles four narrow JSON endpoints: snapshot, validate, session start, and session stop.

The browser owns presentation only. `server/tunnel.ts` owns reachability checks, safe `spawn()` of `cloudflared`, bounded provider output parsing, readiness, monitoring, cancellation, termination, and shutdown cleanup. `shared/target.ts` contains the shared loopback URL validator. No Electron, preload bridge, desktop shell, database, or second control service remains.

The server binds to `127.0.0.1` by default. API mutation requests require a matching Host and Origin and JSON content type. The selected target is passed as an argument array, never interpolated into a shell command. The control port itself is rejected as a tunnel target.

Next is not statically exported because the same local Node process must serve the UI and API. Production runs with `next build` followed by `npm start`.
