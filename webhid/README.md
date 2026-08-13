# Buffering Cat WebHID controller

Browser UI for the CH32V003 USB HID firmware. It controls D1–D8 individually,
brightness, on-device animations, arbitrary browser-streamed mask frames, and
firmware updates through the `1209:b003` USB bootloader.

Use current Chrome or Edge. WebHID requires a secure context: `localhost` is
accepted for local development; a remote deployment must use HTTPS.

```sh
npm install
npm run dev
npm test
```

Open the printed localhost URL, choose **Connect USB**, and select
`Buffering Cat LED` (`1209:d003`). The browser intentionally requires a user
gesture for the first permission grant. Previously granted matching devices
are reopened automatically. On connection, the controller reads the hardware
revision and firmware Git hash without requiring **Sync status**. If that hash
matches a loaded GitHub Release, its `vX.Y.Z` tag is also displayed and selected
automatically; offline and development builds fall back to the hash.

The displayed physical layout follows the selected hardware revision. On v1.0,
D1 is at the left; starting with v1.1, D1 is at the top. Both revisions number
D2–D8 counter-clockwise. The updater loads v1.0/v1.1 images from GitHub Releases
or a local `.bin`, checks the size and GitHub-provided SHA-256 digest when
available, then programs the device through WebHID. Choose the correct board
revision.

The one-time bootloader must first be installed with WCH-Link. Hardware v1.0
also needs a fixed 1.5 kOhm pull-up from D- to 3.3 V; v1.1 drives its R5 pull-up
from PD0.

## Cloudflare Pages

This app is a static Next.js export and does not require Pages Functions,
Workers, D1, R2, or server-side environment variables. Configure the Pages
project with:

| Setting | Value |
| --- | --- |
| Root directory | `webhid` |
| Framework preset | Next.js (Static HTML Export) |
| Build command | `npm run build` |
| Build output directory | `out` |
| Node.js | 22 or newer |

The GitHub Releases API and WebHID calls run directly in the visitor's browser.
Cloudflare Pages provides the HTTPS secure context required by WebHID.
