#!/usr/bin/env python3
"""
Purjehduskilpailujen aikatauluttaja ja tilastollinen malli.

10 purjehtijaa (A-J), 4 venettä (1-4), 20 kisaa.
Joka kisassa 4 purjehtijaa, yksi per vene.
Optimoi:
  - Jokainen purjehtii 8 kisaa (80 paikkaa / 10 purjehtijaa)
  - Veneet jakautuvat tasaisesti (8 kisaa / 4 venettä = 2 kertaa per vene)
  - Vastakkainasettelut jakautuvat mahdollisimman tasaisesti (ideaali 2-3)
  - Lähdöt jakautuvat tasaisesti päivään (ei putkia, ei pitkiä taukoja)
"""

import random
import itertools
import math
from collections import Counter, defaultdict

PURJEHTIJAT = list("ABCDEFGHIJ")
VENEET = [1, 2, 3, 4]
KISAT = 20
PURJEHTIJAT_PER_KISA = 4
KISOJA_PER_PURJEHTIJA = (KISAT * PURJEHTIJAT_PER_KISA) // len(PURJEHTIJAT)  # = 8
# Ideaali parien kohtaamiskerrat: 120 pari-ilmentymää / 45 paria = 2.667
IDEAALI_PARIT = (KISAT * 6) / 45

random.seed(42)


def laske_jaksotus_pisteet(aikataulu):
    """
    Laske kuinka tasaisesti purjehtijoiden lähdöt jakautuvat päivään.
    Rankaisee pitkiä putkia ja pitkiä taukoja.
    """
    pisteet = 0

    for p in PURJEHTIJAT:
        mukana = [1 if p in kisa else 0 for kisa in aikataulu]

        max_putki = 0
        putki = 0
        for m in mukana:
            if m:
                putki += 1
                max_putki = max(max_putki, putki)
            else:
                putki = 0

        max_tauko = 0
        tauko = 0
        for m in mukana:
            if not m:
                tauko += 1
                max_tauko = max(max_tauko, tauko)
            else:
                tauko = 0

        if max_putki >= 4:
            pisteet += (max_putki - 2) ** 3
        elif max_putki >= 3:
            pisteet += (max_putki - 2) ** 2

        if max_tauko >= 5:
            pisteet += (max_tauko - 3) ** 3
        elif max_tauko >= 4:
            pisteet += (max_tauko - 3) ** 2

        indeksit = [i for i, m in enumerate(mukana) if m]
        if len(indeksit) >= 2:
            valit = [indeksit[i+1] - indeksit[i] for i in range(len(indeksit)-1)]
            ideaali = KISAT / KISOJA_PER_PURJEHTIJA
            valivarianssi = sum((v - ideaali) ** 2 for v in valit) / len(valit)
            pisteet += valivarianssi

        keskipiste = sum(indeksit) / len(indeksit) if indeksit else 0
        ideaali_keskipiste = (KISAT - 1) / 2
        pisteet += abs(keskipiste - ideaali_keskipiste) * 0.5

    return pisteet


def laske_pari_varianssi(parit):
    """Laske parien kohtaamiskertojen varianssi — pienempi on parempi."""
    kaikki = list(itertools.combinations(sorted(PURJEHTIJAT), 2))
    arvot = [parit.get(p, 0) for p in kaikki]
    ka = sum(arvot) / len(arvot)
    return sum((v - ka) ** 2 for v in arvot) / len(arvot)


def luo_aikataulu_ahne():
    """
    Ahne algoritmi joka valitsee joka kisaan 4 purjehtijaa
    huomioiden osallistumiset, parit JA jaksotuksen.
    """
    osallistumiset = Counter()
    parit = Counter()
    aikataulu = []

    for kisa_idx in range(KISAT):
        # Kelpoiset purjehtijat (eivät ole ylittäneet rajaa)
        kelpoiset = [p for p in PURJEHTIJAT if osallistumiset[p] < KISOJA_PER_PURJEHTIJA]
        if len(kelpoiset) < 4:
            kelpoiset = sorted(PURJEHTIJAT, key=lambda p: osallistumiset[p])

        # Kokeile useita satunnaisia 4-kombinaatioita ja valitse paras
        paras_valinta = None
        paras_pisteet = float('inf')

        # Jos kelpoiset <= 6, kokeile kaikkia kombinaatioita
        if len(kelpoiset) <= 7:
            kandidaatit = list(itertools.combinations(kelpoiset[:7], 4))
        else:
            kandidaatit = [tuple(random.sample(kelpoiset, 4)) for _ in range(50)]

        for valinta in kandidaatit:
            # Pisteytä: paritasaisuus + jaksotus
            pist = 0

            # Parien tasaisuus: minimoi varianssi
            uudet_parit = Counter(parit)
            for p1, p2 in itertools.combinations(sorted(valinta), 2):
                uudet_parit[(p1, p2)] += 1

            # Rankaise pareja jotka ylittävät ideaalin paljon
            for p1, p2 in itertools.combinations(sorted(valinta), 2):
                arvo = uudet_parit[(p1, p2)]
                if arvo > 3:
                    pist += (arvo - 2) ** 3  # Kova rangaistus ylisuurille
                elif arvo > 2:
                    pist += 1

            # Suosi pareja joilla on vähän kohtaamisia
            for p1, p2 in itertools.combinations(sorted(valinta), 2):
                arvo = parit.get((p1, p2), 0)
                if arvo == 0:
                    pist -= 3  # Bonus: uusi pari
                elif arvo == 1:
                    pist -= 1

            # Jaksotus: rankaise peräkkäisiä
            for p in valinta:
                # Kuinka monta edellistä kisaa putkeen?
                putki = 0
                for k in range(len(aikataulu) - 1, -1, -1):
                    if p in aikataulu[k]:
                        putki += 1
                    else:
                        break
                if putki >= 2:
                    pist += (putki - 1) ** 2 * 5

                # Kuinka pitkä tauko on ollut?
                tauko = 0
                for k in range(len(aikataulu) - 1, -1, -1):
                    if p not in aikataulu[k]:
                        tauko += 1
                    else:
                        break
                if osallistumiset[p] > 0 and tauko >= 4:
                    pist += (tauko - 3) * 3

            if pist < paras_pisteet:
                paras_pisteet = pist
                paras_valinta = valinta

        valitut = list(paras_valinta)
        for p in valitut:
            osallistumiset[p] += 1
        for p1, p2 in itertools.combinations(sorted(valitut), 2):
            parit[(p1, p2)] += 1

        aikataulu.append(valitut)

    return aikataulu


def luo_aikataulu():
    """
    Generoi monta aikataulua ahneella algoritmilla ja valitse paras.
    """
    paras_aikataulu = None
    paras_pisteet = float('inf')

    for yritys in range(15000):
        random.seed(yritys)
        aikataulu = luo_aikataulu_ahne()

        # Pisteytä kokonaislaatu
        osallistumiset = Counter()
        parit = Counter()
        for kisa in aikataulu:
            for p in kisa:
                osallistumiset[p] += 1
            for p1, p2 in itertools.combinations(sorted(kisa), 2):
                parit[(p1, p2)] += 1

        os_arvot = list(osallistumiset.values())
        os_pisteet = max(os_arvot) - min(os_arvot)

        kaikki_parit = set(itertools.combinations(sorted(PURJEHTIJAT), 2))
        puuttuvat = len(kaikki_parit - set(parit.keys()))

        pari_arvot = [parit.get(p, 0) for p in kaikki_parit]
        pari_max_min = max(pari_arvot) - min(pari_arvot)
        pari_var = sum((v - IDEAALI_PARIT) ** 2 for v in pari_arvot) / len(pari_arvot)

        jaksotus = laske_jaksotus_pisteet(aikataulu)

        pisteet = (os_pisteet * 500
                   + puuttuvat * 300
                   + pari_max_min * 80
                   + pari_var * 40
                   + jaksotus * 3)

        if pisteet < paras_pisteet:
            paras_pisteet = pisteet
            paras_aikataulu = aikataulu

    return paras_aikataulu


def jaa_veneet(aikataulu):
    """
    Jaa veneet kisoissa niin että jokainen purjehtija purjehtii
    jokaisella veneellä mahdollisimman tasaisesti (tavoite: 2 kertaa per vene).
    """
    vene_laskuri = defaultdict(Counter)
    tulos = []

    for kisa_purjehtijat in aikataulu:
        paras_perm = None
        paras_pisteet = float('inf')

        for perm in itertools.permutations(range(4)):
            pisteet = 0
            for i, p_idx in enumerate(perm):
                purjehtija = kisa_purjehtijat[p_idx]
                vene = VENEET[i]
                nykyinen = vene_laskuri[purjehtija][vene]
                pisteet += (nykyinen + 1) ** 2

            if pisteet < paras_pisteet:
                paras_pisteet = pisteet
                paras_perm = perm

        kisa_tulos = {}
        for i, p_idx in enumerate(paras_perm):
            purjehtija = kisa_purjehtijat[p_idx]
            vene = VENEET[i]
            kisa_tulos[vene] = purjehtija
            vene_laskuri[purjehtija][vene] += 1

        tulos.append(kisa_tulos)

    return tulos, vene_laskuri


def tulosta_aikataulu(aikataulu_veneet):
    """Tulosta kisaaikataulu taulukkomuodossa."""
    print("=" * 70)
    print("PURJEHDUSKILPAILUJEN AIKATAULU")
    print(f"10 purjehtijaa (A-J) | 4 venettä (1-4) | {KISAT} kisaa")
    print("=" * 70)
    print()
    print(f"{'Kisa':>6} | {'Vene 1':>6} | {'Vene 2':>6} | {'Vene 3':>6} | {'Vene 4':>6} | Tauko")
    print("-" * 55)

    for i, kisa in enumerate(aikataulu_veneet):
        purjehtijat_kisassa = set(kisa.values())
        tauolla = sorted(set(PURJEHTIJAT) - purjehtijat_kisassa)
        tauko_str = " ".join(tauolla)
        print(f"{i+1:>6} | {kisa[1]:>6} | {kisa[2]:>6} | {kisa[3]:>6} | {kisa[4]:>6} | {tauko_str}")

    print()


def tulosta_purjehtijan_paiva(aikataulu_veneet):
    """Tulosta jokaisen purjehtijan päivä visuaalisesti."""
    print("=" * 70)
    print("PURJEHTIJOIDEN PÄIVÄOHJELMA")
    print("=" * 70)
    print()

    print(f"  {'':>3} ", end="")
    for i in range(1, KISAT + 1):
        print(f"{i:>3}", end="")
    print("   Kisat  Max   Max")
    print(f"  {'':>3} ", end="")
    for i in range(1, KISAT + 1):
        print(f"{'---':>3}", end="")
    print("   yht.  putki tauko")
    print()

    for p in PURJEHTIJAT:
        print(f"  {p:>3} ", end="")
        mukana_indeksit = []
        for i, kisa in enumerate(aikataulu_veneet):
            vene = None
            for v, purj in kisa.items():
                if purj == p:
                    vene = v
                    break
            if vene is not None:
                print(f" V{vene}", end="")
                mukana_indeksit.append(i)
            else:
                print(f"  · ", end="")

        mukana = [1 if i in mukana_indeksit else 0 for i in range(KISAT)]

        max_putki = 0
        putki = 0
        for m in mukana:
            if m:
                putki += 1
                max_putki = max(max_putki, putki)
            else:
                putki = 0

        max_tauko = 0
        tauko = 0
        for m in mukana:
            if not m:
                tauko += 1
                max_tauko = max(max_tauko, tauko)
            else:
                tauko = 0

        print(f"    {sum(mukana):>3}    {max_putki:>2}    {max_tauko:>2}")

    print()
    print("  V1-V4 = vene, · = tauko")
    print()


def tulosta_tilastot(aikataulu_veneet, vene_laskuri):
    """Tulosta tilastolliset analyysit."""

    osallistumiset = Counter()
    for kisa in aikataulu_veneet:
        for vene, purjehtija in kisa.items():
            osallistumiset[purjehtija] += 1

    print("=" * 70)
    print("TILASTOT")
    print("=" * 70)

    print("\n--- Kisat per purjehtija ---")
    for p in PURJEHTIJAT:
        bar = "█" * osallistumiset[p]
        print(f"  {p}: {osallistumiset[p]:>2} kisaa  {bar}")

    print("\n--- Venejakauma per purjehtija ---")
    print(f"  {'':>3} | {'V1':>3} | {'V2':>3} | {'V3':>3} | {'V4':>3} | Yhteensä")
    print("  " + "-" * 40)
    for p in PURJEHTIJAT:
        rivit = [vene_laskuri[p].get(v, 0) for v in VENEET]
        print(f"  {p:>3} | {rivit[0]:>3} | {rivit[1]:>3} | {rivit[2]:>3} | {rivit[3]:>3} | {sum(rivit):>8}")

    parit = Counter()
    for kisa in aikataulu_veneet:
        purjehtijat = list(kisa.values())
        for p1, p2 in itertools.combinations(sorted(purjehtijat), 2):
            parit[(p1, p2)] += 1

    print("\n--- Vastakkainasettelut (parit) ---")
    print(f"  Pareja yhteensä: {len(parit)}/45 (kaikki mahdolliset)")
    pari_arvot = list(parit.values())
    print(f"  Min kohtaamiset: {min(pari_arvot)}")
    print(f"  Max kohtaamiset: {max(pari_arvot)}")
    print(f"  Keskiarvo: {sum(pari_arvot)/len(pari_arvot):.2f}")
    print(f"  Ideaali: {IDEAALI_PARIT:.2f}")

    kaikki = list(itertools.combinations(sorted(PURJEHTIJAT), 2))
    arvot = [parit.get(p, 0) for p in kaikki]
    varianssi = sum((v - IDEAALI_PARIT) ** 2 for v in arvot) / len(arvot)
    print(f"  Varianssi: {varianssi:.3f}")

    # Jakauma
    jakauma = Counter(pari_arvot)
    print(f"  Jakauma: ", end="")
    for k in sorted(jakauma.keys()):
        print(f"{k} kohtaamista: {jakauma[k]} paria  ", end="")
    print()

    print("\n--- Parimatriisi (kohtaamiskerrat) ---")
    print(f"  {'':>3}", end="")
    for p in PURJEHTIJAT:
        print(f" {p:>2}", end="")
    print()

    for p1 in PURJEHTIJAT:
        print(f"  {p1:>3}", end="")
        for p2 in PURJEHTIJAT:
            if p1 == p2:
                print(f"  -", end="")
            else:
                avain = tuple(sorted([p1, p2]))
                print(f" {parit.get(avain, 0):>2}", end="")
        print()

    kaikki_parit = set(itertools.combinations(sorted(PURJEHTIJAT), 2))
    puuttuvat = kaikki_parit - set(parit.keys())
    if puuttuvat:
        print(f"\n  HUOM: Purjehtijat jotka EIVAT kohtaa toisiaan: {len(puuttuvat)}")
        for p in sorted(puuttuvat):
            print(f"    {p[0]} vs {p[1]}")
    else:
        print(f"\n  Kaikki purjehtijat kohtaavat toisensa vahintaan kerran!")

    print()


def jaksotusanalyysi(aikataulu_veneet):
    """Analysoi lähtöjen jakautuminen päivään."""
    print("=" * 70)
    print("JAKSOTUSANALYYSI")
    print("=" * 70)

    max_putket = []
    max_tauot = []

    for p in PURJEHTIJAT:
        mukana = []
        for kisa in aikataulu_veneet:
            mukana.append(1 if p in kisa.values() else 0)

        max_putki = 0
        putki = 0
        for m in mukana:
            if m:
                putki += 1
                max_putki = max(max_putki, putki)
            else:
                putki = 0
        max_putket.append(max_putki)

        max_tauko = 0
        tauko = 0
        for m in mukana:
            if not m:
                tauko += 1
                max_tauko = max(max_tauko, tauko)
            else:
                tauko = 0
        max_tauot.append(max_tauko)

    print(f"\n  Pisin peräkkäinen purjehdusputki:")
    print(f"    Keskiarvo: {sum(max_putket)/len(max_putket):.1f}")
    print(f"    Vaihteluväli: {min(max_putket)}-{max(max_putket)}")
    print(f"    Tavoite: max 2-3 peräkkäistä")

    print(f"\n  Pisin tauko (peräkkäiset vapaat kisat):")
    print(f"    Keskiarvo: {sum(max_tauot)/len(max_tauot):.1f}")
    print(f"    Vaihteluväli: {min(max_tauot)}-{max(max_tauot)}")
    print(f"    Tavoite: max 3 peräkkäistä vapaata")

    putki_ok = all(p <= 3 for p in max_putket)
    tauko_ok = all(t <= 4 for t in max_tauot)

    print(f"\n  Arvio:")
    if putki_ok and tauko_ok:
        print(f"    Erinomainen jaksotus!")
    elif putki_ok:
        print(f"    Putket OK, mutta joillain pitkähköjä taukoja")
    elif tauko_ok:
        print(f"    Tauot OK, mutta joillain pitkähköjä putkia")
    else:
        print(f"    Jaksotuksessa parannettavaa")

    print()


def tasaisuusanalyysi(vene_laskuri):
    """Analysoi kuinka tasaisesti veneet jakautuivat."""
    print("=" * 70)
    print("TASAISUUSANALYYSI")
    print("=" * 70)

    print("\n--- Venejakauman tasaisuus ---")
    vene_poikkeamat = []
    tavoite = KISOJA_PER_PURJEHTIJA / len(VENEET)

    for p in PURJEHTIJAT:
        arvot = [vene_laskuri[p].get(v, 0) for v in VENEET]
        poikkeama = sum((a - tavoite) ** 2 for a in arvot) / len(VENEET)
        vene_poikkeamat.append(poikkeama)
        tahdet = "***" if poikkeama == 0 else ("**" if poikkeama <= 0.5 else "*")
        print(f"  {p}: varianssi = {poikkeama:.2f}  {tahdet}")

    keskiarvo_var = sum(vene_poikkeamat) / len(vene_poikkeamat)
    print(f"\n  Keskimääräinen varianssi: {keskiarvo_var:.3f}")
    print(f"  (0.000 = täydellinen tasaisuus)")
    print()


if __name__ == "__main__":
    print("Optimoidaan kisaaikataulua (15000 iteraatiota)...")
    print("  - kisajakauma, paritasaisuus, venejakauma, jaksotus")
    aikataulu = luo_aikataulu()

    print("Optimoidaan venejakaumaa...")
    aikataulu_veneet, vene_laskuri = jaa_veneet(aikataulu)

    print()
    tulosta_aikataulu(aikataulu_veneet)
    tulosta_purjehtijan_paiva(aikataulu_veneet)
    tulosta_tilastot(aikataulu_veneet, vene_laskuri)
    jaksotusanalyysi(aikataulu_veneet)
    tasaisuusanalyysi(vene_laskuri)
