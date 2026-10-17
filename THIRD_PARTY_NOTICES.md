# Third-party notices

This integration is licensed under the Apache License 2.0 (see `LICENSE`). It
contains logic ported from the projects below, distributed under their own
license.

## aioengiebelgium

<https://github.com/DaanVervacke/aioengiebelgium>, by Daan Vervacke (version
0.8.1, commit a3e3a43).

Ported to JavaScript in `src/engie/auth.js`, `src/engie/api.js`,
`src/engie/model.js` and `src/constants.js`: the ENGIE Belgium sign-in over
HTTP (the OAuth 2 / PKCE parameters of the ENGIE Smart app, the Auth0 login
pages of `account.engie.be` and their hidden inputs, the markers of a refused
password or code, the SMS and e-mail second factor, the resume and callback
checks), the token grants (authorization code, refresh with rotation) and
their error taxonomy, the endpoints, parameters and user agents of the API
(`customer-account-relations`, `energy-contracts`, `supplier-energy-prices`,
`usage-details`, `account-balance`, `billing-period-bbp-details`), and the
meaning of their answers (time-of-use slot codes, usage, balance, budget
billing plan).

```
MIT License

Copyright (c) 2026 Daan Vervacke

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## hass-engie-be

<https://github.com/DaanVervacke/hass-engie-be>, the Home Assistant
integration built on aioengiebelgium, by Daan Vervacke (commit 1122475).

Ported in `src/engie/model.js` and `src/devices.js`: the choice of the price
period in force, the mapping of the time-of-use slots to sensors (the blended
`EN` rate left out), the energy type of a meter from its contract division.

```
MIT License

Copyright (c) 2025-2026 Daan Vervacke @DaanVervacke

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
