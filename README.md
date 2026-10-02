# AEK Set Plays Planner

Live: https://goranbasaric77-netizen.github.io/aek-set-plays/

Jednostavna PWA aplikacija (index.html + manifest + service worker), bez backenda. Podaci se cuvaju u localStorage na telefonu/racunaru.

## Ponovna objava posle izmene index.html

Otvori terminal u ovom folderu i pokreni:

    git add -A
    git commit -m "Update"
    git push

GitHub Pages se automatski osvezi za 1-2 minuta.

Kada objavljujes novu verziju, u sw.js promeni CACHE na danasnji datum
(npr. "aek-setplays-2026-10-15"). Telefoni tada sami povuku novu verziju pri sledecem otvaranju.
Podaci trenera (localStorage) ostaju sacuvani.

Kada stigne novi build aplikacije, u njega treba ponovo ubaciti PWA tagove u head,
registraciju service workera pre </body>, grb u zaglavlju i grb u PDF zaglavlju.
