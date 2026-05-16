# Purjehduskilpailu — Sovellus-spesifikaatio

## Yleiskatsaus
Mobiilioptimoitu web-sovellus purjehduskilpailujen hallintaan. 10 purjehtijaa, 4 venettä, 20 kisaa. Sovellus laskee automaattisesti optimoidun aikataulun ja pitää kirjaa tuloksista reaaliajassa.

## Tekniset valinnat
- **Frontend**: Vanilla HTML/CSS/JS (ei frameworkia — kevyt, nopea)
- **Backend**: Node.js + Express (JSON API)
- **Tietokanta**: SQLite (yksinkertainen, ei tarvita erillistä palvelinta)
- **Deploy**: Fly.io (Dockerfile)
- **Ei ulkoisia riippuvuuksia frontendissä** — toimii offline-tilassa

## Toiminnot

### 1. Purjehtijoiden hallinta
- Sovellus käynnistyy purjehtijoiden nimet -näkymällä
- Oletusnimet A-J, käyttäjä voi muokata kaikkia nimiä
- Nimi = lyhyt tunniste (esim. "Jukka", "Mikko") + vapaaehtoinen pidempi nimi
- Nimet tallentuvat pysyvästi palvelimelle (SQLite)
- Nimet näkyvät kaikissa taulukoissa ja näkymissä

### 2. Kisaaikataulu (automaattinen)
- Optimoitu Python-algoritmilla (esilastattu kiinteä aikataulu)
- Jokaisella purjehtijalla 8 kisaa / 20 kisasta
- Veneet jakautuvat tasaisesti (2x per vene per purjehtija)
- Ei pitkiä putkia (max 2 peräkkäistä) eikä pitkiä taukoja (max 3)
- Kaikki 45 mahdollista paria kohtaavat toisensa

### 3. Tulosten syöttö (mobiilioptimoitu)
- Isot kosketusalueet (min 44x44px)
- Valitse kisa → näytä 4 venettä ja purjehtijat
- Sijoitus 1-4 yhdellä napautuksella per purjehtija
- Validointi: kaikki 4 sijoitusta pitää antaa, ei duplikaatteja
- Tallenna-nappi → välitön päivitys tulostaulukkoon
- Mahdollisuus muokata/poistaa jo syötettyä tulosta

### 4. Tulostaulu (päänäkymä)
- Reaaliaikainen sorttaus: vähiten pisteitä ylimpänä
- Pisteytys: 1. sija = 1p, 2. sija = 2p, 3. sija = 3p, 4. sija = 4p
- Tiebreak: enemmän 1. sijoja voittaa
- Näyttää jokaisen kisan tuloksen per purjehtija
- Kultaa/hopeaa/pronssia top-3:lle
- Scrollattava vaakasuunnassa mobiililla (kisakolumnit)

### 5. Päiväohjelma
- Visuaalinen grid: purjehtija × kisa
- Näyttää millä veneellä purjehtii / onko tauolla
- Värikoodit: purjehdittu ✓, tulossa, tauko
- Helppo seurata omaa päivää

### 6. Tilastot
- Venejakauma per purjehtija
- Sijoitusjakauma (montako 1./2./3./4. sijaa)
- Keskiarvo per purjehtija
- Parimatriisi (kohtaamiskerrat)

## Mobiilioptimointi

### Layout
- Mobile-first suunnittelu (min-width: 320px)
- Tabs-navigaatio alalaidassa (thumb zone)
- Sticky header pistetilanteella
- Full-width kortit, ei sivumarginaaleja mobiililla
- Vaakasuuntainen scroll taulukoissa

### Touch
- Kaikki interaktiiviset elementit min 44x44px
- Swipe tuki tab-vaihtoon (valinnainen)
- Ei hover-riippuvaisia elementtejä
- Pull-to-refresh (valinnainen)

### Suorituskyky
- Ei frameworkia → alle 50KB kokonaiskoko
- Inline CSS/JS → yksi HTTP-pyyntö
- Toimii hitailla yhteyksillä (satamassa!)

## API-rajapinta

### GET /api/sailors
Palauttaa purjehtijoiden nimet.
```json
[{"id": "A", "name": "Jukka"}, ...]
```

### PUT /api/sailors
Päivittää purjehtijoiden nimet.
```json
[{"id": "A", "name": "Jukka"}, ...]
```

### GET /api/results
Palauttaa kaikki tulokset.
```json
{"0": {"A": 1, "E": 2, "G": 3, "I": 4}, ...}
```

### PUT /api/results/:raceIndex
Tallentaa yhden kisan tulokset.
```json
{"A": 1, "E": 2, "G": 3, "I": 4}
```

### DELETE /api/results/:raceIndex
Poistaa yhden kisan tulokset.

### GET /api/schedule
Palauttaa kisaaikataulun.

## Tiedostorakenne
```
purjehdus/
├── server.js          # Express-palvelin + API
├── public/
│   └── index.html     # Frontend (kaikki inline)
├── data/
│   └── purjehdus.db   # SQLite-tietokanta (runtime)
├── Dockerfile
├── fly.toml
├── package.json
├── purjehdus.py       # Aikataulun generointi (kehitystyökalu)
└── SPEC.md
```

## Fly.io Deploy
- Dockerfile: Node.js 20 alpine
- Persistent volume: /app/data (SQLite)
- Portti: 3000
- Yksi instanssi (SQLite ei tue monireplicaa)

## Rajoitukset (v1)
- Yksi kilpailu kerrallaan
- Kiinteä 10/4/20 konfiguraatio
- Ei käyttäjäautentikointia (kaikki voivat syöttää tuloksia)
- Ei reaaliaikaista synkronointia (refresh näyttää uusimman tilan)
