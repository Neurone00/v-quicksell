<p align="center"><img src="https://raw.githubusercontent.com/Neurone00/v-quicksell/main/brand/banner.png" alt="Quicksell" width="700"></p>

## Quicksell 1.4.12

**1.4.12** — ora seleziona davvero: le opzioni Vinted sono <div role=checkbox/radio> con aria-label esatto (es. “L”). Clicco quell’elemento e verifico che sia spuntato. Vale per taglia, condizioni, colore, materiale.

## Quicksell 1.4.11

**1.4.11** — le opzioni Vinted sono caselle/radio dentro i menu: ora clicco l’elemento giusto (non la riga), e verifico che il valore sia entrato. Il tasto Diagnostica ora copia anche il DOM dei menu nell’app, così sistemo la selezione con precisione.

## Quicksell 1.4.10

**1.4.10** — condizioni ora si compila: le etichette vere di Vinted sono “Ottime”/“Buone” (non “Ottime condizioni”). Corretto sia l’AI sia la corrispondenza, comprese le bozze già fatte.

## Quicksell 1.4.9

**1.4.9** — corrispondenza 1:1 coi menu Vinted: l'estensione impara le opzioni vere di colore/materiale/condizioni dal modulo e l'app le usa per far scegliere all'AI solo valori validi. Così i menu si riempiono da soli senza il tuo intervento.

## Quicksell 1.4.8

**1.4.8** — i menu (taglia, condizioni, colore, materiale, marca) sono campi con id noti: ora li apro col metodo giusto e scelgo l'opzione. Se qualcosa non va, mando all'app com’è fatto il menu, così lo sistemo al volo.

## Quicksell 1.4.7

**1.4.7** — compila da solo anche taglia, condizioni, colore, materiale e marca: apre i menu di Vinted e sceglie l'opzione giusta appena compaiono (dopo la categoria). Se un valore non combacia, lo lascia a te e te lo dice nel pannello.

## Quicksell 1.4.6

**1.4.6** — il prezzo ora si scrive giusto (prima usciva “NaN €”: Vinted legge il numero col punto, non la virgola).

## Quicksell 1.4.5

**1.4.5** — the popup now shows your account key with a Copia button, so you can back it up. Auto-updates keep it; only removing the extension clears it.

## Quicksell 1.4.4

**1.4.4** — finds Vinted’s price field reliably (it lives in the “Prezzo” section, not by a name the extension could guess). Diagnostica now dumps each field’s placeholder and label.

## Quicksell 1.4.3

**1.4.3** — the price now fills correctly. Vinted only shows the price field after you pick a category, so the extension waits for it and fills it the moment it appears. Uses Vinted's real save-button id too.

## Quicksell 1.4.2

**1.4.2** — fixes the popup: the **Crea account** button now actually appears (a bad edit in 1.4.0 left the old "open the app" message in place).

## Quicksell 1.4.1

**1.4.1** — pins the extension ID (`ceffnhbkhebjpmdfdfinpmegnclgbknf`) so a hand-loaded copy and the auto-updating one are the same extension. If you loaded 1.3.0 unpacked, remove it and use the policy install below.

## Quicksell 1.4.0

**New in 1.4.0**
- **Accounts, self-serve.** The extension's popup has **Crea account** — one click, no email, no password. The account lives in the extension and on the phone you connect to it.
- **Connect your phone** with a QR (or a copied link): the phone joins the same account.
- Creating your account from a Chrome that's signed into the owner login moves the existing drafts to it.

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
