# ENGIE België voor Gladys Assistant

**Niet-officiële** integratie, niet verbonden met ENGIE. Ze gebruikt de
niet-officiële API van de ENGIE Smart-app (die van de bibliotheek
aioengiebelgium en van de Home Assistant-integratie `hass-engie-be`). **Ze is
nooit getest met een echt account**: de antwoorden van ENGIE zijn nagebouwd
op basis van die projecten. Meld problemen op GitHub.

## Wat ze doet

Alleen lezen, elke 6 uur (ENGIE werkt zijn gegevens hoogstens één keer per
dag bij):

- **De elektriciteitsprijzen van uw contract** (€/kWh, btw inbegrepen):
  enkelvoudig tarief, dag- en nachttarief met een tweevoudige meter, het
  injectietarief als u er een hebt.
- **De gasprijs** (€/kWh, btw inbegrepen).
- **Het dagelijkse elektriciteitsverbruik**, gedateerd naar de
  **energiemonitoring** van Gladys gestuurd (Gladys 5.2 of nieuwer), met de
  vertraging van ENGIE (meestal twee dagen of meer). Het verbruik en de
  injectie van de laatst gepubliceerde dag worden ook als gewone sensoren
  getoond.
- **Het gasverbruik** van de laatst gepubliceerde dag, als **gewone sensor**:
  gas gaat nooit naar de energiemonitoring (Gladys zou het tegen het
  elektriciteitstarief aanrekenen).
- **Account**: het openstaande bedrag en de volgende vervaldag, het bedrag en
  de datum van de volgende voorschotfactuur.

Er wordt nooit iets gewijzigd aan uw ENGIE-account.

## Vooraf

- Gladys 5.2.0 of nieuwer.
- Een particulier ENGIE België-account met tweestapsverificatie (ENGIE stuurt
  bij elke aanmelding een code per sms of e-mail).
- **Aangeraden: een aparte ENGIE-gebruiker voor Gladys.** Aanmelden met
  dezelfde gebruiker op engie.be of in de ENGIE Smart-app kan de sessie van
  Gladys beëindigen. U kunt een extra gebruiker aanmaken in uw ENGIE-omgeving
  (toegangsbeheer) en die toegang geven tot uw klantnummer.
- Het dagelijkse verbruik vraagt een digitale meter.

## Installatie

1. Installeer de integratie vanuit de Gladys-store.
2. Vul in de configuratie het ENGIE-**e-mailadres** en **wachtwoord** in, kies
   waar het elektriciteitsverbruik naartoe gaat (zie hieronder) en **sla op**.
3. Druk op **Verificatiecode versturen** en kies sms of e-mail: de integratie
   meldt zich aan en ENGIE stuurt u een code.
4. Vul die code binnen 10 minuten in bij **Code controleren**.
5. De eerste lezing gebeurt meteen. Voeg de toestellen toe via het tabblad
   **Ontdekken**: één per meter (elektriciteit, gas) en één per contract.

De sessie wordt daarna bewaard: geen code bij volgende herstarts. Als ENGIE ze
beëindigt, meldt de status van de integratie het: herhaal stappen 3 en 4.

## Fluvius en het elektriciteitsverbruik

Als de **Fluvius**-integratie (of een andere meterintegratie) uw
elektriciteitsverbruik al naar de energiemonitoring stuurt, **gebruik dan niet
beide voor hetzelfde verbruik**: het zou dubbel worden geteld. Kies dan
**Enkel sensor** bij "Dagelijks elektriciteitsverbruik" **vóór** u het
ENGIE-elektriciteitstoestel aanmaakt.

## Privacy

Het wachtwoord wordt door Gladys in haar database bewaard (**niet
versleuteld**), nooit opnieuw getoond en enkel naar ENGIE (account.engie.be)
gestuurd. De sessietoken (refresh token) staat in `/data` van de container,
nooit het e-mailadres of het wachtwoord. Geen geheim en geen tekst van ENGIE in
de logboeken.

## Tempo en fouten

Eén lezing per 6 uur, een sessievernieuwing per uur. Vraagt ENGIE om te
vertragen (429), dan wachten alle oproepen 1 minuut tot 6 uur, ook na een
herstart. Een mislukte bijkomende lezing (verbruik, saldo, voorschot) houdt
haar vorige waarde en blokkeert de prijzen nooit.

## Beperkingen

Niet-officiële API, nooit getest met een echt account; het verbruik komt met
de vertraging van ENGIE; tijdzone Europe/Brussels.

## Dank

Logica overgenomen van [aioengiebelgium](https://github.com/DaanVervacke/aioengiebelgium)
en [hass-engie-be](https://github.com/DaanVervacke/hass-engie-be), door Daan
Vervacke (MIT-licentie, zie `THIRD_PARTY_NOTICES.md`).
