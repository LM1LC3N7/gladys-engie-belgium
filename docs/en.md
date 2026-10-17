# ENGIE Belgium for Gladys Assistant

**Unofficial** integration, not affiliated with ENGIE. It uses the unofficial
API of the ENGIE Smart app (the one of the aioengiebelgium library and of the
Home Assistant integration `hass-engie-be`). **It was never tested with a real
account**: the ENGIE answers were rebuilt from those projects. Please report
any problem on GitHub.

## What it does

Read only, every 6 hours (ENGIE updates its data at most once a day):

- **The electricity prices of your contract** (€/kWh, VAT included): single
  rate, day and night rates with a dual-rate meter, the injection rate if you
  have one.
- **The gas price** (€/kWh, VAT included).
- **The daily electricity consumption**, sent, dated, to the Gladys **energy
  monitoring** (Gladys 5.2 or later), with ENGIE's delay (usually two days or
  more). The consumption and the injection of the last published day are also
  shown as plain sensors.
- **The gas consumption** of the last published day, as a **plain sensor**: the
  gas never enters the energy monitoring (Gladys would bill it at the
  electricity tariff).
- **Account**: the open amount to pay and its next due date, the amount and the
  date of the next advance invoice.

Nothing is ever changed on your ENGIE account.

## Before you start

- Gladys 5.2.0 or later.
- A residential ENGIE Belgium account with two-step verification (ENGIE sends
  a code by SMS or e-mail at each sign-in).
- **Strongly advised: an ENGIE user dedicated to Gladys.** Otherwise, each
  sign-in with the same user on engie.be or in the ENGIE Smart app may end the
  session of Gladys and ask for a new code (as seen by the Home Assistant
  integration). You can create another user from
  your ENGIE space (access management) and give it access to your customer
  number.
- The daily consumption needs a digital meter.

## Setup

1. Install the integration from the Gladys store.
2. In its configuration, enter the ENGIE **e-mail** and **password**, choose
   where the electricity consumption goes (see below), then **save**.
3. Press **Send the verification code** and choose SMS or e-mail: the
   integration signs in and ENGIE sends you a code.
4. Within 10 minutes, type the code in **Verify the code**.
5. The first read happens at once. Add the devices from the **Discover** tab:
   one per meter (electricity, gas) and one per contract.

The session is then kept: no code at the next restarts. If ENGIE ends it, the
integration status says so: do steps 3 and 4 again.

**Test the connection** reads the account once with the kept session, without
a code.

## Fluvius and the electricity consumption

If the **Fluvius** integration (or another meter integration) already sends
your electricity consumption to the energy monitoring, **do not use both for
the same consumption**: it would be counted twice. Then choose **Sensor only**
in "Daily electricity consumption" **before** creating the ENGIE electricity
device: it gets no consumption feature for the energy monitoring, only the
sensor of the last published day. Changing this later needs the device deleted
and created again.

## The devices

| Device                   | Features                                                                                                                                                 |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ENGIE electricity (EAN…) | Price, day price, night price, injection price (€/kWh); daily consumption (energy monitoring); consumption and injection of the last published day (kWh) |
| ENGIE gas (EAN…)         | Gas price (€/kWh); consumption of the last published day (kWh)                                                                                           |
| ENGIE account (…)        | Open amount (€), next due date, advance invoice amount (€), next advance invoice                                                                         |

The prices present depend on your contract when the device is created (a
dynamic contract has no fixed price: no price feature). The prices are
sensors: the integration does not declare an energy contract in Gladys; enter
your contract in the energy monitoring if you want the cost.

## Privacy and security

- The password is kept by Gladys in its database (**not encrypted**), never
  shown again, and only sent to ENGIE (account.engie.be), when you press "Send
  the verification code".
- The **session token** (refresh token) is kept in `/data` of the container (a
  file only the container user can read), with a hash of the e-mail, never the
  e-mail nor the password. It changes at each renewal.
- No e-mail, password, code, token or text sent back by ENGIE is written to the
  logs.

## Pace and errors

- One read every 6 hours; a renewal of the session (no data read) every hour to
  keep it alive.
- ENGIE asks to slow down (429): every call (reads, buttons) waits for the
  delay asked, between 1 minute and 6 hours, even after a restart.
- A secondary data (consumption, balance, advance, contracts) that fails keeps
  its previous value; the other data are read anyway, except after a 429,
  which pauses everything.
- A passing error (network, ENGIE unavailable): new try in 15 min, then
  30 min, 1 h, 2 h, 4 h (never beyond 6 h).
- Any other error: new try at the next read (within 6 hours), or with **Test
  the connection**.
- A fresh token refused: new try in 6 h, then 12 h, then every 24 h.

## Limits

- Unofficial API: ENGIE may change it at any time.
- Never tested with a real account.
- The consumption comes with ENGIE's delay; a day ENGIE marks incomplete is
  sent later, once complete, or as it is when older than 3 days (it will not
  change any more).
- Several electricity (or gas) meters on one contract: the consumption, given
  per contract, is not split (only the prices are read).
- Time zone: Europe/Brussels for the days; set Gladys to the same clock
  (Brussels, Paris, Amsterdam).

## Credits

Logic ported from [aioengiebelgium](https://github.com/DaanVervacke/aioengiebelgium)
and [hass-engie-be](https://github.com/DaanVervacke/hass-engie-be), by Daan
Vervacke (MIT license, see `THIRD_PARTY_NOTICES.md`).
