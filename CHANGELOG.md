# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- Sign-in to a residential ENGIE Belgium account with its e-mail and password,
  as the ENGIE Smart app does (Auth0 pages, PKCE), ported from
  aioengiebelgium. The verification code ENGIE asks for at each sign-in goes
  through two configuration buttons: "Send the verification code" (SMS or
  e-mail) and "Verify the code". The session is then kept in `/data` (the
  rotated refresh token, never the e-mail nor the password); the integration
  never signs in with the password by itself.
- Electricity device per meter: the prices of the contract in force (single,
  day and night with a dual-rate meter, injection; €/kWh, VAT included), the
  daily consumption fed, dated, to the Gladys energy monitoring with
  `publishEnergyConsumption` (Gladys 5.2+), the consumption and the injection
  of the last published day as plain sensors.
- "Sensor only" option for the daily electricity consumption, for homes where
  Fluvius or another meter integration already feeds the energy monitoring.
- Gas device per meter: the gas price and the consumption of the last
  published day as plain sensors (never in the energy monitoring).
- Account device per contract: the open amount and its next due date, the
  amount and the date of the next advance invoice.
- One read every 6 hours, a token-only refresh every hour; secondary reads
  that fail keep their previous values; a 429 pauses every call (1 minute to
  6 hours, kept across restarts); a refused fresh token is tried again after
  6 h, 12 h, then every 24 h.
- "Test the connection" button. Documentation in English, French and Dutch;
  `THIRD_PARTY_NOTICES.md` with the MIT licenses of aioengiebelgium and
  hass-engie-be, shipped in the image.

[Unreleased]: https://github.com/LM1LC3N7/gladys-engie-belgium/commits/main
