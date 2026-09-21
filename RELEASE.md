<p align="center"><img src="https://raw.githubusercontent.com/Neurone00/v-quicksell/main/brand/banner.png" alt="Quicksell" width="700"></p>

## Quicksell 1.5.1

**1.5.1** — se il compilatore fatica più volte (segno che Vinted ha cambiato qualcosa), il pannello te lo dice.

## Quicksell 1.5.0

**1.5.0 — a prova di cambiamenti di Vinted.** L’estensione non dipende più dai nomi di classe di Vinted (quelli che cambiano a ogni aggiornamento): trova i campi per ruolo e nome, come farebbe una persona. E se un campo comunque non si compila, chiede al modello di guardare il menu aperto e dire cosa cliccare (auto-riparazione), poi lo segnala.

## Quicksell 1.4.26

**1.4.26** — marca: ora clicca il risultato (es. NAVIGARE). Prima cercava la marca tra i link del piè di pagina di Vinted invece che tra i risultati.

## Quicksell 1.4.25

**1.4.25** — marca: non scrivo più nella barra di ricerca in alto di Vinted (“Cerca articoli”) per sbaglio; uso il riquadro “Cerca marche” del menu. Se non trova la marca, manda all’app cosa ha visto.

## Quicksell 1.4.24

**1.4.24** — tutti i menu ora usano un click “vero” (nativo): era la sequenza di eventi simulati a non registrarsi, non il pulsante scelto. Più affidabile anche per marca e condizioni.

## Quicksell 1.4.23

**1.4.23** — taglia: uso esattamente il click che funziona (verificato sul pulsante della griglia) e controllo il valore del campo, non lo stato del pulsante che non si aggiorna.

## Quicksell 1.4.22

**1.4.22** — taglia: clicco il pulsante della griglia (non il doppione “Consigliato”), con tasto Spazio di riserva se il click non prende; se ancora non va, manda all’app cosa è successo.

## Quicksell 1.4.21

**1.4.21** — taglia: il menu si chiude appena scegli e prima lo leggevo come “fallito”, riprovavo e la toglievo; ora la chiusura conta come conferma. Marca: trovo il riquadro di ricerca come “il campo nuovo che compare” e non richiudo un menu già aperto. Foto ora su R2 (niente più limiti di caricamento).

## Quicksell 1.4.20

**1.4.20** — marca: cerco davvero nel riquadro “Cerca marche” (prima scrivevo nel campo sbagliato). Taglia: la “L” compare due volte (Consigliato + griglia) e il controllo guardava quella sbagliata, de-selezionandola; sistemato. Categoria: se si ferma, manda all’app cosa ha visto a ogni livello.

## Quicksell 1.4.19

**1.4.19** — caricamento non va più in timeout: l’analisi gira in background e l’app la mostra quando è pronta. Categoria: uso il riquadro “Cerca una categoria” per arrivare al ramo giusto (es. Camicie) anche quando sta sotto “Vestiti”.

## Quicksell 1.4.18

**1.4.18** — ora sceglie da sola anche la categoria: naviga l’albero di Vinted (Uomo → Camicie → …) seguendo le parole della categoria. Se non trova il ramo giusto si ferma e lo scegli tu.

## Quicksell 1.4.17

**1.4.17** — marca: ora la cerco nel riquadro “Cerca marche” del menu e la scelgo (prima non partiva). Taglia: sistemato il caso in cui si de-selezionava. Nell’app puoi rimuovere un articolo (✕) e gli articoli già pubblicati non si mostrano più.

## Quicksell 1.4.16

**1.4.16** — due novità: l’app sceglie da sola la foto migliore come copertina; e il pannello dell’estensione mostra i tuoi annunci attivi, con account, telefono e diagnostica spostati nel menu ⚙.

## Quicksell 1.4.15

**1.4.15** — la taglia non si de-seleziona più: ogni menu viene cliccato una volta sola e poi lasciato stare (niente ri-click che toglieva la spunta). Condizioni, colore, materiale già ok.

## Quicksell 1.4.14

**1.4.14** — stop al “materiale impazzito”: se un’opzione è già spuntata non la riclicco (un secondo click su una casella la toglieva).

## Quicksell 1.4.13

**1.4.13** — condizioni ora si seleziona (era un radio col titolo dentro una Cell, non un aria-label), e i menu si chiudono da soli invece di accavallarsi. Taglia, colore, materiale già funzionavano.

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
