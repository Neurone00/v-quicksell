<p align="center"><img src="https://raw.githubusercontent.com/Neurone00/v-quicksell/main/brand/banner.png" alt="Quicksell" width="700"></p>

## Quicksell 1.3.1

**1.3.1** — fixes the extension not seeing the app's login (SameSite cookie); it now reads it through Chrome's cookie API.

**New in 1.3.0**
- **Updates itself.** Installed through Chrome policy, the extension checks the app every few hours and installs new versions silently. No zip, ever again.
- **No key to enter.** It uses the app's own login in this Chrome: open the app once, the extension is connected.

**1.2.0**
- **Diagnostica** in the popup: on a Vinted listing page it reports which fields it can see and which it can't, and copies a report. Use it if Compila leaves something empty.
- Per-user keys: the app supports more than one account; each extension install carries one user's key.
- Popup and panel use the brand faces.

**1.1.0**
- Price drops run by themselves: daily and on Chrome startup, in a minimized window, one listing every 5–15 s, then a count. No confirmation.
- The extension checks for new releases daily and offers the update with one click (badge on the icon).
- Releases are cut automatically when the version changes.
- New mark and icons; the extension's pages use the brand faces.


**App:** https://v-quicksell.neurone00.workers.dev — open once per device with `?k=<APP_SECRET>`; on Android, Add to home screen.

**Extension:** one command in Terminal, once, then quit and reopen Chrome (it installs and updates itself from then on):
```
defaults write com.google.Chrome ExtensionInstallForcelist -array-add "ceffnhbkhebjpmdfdfinpmegnclgbknf;https://v-quicksell.neurone00.workers.dev/ext/updates.xml"
```
Then open the app once in Chrome with your login link. The extension is connected. (Remove any previously loaded unpacked copy.)

### What it does
- Phone: share photos to Quicksell → Italian listing + price, grounded in Vinted's public catalog → approve.
- Computer: on vinted.it → Vendi, the extension lists approved drafts; **Compila** brings the photos and text into Vinted's form. You pick the menus and press Carica.
- Every 3 days: −5% to the nearest ,X9, never below the floor. The extension does the drops itself, daily and on Chrome startup, in a minimized window, one every 5–15 s.
- The app never logs into Vinted. It reads public pages only.

### First run
Vinted's form is React-rendered and undocumented. On first open the extension reports the live form to the app (`GET /api/learned`). If the panel says it couldn't find a field, that's the selector table at the top of `extension/content.js`.
