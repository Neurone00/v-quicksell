Source Lottie JSONs for the three slots. Currently useAnimations (useanimations.com,
CC BY 4.0 — attribution required and given in the app's settings and the hub):
  connect.json        <- checkmark
  notifications.json  <- notification
  empty.json          <- archive
Then: npm run lottie   -> writes public/lottie/<name>.json and <name>-dark.json on the brand palette.
The originals in src/ are ignored by git (licensed); the recoloured copies are committed.
