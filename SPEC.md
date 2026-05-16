# Purjehdus — Sovellus-spesifikaatio v2

## Yleiskatsaus
Mobiilioptimoitu web-sovellus purjehduskilpailujen hallintaan. Tukee useita kilpailuja rinnakkain, dynaamista purjehtija/venemäärää ja finaalisarjaa fleet-mallilla.

## Tekniset valinnat
- **Frontend**: Vanilla HTML/CSS/JS (ei frameworkia — kevyt, nopea, alle 50KB)
- **Backend**: Node.js + Express (JSON API)
- **Tietokanta**: SQLite (better-sqlite3)
- **Deploy**: Fly.io (Dockerfile, persistent volume)

---

## Kilpailumalli

### Kilpailun luonti
- Nimi (esim. "Astree Hyppeis Challenge")
- Päivämäärä
- Purjehtijamäärä: 4–12
- Venemäärä: 2–4
- Kisoja alkusarjassa: automaattisesti laskettu tai käsin asetettu

### Alkusarja
- Jokainen purjehtija purjehtii mahdollisimman monta kisaa tasaisesti
- Veneet jakautuvat tasaisesti per purjehtija
- Vastakkainasettelut jakautuvat mahdollisimman tasaisesti
- Jaksotus: ei pitkiä putkia eikä pitkiä taukoja
- Aikataulu generoidaan palvelimella kilpailun luonnissa

### Pisteytys
- 1. sija = 1 piste, 2. sija = 2 pistettä, ..., N. sija = N pistettä
- Vähiten pisteitä voittaa
- Tiebreak: eniten 1. sijoja → eniten 2. sijoja → eniten 3. sijoja

---

## Finaalisarja

### Fleet-malli
Fleettien määrä riippuu purjehtija- ja venemäärästä:
- Jokainen fleet = venemäärän verran purjehtijia
- Fleetit nimetään: Bronze, Silver, Gold (alhaalta ylös)
- Jos purjehtijat eivät jakaudu tasan: alin fleet saa loput

Esimerkki (10 purjehtijaa, 4 venettä):
- Bronze: sijat 7–10 (4 purjehtijaa)
- Silver: sijat 4–6 + bronze voittaja (4 purjehtijaa)
- Gold: sijat 1–3 + silver voittaja (4 purjehtijaa)

### Fleet-kilpailu
- Joka fleetissä purjehditaan venemäärän verran kisoja
- Jokainen purjehtii jokaisella veneellä täsmälleen kerran (Latin square)
- Veneiden jako arvotaan (satunnainen Latin square)

### Eteneminen
- Fleetit purjehditaan järjestyksessä: Bronze → Silver → Gold
- Jokaisen fleetin voittaja (vähiten pisteitä) nousee ylempään fleettiin
- Fleetin muut purjehtijat saavat lopullisen sijoituksensa fleetin tulosten perusteella

### Lopullinen kokonaissijoitus
- Gold fleet: sijat 1–N (N = venemäärä)
- Silver fleet (paitsi voittaja): seuraavat sijat
- Bronze fleet (paitsi voittaja): seuraavat sijat
- Jne. alaspäin

---

## Tietokantarakenne

### competitions
| Kenttä | Tyyppi | Kuvaus |
|--------|--------|--------|
| id | INTEGER PK | Autoincrement |
| name | TEXT | Kilpailun nimi |
| date | TEXT | Päivämäärä (YYYY-MM-DD) |
| num_sailors | INTEGER | Purjehtijamäärä (4–12) |
| num_boats | INTEGER | Venemäärä (2–4) |
| num_races | INTEGER | Kisoja alkusarjassa |
| created_at | TEXT | Luontiaika |

### comp_sailors
| Kenttä | Tyyppi | Kuvaus |
|--------|--------|--------|
| comp_id | INTEGER FK | Kilpailu |
| sailor_key | TEXT | Tunniste (A, B, C...) |
| name | TEXT | Purjehtijan nimi |
| PK | | (comp_id, sailor_key) |

### comp_boats
| Kenttä | Tyyppi | Kuvaus |
|--------|--------|--------|
| comp_id | INTEGER FK | Kilpailu |
| boat_key | INTEGER | Veneen numero (1, 2, 3...) |
| name | TEXT | Veneen nimi |
| PK | | (comp_id, boat_key) |

### comp_schedule
| Kenttä | Tyyppi | Kuvaus |
|--------|--------|--------|
| comp_id | INTEGER FK | Kilpailu |
| race_index | INTEGER | Kisan numero (0-based) |
| boat_key | INTEGER | Vene |
| sailor_key | TEXT | Purjehtija |
| PK | | (comp_id, race_index, boat_key) |

### comp_results
| Kenttä | Tyyppi | Kuvaus |
|--------|--------|--------|
| comp_id | INTEGER FK | Kilpailu |
| race_index | INTEGER | Kisan numero |
| sailor_key | TEXT | Purjehtija |
| position | INTEGER | Sijoitus (1–N) |
| PK | | (comp_id, race_index, sailor_key) |

### finals_schedule
| Kenttä | Tyyppi | Kuvaus |
|--------|--------|--------|
| comp_id | INTEGER FK | Kilpailu |
| fleet | TEXT | 'bronze', 'silver', 'gold' |
| race_index | INTEGER | 0-based |
| boat_key | INTEGER | Vene |
| sailor_key | TEXT | Purjehtija |
| PK | | (comp_id, fleet, race_index, boat_key) |

### finals_results
| Kenttä | Tyyppi | Kuvaus |
|--------|--------|--------|
| comp_id | INTEGER FK | Kilpailu |
| fleet | TEXT | Fleet |
| race_index | INTEGER | 0-based |
| sailor_key | TEXT | Purjehtija |
| position | INTEGER | Sijoitus |
| PK | | (comp_id, fleet, race_index, sailor_key) |

---

## API-rajapinta

### Kilpailut
- `GET /api/competitions` — listaa kaikki
- `POST /api/competitions` — luo uusi (body: {name, date, num_sailors, num_boats, num_races, sailors:[], boats:[]})
- `GET /api/competitions/:id` — kilpailun kaikki data (tiedot, purjehtijat, veneet, aikataulu, tulokset, finaalit)
- `DELETE /api/competitions/:id` — poista kilpailu

### Purjehtijat ja veneet
- `PUT /api/competitions/:id/sailors` — päivitä nimet
- `PUT /api/competitions/:id/boats` — päivitä nimet

### Tulokset
- `PUT /api/competitions/:id/results/:raceIndex` — tallenna kisan tulos
- `DELETE /api/competitions/:id/results/:raceIndex` — poista tulos

### Finaali
- `POST /api/competitions/:id/finals/generate/:fleet` — generoi fleetin aikataulu
- `PUT /api/competitions/:id/finals/results/:fleet/:raceIndex` — tallenna finaali tulos
- `DELETE /api/competitions/:id/finals/results/:fleet/:raceIndex` — poista
- `GET /api/competitions/:id/finals/standings` — finaali sijoitukset

---

## Aikataulu-algoritmi (server-side JavaScript)

### Alkusarjan generointi
Siirretty Python-algoritmista JavaScriptiin:
1. Ahne valinta: huomioi osallistumiset, paritasaisuus, jaksotus
2. Iteratiivinen optimointi (tuhansia yrityksiä, paras valitaan)
3. Venejakauman optimointi permutaatiohaulla

### Finaali Latin square
- 4×4 syklinen Latin square, rivit/sarakkeet/arvot satunnaistettu
- Takaa: jokainen purjehtija jokaisella veneellä kerran

---

## Frontend

### Näkymät
1. **Kilpailulista** — kaikki kilpailut, uuden luonti
2. **Alkusarja** — tulostaulu, tulosten syöttö, aikataulu, päiväohjelma
3. **Finaalisarja** — fleet-välilehdet, tulosten syöttö, eteneminen, kokonaissijoitus
4. **Asetukset** — purjehtijoiden ja veneiden nimien muokkaus

### Mobiilioptimointi
- Bottom nav (thumb zone)
- Min 44×44px kosketusalueet
- Vaakasuuntainen scroll taulukoissa
- Sticky-sarakkeet (nimi/sija)
- Safe area tuki (notch)

---

## Migraatio
Nykyinen data ("Astree Hyppeis Challenge" 16.5.2026) siirretään automaattisesti:
- Vanhat sailors/boats/results → uusi skeema competition_id=1 alle
- Kiinteä aikataulu → comp_schedule tauluun
