# AEK Set Plays Planner

Live: https://goranbasaric77-netizen.github.io/aek-set-plays/

Jednostavna PWA aplikacija (index.html + manifest + service worker), bez backenda. Podaci se cuvaju u localStorage na telefonu/racunaru.

## Ponovna objava posle izmene index.html

Otvori terminal u ovom folderu i pokreni:

    git add -A
    git commit -m "Update"
    git push

GitHub Pages se automatski osvezi za 1-2 minuta.

Ako menjas vise fajlova (ikonice, manifest), podigni verziju kesa u sw.js
(CACHE = "aek-setplays-v2") da telefoni koji su vec otvarali aplikaciju povuku novu verziju.
