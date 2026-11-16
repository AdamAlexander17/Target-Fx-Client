ti# Bills downloads inside Telegram

## Cause and scope

The Bills page fetches authenticated JSON from the existing broker summary/detail
APIs, renders PDFs with jsPDF, and creates selected/all archives with JSZip. It
previously used hidden anchors pointing at local `blob:` URLs for every save.
Telegram WebViews do not reliably handle those browser downloads; ZIP URLs were
also revoked immediately. A click succeeding is not evidence that a file saved.

Telegram's documented native API is `WebApp.downloadFile({url, file_name}, callback)`
(Bot API 8.0+). It requires an HTTPS URL; it cannot fetch a WebView-local blob or
attach the app's Authorization header. Its callback means **accepted**, not download
completed. See <https://core.telegram.org/bots/webapps#downloadfileparams> and
<https://core.telegram.org/bots/webapps#initializing-mini-apps>.

The existing AI `/ai/files/` route serves generated chart/export capabilities, but
does not accept the Bills page's locally generated PDFs/ZIPs. `/ai/uploads` parses
chat attachments, not bill downloads. `/ai/bills/` is authenticated and renders
different statement exports. Existing bot delivery handles text/photos, not an
authenticated bill-document delivery request. None of these can safely be assumed
to support native saving of the exact Bills page output.

## Implemented behavior

- Normal browser: local blob download, existing filenames and per-login behavior;
  defer PDF/ZIP URL revocation for 60 seconds and propagate failures.
- Telegram desktop/mobile/web: generate the same output, then display a save panel.
  Individual exports list one PDF per login; ZIP exports list one archive.
- **Download** (8.0+): authenticated upload to the AI relay, then native save dialog.
  Explicit progress, cancellation, timeout, and error messages; no automatic
  cross-channel fallback or misleading “saved” confirmation.
- **Share / Save to Files**: only shown when `navigator.canShare({files})` supports
  that file. Called from a fresh user click after generation, preserving activation.
  The user chooses where to share/save; cancellation is not silently retried.
- Older clients without file sharing show instructions to update Telegram or open
  Bills and sign in in a normal browser. No session token is transferred to it.
- All existing search/group, selection, 300-login detail chunks, zero-net bulk
  skips, and PDF rendering remain in place. “All individual” remains per-login PDFs,
  not a new combined-PDF behavior.

## Deployment requirements (required for native Download)

Deploy the updated frontend **and** Python AI service. No C++ change, bot token,
new database table, signing secret, or external storage provider is required.

1. Route `/ai/bill-downloads` and its child paths to this AI service, not the SPA
   fallback. Same-origin HTTPS is the default. If AI runs on a different origin,
   set `VITE_AI_API_BASE_URL` to its public HTTPS base and permit the frontend
   origin in the service's existing CORS settings.
2. The direct HTTPS download URL must be reachable by Telegram/native clients
   without bearer headers, login middleware, VPN-only access, or HTML redirects.
   Local development HTTP cannot exercise native downloading.
3. Permit POST bodies up to 25 MiB plus proxy overhead; allow the upload time.
4. Ensure the service can write its existing files directory. Relay files use a
   private `bill-downloads` subdirectory; **do not expose it as static files**.
   Multiple service instances need shared storage or sticky routing for these
   routes. The 250 MiB admission quota is protected within one worker process;
   use a single worker for a strict quota (multiple workers may temporarily race).
5. Redact capability path segments from proxy/access logs, analytics and error
   trackers. A capability is a temporary file credential, not an app session.
   Do not add JWTs, refresh tokens, bot tokens or Telegram init data to URLs.

POST authenticates through the existing `get_session`, using the **main app's
current user token**, not the AI page's independently pasted token override.
Only PDF/ZIP signatures are accepted; bytes are streamed with a 25 MiB hard bound.
Random 256-bit file capabilities expire after five minutes. GET checks expiry on
every request and returns attachment, no-store, nosniff, no-referrer and Telegram
web CORS headers. Native download retries/ranges can reuse a link until expiry.
Expired disk files are lazily removed on subsequent uploads or expired GETs;
expiry denies access even before physical cleanup. The relay never fetches a
caller-supplied URL and stores neither session tokens nor broker identities.

If the relay is missing, unavailable, oversized, or on HTTP, Download reports the
problem and keeps the generated file available for an explicit share/retry. File
sharing needs no relay. There is no promise that old Telegram desktop clients,
which support neither native downloads nor Web Share files, can save in-WebView.

Scope: this changes the **Bills page**, not the separate Ask AI statement card or
standalone AI HTML client download interfaces.

## Validation

- Node tests: `tests/bills-downloads.test.mjs` covers browser and mocked Telegram
  save APIs, platform/version detection, header-only authentication, relay/network
  failures, size limits, cancellation/timeouts, sharing capability, and all five
  actual Bills page handlers including zero-net skips and detail chunks.
- Python: `ai_services/tests/test_bill_downloads.py` exercises the router in
  isolation using synthetic auth: unauthorized uploads, PDF/ZIP bytes and response
  headers, expiry, unknown tokens, filename handling, limits/quota and cleanup.
- Targeted ESLint and production Vite build.
- `tests/bills-downloads-browser.mjs` runs the real React save panel in headless
  Edge at desktop/mobile viewport sizes, with synthetic native/relay/share APIs;
  checks accepted/cancelled states, relay errors, fresh share activation and
  cancellation, old-client guidance, and real browser PDF/ZIP download events.
- Real native OS dialogs, public proxy routing, and completion must still be
  smoke-tested after deployment in Telegram Android, iOS and Desktop. Mocks cannot
  prove Telegram saved a file on a physical device.