# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration**: a Node.js service (Node 22+, ESM,
no build step) that runs in its own sandboxed Docker container and talks to
Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js),
its only runtime dependency. It started from the official JavaScript template.

It reads a residential **ENGIE Belgium** account through the unofficial API
of the ENGIE Smart app: the Auth0 sign-in of `account.engie.be` (e-mail,
password, PKCE, a code by SMS or e-mail at each sign-in), then read-only GETs
on `api.engie.be`. The flow and the meaning of the answers are ported from
[aioengiebelgium](https://github.com/DaanVervacke/aioengiebelgium) and
[hass-engie-be](https://github.com/DaanVervacke/hass-engie-be) (MIT, see
`THIRD_PARTY_NOTICES.md`). Siblings: `gladys-fluvius` (energy monitoring),
`gladys-picnic` (two-step verification in two buttons).

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/app.test.js              # one file
node --test --test-name-pattern "429"     # tests whose name matches
npm run audit                             # npm audit --omit=dev
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npx github:GladysAssistant/integration-store .   # store admission checks
```

The CI (`.github/workflows/ci.yml`) runs `format:check`, `lint` and `test` on
Node 22 and 24, and builds the Docker image: run the three commands before
pushing.

## Architecture

```
index.js                          SDK wiring only (src/handlers.js), before connect()
src/handlers.js                   every handler -> EngieApp (shared with the tests)
src/app.js                        EngieApp: schedule, reads, devices, states, energy
                                  monitoring, errors and pauses, the three buttons
src/engie/auth.js                 the Auth0 sign-in, the second factor, the token grants
src/engie/api.js                  the client: token pair and rotation, GETs, 401 rule
src/engie/model.js                answers -> agreements, meters, prices, usage, billing (pure)
src/devices.js                    the devices, feature keys, states (pure)
src/store.js                      /data: refresh token, pauses, code cooldown
src/config.js                     DEFAULTS (mirror the manifest defaults) + normalization
src/constants.js                  endpoints, client id, pacing, action keys
src/i18n.js                       runtime texts (en/fr)
src/http.js                       the only HTTP access (cookie jar, no blind redirect, bounded body)
gladys-assistant-integration.json manifest: name, config_schema, actions, image...
docs/en.md, docs/fr.md, docs/nl.md user documentation
test/                             node --test, against the SDK's fake Gladys and a fake ENGIE
.github/scripts/release.mjs       release helpers (manifest bump, changelog), tested in test/
```

## Rules

- **Read only**: GETs only on the API; `onSetValue` refuses. Never add a
  write call (the library has some: Happy Hours activation, never ported).
- **Never a password sign-in by itself**: each sign-in sends an SMS or an
  e-mail. Only the "Send the verification code" button signs in; the
  automatic path only refreshes the token. A dead refresh token
  (`invalid_grant`) waits for the buttons.
- **The refresh token rotates**: every new pair is written to `/data`
  (`onTokens`) before it is used; one refresh at a time.
- **Energy monitoring**: the daily electricity offtake goes ONLY through
  `publishEnergyConsumption`, never `publishStates`, no index feature. The
  gas NEVER goes there (the core would bill it at the electricity tariff),
  nor the injection: plain sensors.
- **Be polite with ENGIE**: one read every 6 hours, a token refresh every
  hour; a 429 pauses every path (1 min to 6 h, kept in `/data`); an error is
  never read again sooner than the next regular read; a refused fresh token
  is tried again after 6 h, 12 h, then every 24 h (kept in `/data`).
- **A secondary read never blocks the main data**: only the account
  relations fail a cycle; any other read keeps its previous values.
- **Secrets**: the password goes to `account.engie.be` only (`isAllowedUrl`:
  https, `account.engie.be`, `api.engie.be`). Never log or show a URL, a
  body, a header, the e-mail, the password, a code, a token, or any text of
  an ENGIE answer (only our own messages and status codes).
- **External ids are forever**: `electricity:<EAN>`, `gas:<EAN>`,
  `account:<business agreement number>`, the `FEATURE` keys of
  `src/devices.js`, the manifest keys. Changing one creates a new device and
  orphans the old one.
- **Units**: only those the core lists for the category (`currency`: euro,
  `energy-sensor`: kilowatt-hour; none for `unknown` and `text`). Units and
  types are fixed at creation.
- **The container rootfs is read-only.** Write only under `/data`.
- **Versions belong to the Release workflow** (Actions → Release). Never edit
  `version` in `package.json` or in the manifest, nor the `docker_image` tag,
  by hand. `test/manifest.test.js` checks they agree.
- **Changelog.** Every user-visible change adds a line under `## [Unreleased]`
  in `CHANGELOG.md`. Never write a version heading.
- **Manifest.** Texts are `{ "en", "fr", "nl" }` objects. The catalog
  `description` holds 10 to 100 characters per language.
- **User-facing text**: English and French everywhere (runtime messages,
  manifest, docs), Dutch in the manifest and `docs/nl.md`. Files are UTF-8
  without BOM (`test/encoding.test.js`, which also covers `src/`).
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never touch the network.
