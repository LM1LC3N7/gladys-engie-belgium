# TODO

## Before announcing

- [ ] Test on a real Gladys 5.2+ with a real residential ENGIE Belgium account
      (ideally a dedicated ENGIE user; electricity dual-rate with injection,
      gas): the two code buttons (SMS and e-mail), the devices, the prices,
      the daily consumption in the energy monitoring, the gas sensor, the
      account device, a restart (no code asked), a keep-alive night.
- [ ] Test the Docker image (no Docker on the development PC yet).
- [ ] Turn on "Private vulnerability reporting" (SECURITY.md points there).
- [ ] Add the `gladys-assistant-integration` topic to publish in the store
      (after the first release: the store validator needs the GHCR image).

## To confirm on a real account (built without one)

- [ ] The Auth0 flow still matches aioengiebelgium 0.8.1: authorize ->
      identifier -> password -> resume -> `/u/mfa-sms-challenge` (or the
      e-mail switch) -> code -> resume -> `be.engie.smart://` callback.
- [ ] The passkey-enrollment interstitial the library's Bruno collection
      mentions after the code (outcome B of step 9) is not handled (the
      library's code does not handle it either): it would show "The ENGIE
      sign-in pages changed".
- [ ] Does the GET of `/u/mfa-sms-challenge` send the SMS (assumed, as in the
      library)? Does the e-mail switch still use `email::1`?
- [ ] The lifetime of the refresh token without use: the hourly token-only
      refresh is a guess (Home Assistant refreshes every minute). If a
      session dies overnight, shorten `KEEP_ALIVE_INTERVAL`.
- [ ] The cookies of the Auth0 pages are enough with this small jar (host and
      `Domain` only, no path matching).
- [ ] `usage-details` with `granularity=DAILY` and `includeSimulation=false`:
      the days are local days (`start` with a +01:00 / +02:00 offset), the
      complete ones have `partialData: false` (partial days are skipped, and
      come back once complete).
- [ ] `supplier-energy-prices`: the slot codes of a dual-rate contract
      (`S_TOU1_OFFTAKE_PEAK` / `OFFPEAK` assumed day / night), the meaning of
      `TOTAL_HOURS` next to them, an exclusive night meter (`EN`, left out),
      the gas EAN in the same answer.
- [ ] `account-balance.overview.openAmount` is what the customer owes;
      `billing-period-bbp-details.budgetBillingPlan.currentAmount` and
      `nextPartialInvoiceDate` are the advance invoice amount and date.
- [ ] The energy-contracts division of each EAN (`_ID1`, `_ID2` suffixes).
- [ ] The daily consumption feature is attached by the core to the main
      electric meter as expected.

## Decisions

- **Versions**: 0.1.0 set once by hand when leaving the template (package,
  lock file, manifest, image tag `ghcr.io/lm1lc3n7/gladys-engie-belgium:0.1.0`),
  as for the sibling integrations; the Release workflow owns them from now on
  (the first patch release gives 0.1.1).
- **Reused project**: no JavaScript ENGIE Belgium client exists;
  aioengiebelgium 0.8.1 (MIT, Daan Vervacke, commit a3e3a43, the library of
  the Home Assistant integration) is ported (sign-in, tokens, endpoints,
  parsers), and hass-engie-be (MIT, commit 1122475) for the price sensors
  (period in force, slots, `EN` left out). Both licenses are reproduced in
  `THIRD_PARTY_NOTICES.md`, copied into the image. The SDK stays the only
  runtime dependency (PKCE with `node:crypto`, a tiny cookie jar). The
  Apache-2.0 `LICENSE` is the standard text without a name, as gladys-tedee.
- **Second factor in two buttons** (the gladys-picnic model): ENGIE asks for a
  code at each sign-in, so the integration never signs in by itself: only
  "Send the verification code" posts the password (one code a minute at
  most, kept in `/data`). The waiting sign-in (Auth0 cookies, PKCE verifier)
  stays in memory only, 10 minutes at most: a restart between the two
  buttons needs a new code, rather than writing those to disk. If ENGIE asks
  for no code, the sign-in completes at the first button.
- **Session**: the refresh token only is kept in `/data/engie-state.json`
  (0600), with a hash of the e-mail (a session of another e-mail is never
  used); the access token (about 2 minutes) stays in memory. The token
  rotates at each refresh: written before use. A dead refresh token
  (`invalid_grant`, 401) drops the session and waits for the buttons: a new
  code is needed anyway (no timer is useful there; the status says what to
  do). A changed password with the same e-mail keeps the session.
- **Keep-alive**: a token-only refresh every hour (no data read), skipped
  during a pause, a block or a read. Its passing failures are only logged; a
  429 or a dead token are handled as anywhere.
- **Schedule**: one read every 6 hours (ENGIE updates at most daily) plus one
  at start and after a code is accepted; the 7 local days before today of
  usage each time (the core upserts by date).
- **Errors**: 429 → every path (reads, keep-alive, buttons) paused,
  Retry-After bounded to 1 min .. 6 h (15 min without it), the end kept in
  `/data`; a 429 during a cycle stops the reads still to come, what was read
  is published, then the pause applies; the regular read during a pause
  plans one read at its end. 401 on a data call → one refresh and one retry;
  refused again → `session_refused`: new tries after 6 h, 12 h, then every
  24 h (bounded, kept in `/data`, the test button is one try). Any other
  failure (network, 5xx, changed pages) → the next regular read (6 h), never
  sooner (lesson "an error is never read again faster than the interval");
  the test button tries at once.
- **Main and secondary data**: the account relations are the main read (a
  failure fails the cycle). Contracts, prices, usage, balance and budget plan
  are each secondary: a failure keeps the previous values, never blocks the
  others, and is named in the status. The EAN -> division map of the
  contracts is kept when that read fails; an EAN without a division takes the
  only energy of its agreement, else it is left out.
- **Energy monitoring**: only the daily electricity offtake, through
  `publishEnergyConsumption` (`daily-consumption`, Gladys >= 5.2.0), only for
  a created device, never in `publishStates`. The usage is per business
  agreement: it goes to the electricity meter only when the agreement has
  exactly one. Days ending after now or flagged `partialData` are skipped.
- **Gas never in publishEnergyConsumption** (the core would attach it to the
  main electric meter and bill it at the electricity tariff): gas
  consumption of the last published day as a plain `unknown` sensor (kWh in
  the name).
- **No double counting with Fluvius**: a `consumption` option (default
  `energy_monitoring`, else `sensor_only`): with `sensor_only` the electricity
  device has no consumption feature and nothing is published to the
  monitoring. Documented in the manifest and the docs (fr/en/nl).
- **Prices**: `currency` / `decimal` / `euro` sensors (€/kWh in the name), VAT
  included (`priceValue`), the period covering today (else the latest
  started, never a future one). Features follow the slots present when the
  device is built: `price` (TOTAL_HOURS), `price_day` (PEAK), `price_night`
  (OFFPEAK), `injection_price`; no price feature for a meter without prices
  (dynamic contract). The integration does not declare a Gladys energy
  contract (the user enters it in the energy monitoring).
- **Account device** per business agreement: `open_amount` (overview
  `openAmount`, euro), `next_due_date` (earliest future due date with an
  open amount, `text`), `advance_amount` (budget plan `currentAmount`, else
  `monthlyAmount`), `next_advance_date` (`nextPartialInvoiceDate`, `text`).
  Gladys has no date feature: `text` as gladys-picnic.
- **Units** (core `DEVICE_FEATURE_UNITS_BY_CATEGORY`): `currency` → euro,
  `energy-sensor` → kilowatt-hour, none for `unknown` and `text`.
- **External ids**: `electricity:<EAN>`, `gas:<EAN>` (bare 18-digit EAN, the
  `_ID1` suffix removed), `account:<business agreement number>`.
- **Hostile answers**: bodies read up to 1 MiB, HTML parsed with `indexOf`
  and short bounded slices (no backtracking regex on a body), 50 cookies at
  most, lists read up to 500 entries, every number checked and bounded, the
  business agreement number checked (digits) before it enters a path.
- **Logs and statuses** carry only our own messages and HTTP status codes,
  never a URL, a body, a remote text, the e-mail, the password, a code or a
  token (tested).
- **Republished at each `connected`**: the discovered devices, the last
  status and every state (the SDK's memory of published states is cleared);
  the pauses, the blocks and the session are kept.
- **Runtime texts** in English and French; manifest and docs also in Dutch.
- **Time zone**: Europe/Brussels for the days, the usage window and the
  price period.

### After the review (Milestone 1 fixes)

- **Passing failures** (network, timeout, 5xx, a broken answer) are tried
  again after 15 min, 30 min, 1 h, 2 h, 4 h (each bounded by the 6-hour
  read), reset by a success; changed pages, a refused password, a 4xx, a 429
  and a refused session keep their own rules (this replaces "the next
  regular read" for passing failures only).
- **Keep-alive under the same exclusivity as a read** (`running`); a refresh
  binds its session and account at the start and its result is dropped if the
  session changed meanwhile; a rotated token is written only under the
  account it was obtained for. `start()` waits for `stop()`, which waits (5 s
  at most) for the read, the refresh and the writes to /data in progress.
- **Refreshes always use the full HTTP timeout** (20 s), buttons included
  (they are bounded by their 50 s answer instead): a token rotated by ENGIE
  and lost to a short timeout would kill the session.
- **No ghost meter**: only ACTIVE contracts give an EAN its division; an EAN
  of the prices without a contract is guessed from the only energy of the
  agreement only while its contracts were never read, else left out.
- **Partial days**: kept when older than 3 days (ENGIE also flags final days
  as partial); recent ones wait.
- **Refused password**: "Send the verification code" refuses at once (no
  request) until the e-mail or the password changes (a fingerprint in
  memory, never the password).
- **401 on the resume after the code** -> "sign-in expired" (send again).
- **Waiting sign-in** forgotten by a timer after 10 minutes (cookies, PKCE).
- **Dates read back from /data bounded** (pause <= 6 h, new try <= 24 h,
  last code <= now).
- **Failed write to /data**: logged as an error (no path, no content) and
  shown in the status; the file is fsynced before the rename.
- **A 401 of one endpoint with a token the others accepted** stays a
  secondary failure (not a refused session).
- **User agents** end with `gladys-engie-belgium/<version>`.
- **A 400 of publishEnergyConsumption** (Gladys clock behind Brussels): sent
  again without the latest day.
- **Price feature** only when ENGIE gives a single-rate price.

### After the approval round 1

- **A start waits for every job without bound** (`stop({ bounded: false })`):
  a button, a read or a refresh in progress always ends before the session
  and the account are swapped; only the shutdown is bounded (5 s). Each
  button also binds its account when pressed: a result for another account
  is dropped (no session set, no block lifted, nothing written).
- **A read due during the hourly refresh** runs right after it.
- **Saving new credentials** lifts a password refusal.
- **An empty answer of the contracts** teaches nothing: the guess of the
  meters stays possible.

## Ideas

- The gas in the energy monitoring once the core handles gas contracts.
- Hourly usage (the API has it) for a 30-minute consumption feature.
- The EPEX prices of dynamic contracts (public endpoint), the capacity tariff
  peaks, the Happy Hours (read only).
