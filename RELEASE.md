<p align="center"><img src="https://raw.githubusercontent.com/Neurone00/v-quicksell/main/brand/banner.png" alt="Quicksell" width="700"></p>

## Quicksell 1.1.0

**New in 1.1.0**
- Price drops run by themselves: daily and on Chrome startup, in a minimized window, one listing every 5–15 s, then a count. No confirmation.
- The extension checks for new releases daily and offers the update with one click (badge on the icon).
- Releases are cut automatically when the version changes.
- New mark and icons; the extension's pages use the brand faces.


**App:** https://v-quicksell.neurone00.workers.dev — open once per device with `?k=<APP_SECRET>`; on Android, Add to home screen.

**Extension (attached zip):** unzip → Chrome `chrome://extensions` → Developer mode → **Load unpacked** → pick the folder → click its icon → enter the app URL and your key.

### What it does
- Phone: share photos to Quicksell → Italian listing + price, grounded in Vinted's public catalog → approve.
- Computer: on vinted.it → Vendi, the extension lists approved drafts; **Compila** brings the photos and text into Vinted's form. You pick the menus and press Carica.
- Every 3 days: −5% to the nearest ,X9, never below the floor. The extension does the drops itself, daily and on Chrome startup, in a minimized window, one every 5–15 s.
- The app never logs into Vinted. It reads public pages only.

### First run
Vinted's form is React-rendered and undocumented. On first open the extension reports the live form to the app (`GET /api/learned`). If the panel says it couldn't find a field, that's the selector table at the top of `extension/content.js`.
