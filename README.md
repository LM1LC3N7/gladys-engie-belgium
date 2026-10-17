# gladys-engie-belgium

[Gladys Assistant](https://gladysassistant.com) external integration for
**ENGIE Belgium** (residential accounts): the electricity and gas prices of
your contract, the daily electricity consumption fed, dated, to the Gladys
energy monitoring, the gas consumption of the last published day, the open
amount and the advance invoices. Read only.
**Unofficial API, not affiliated with ENGIE. Never tested with a real
account.**

User documentation: [docs/en.md](docs/en.md) · [docs/fr.md](docs/fr.md) ·
[docs/nl.md](docs/nl.md).

## How it works

```
Gladys ⇄ SDK ⇄ src/handlers.js ⇄ src/app.js (EngieApp)
                 ├─ src/engie/auth.js   Auth0 sign-in over HTTP (PKCE), SMS / e-mail code, token grants
                 ├─ src/engie/api.js    token pair (rotation), read-only GETs, 401 rule
                 ├─ src/engie/model.js  answers -> agreements, meters, prices, daily usage, billing (pure)
                 ├─ src/devices.js      the devices and their states (pure)
                 ├─ src/store.js        /data: refresh token, pauses (never the e-mail nor the password)
                 └─ src/http.js         the only HTTP access (cookies, no blind redirect, bounded body)
```

- **Sign-in** (as the ENGIE Smart app): the Auth0 pages of
  `account.engie.be` (authorize with PKCE, e-mail, password, resume), then the
  second factor ENGIE asks for at each sign-in: a code by SMS or e-mail,
  through two configuration buttons (_Send the verification code_, _Verify the
  code_). The code is exchanged for a token pair; the refresh token rotates at
  each use and is written to `/data` before it is used. The integration never
  signs in with the password by itself (each sign-in sends an SMS): a dead
  session waits for the buttons.
- **Reads** (`api.engie.be`, Bearer), every 6 hours: the account relations
  (business agreements, the main read), then per agreement the energy
  contracts (EAN -> electricity / gas), the supplier prices (the period in
  force: single, day, night, injection), the daily usage of the last 7 days,
  the account balance and the budget billing plan. Each read after the first
  is secondary: its failure keeps the previous values. A token-only refresh
  every hour keeps the session alive (the access token lives ~2 minutes).
- **Energy monitoring**: the daily electricity offtake through
  `publishEnergyConsumption` (`daily-consumption`, Gladys >= 5.2.0), never
  `publishStates`, never an index; incomplete days are left for a later read.
  The gas and the injection are plain sensors (never billed). A "sensor only"
  option keeps the consumption out of the monitoring when Fluvius or another
  meter integration already feeds it.
- **Errors**: 429 -> every path paused (Retry-After, 1 min to 6 h), kept in
  `/data`; 401 -> one refresh and one retry, then spaced new tries (6 h, 12 h,
  24 h, kept in `/data`); a dead refresh token -> a new code is asked; any
  other failure -> the next regular read, never sooner. Bodies read up to
  1 MiB, HTML parsed linearly, no remote text in a log or a status.

## Credits

The sign-in, the endpoints and the meaning of the answers are ported from
[aioengiebelgium](https://github.com/DaanVervacke/aioengiebelgium) and
[hass-engie-be](https://github.com/DaanVervacke/hass-engie-be) by Daan
Vervacke (MIT, see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)). Modelled
on the sibling integrations
[gladys-fluvius](https://github.com/LM1LC3N7/gladys-fluvius) (energy
monitoring) and [gladys-picnic](https://github.com/LM1LC3N7/gladys-picnic)
(two-step verification in two buttons).

## Development

```bash
npm install
npm test                                        # node --test, no network
npm run lint && npm run format:check
npm run audit                                   # npm audit --omit=dev
npx github:GladysAssistant/integration-store .  # store admission checks
```

Tests never touch the network: the ENGIE pages and answers are synthetic,
shaped after the fixtures of aioengiebelgium. Gladys is the SDK's fake.

## Releasing

**Actions → Release → Run workflow** (patch / minor / major): bumps the
version in `package.json` and the manifest, rolls `CHANGELOG.md`, tags, builds
the multi-arch image to GHCR and publishes the GitHub Release.

## License

Apache-2.0 (`LICENSE`). The logic ported from aioengiebelgium and
hass-engie-be remains under its MIT license, reproduced in full in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) (also shipped in the Docker
image).
