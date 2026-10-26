# Desktop storage, HTTP deployments and compatible video servers

## Desktop settings

The desktop app now saves settings, brand configuration, presenter library, product library and script templates as separate JSON files under `<userData>/data/settings/`. These files survive restarts even when the internal HTTP server changes ports. Writes replace files atomically, and the app prevents multiple desktop instances from writing to the same data directory.

Existing browser data from the current origin is imported when no desktop file exists. Data saved by older releases under a different random port cannot be automatically recovered by this migration. Web/Docker installations continue to use browser storage; back up the browser profile along with the `/data` volume when migrating installations. Configuration files contain credentials and should remain private.

## HTTP and SQLite

The web UI works on ordinary HTTP LAN addresses as well as localhost/HTTPS. UUID creation falls back to `crypto.getRandomValues()` when `crypto.randomUUID()` is unavailable.

Database startup waits for transient locks and obtains a write lock before reading and applying migrations. A failed initialization closes its connection and can be retried on the next request. `/api/health` reports the actual database failure; no database file is deleted or reset to recover from a lock.

## macOS window lifecycle

Closing the last window keeps the local server running while the app remains in the Dock. Clicking its Dock icon opens the window again. Quitting the app stops the server. Startup failures still show the diagnostic log location.

This addresses the reproducible window-reopening defect. A report that only says “cannot run on macOS” does not establish whether the failure is this defect, first-launch security checks, architecture compatibility or something else.

## OpenAI-compatible video

In **Settings → AI platforms → OpenAI**, enter the service's API key and Base URL:

- Standard contract: `https://your-server/v1` (or the full `/v1/videos` URL). Submission uses `POST /videos` with multipart fields.
- Legacy compatible contract: `https://your-server/v1/video/generations`. Submission uses JSON with `model`, `prompt`, optional `seconds`, `size` and `input_reference`.

Both contracts poll `GET /videos/{id}` and download `GET /videos/{id}/content` with Bearer authentication. The application stores the task ID before polling and writes validated video files locally, so task records contain neither API keys nor large base64 payloads. Download/query failures remain recoverable without resubmitting a generation.

Add a self-hosted model in **Settings → Advanced → Custom models**, choosing **OpenAI / Compatible** and **Video**. A custom model receives the configured duration as a string and omits `size` unless the optional OpenAI video size field is filled. For Sora presets, explicitly select 4, 8 or 12 seconds and a supported size such as portrait/landscape 720p. Unsupported duration/size is rejected before billing; the adapter does not silently extend a paid clip. Image-to-video uses `input_reference`; tail frames, reference video and reference audio are unsupported by this adapter.

The adapter never switches submission endpoints after a failed request. Check your server's exact contract before generating; servers with a different JSON schema need an adapter change.
