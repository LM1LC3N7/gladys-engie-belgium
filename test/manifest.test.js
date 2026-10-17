// -----------------------------------------------------------------------------
// The manifest is the contract with Gladys and the store: these tests tie it
// to the code, so a key renamed on one side only fails here.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CONSUMPTION, DEFAULTS } from '../src/config.js';
import { ACTIONS, CODE_CHANNELS } from '../src/constants.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const manifest = JSON.parse(read('gladys-assistant-integration.json'));
const pkg = JSON.parse(read('package.json'));
const lock = JSON.parse(read('package-lock.json'));
const handlers = read('src/handlers.js');
const dockerfile = read('Dockerfile');

function* texts(node, path = '') {
  if (Array.isArray(node)) {
    for (const [i, item] of node.entries()) {
      yield* texts(item, `${path}[${i}]`);
    }
  } else if (node && typeof node === 'object') {
    if ('en' in node || 'fr' in node) {
      yield [path, node];
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      yield* texts(value, `${path}.${key}`);
    }
  }
}

test('the store basics', () => {
  assert.equal(manifest.manifest_version, 1);
  assert.equal(manifest.type, 'device');
  assert.match(manifest.gladys_version, />=5\.2\.0/, 'publishEnergyConsumption needs Gladys 5.2');
  assert.equal(manifest.docker_image, `ghcr.io/lm1lc3n7/gladys-engie-belgium:${manifest.version}`);
  assert.equal(manifest.version, pkg.version);
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[''].version, pkg.version);
  assert.deepEqual(manifest.categories, ['energy']);
  for (const lang of ['en', 'fr', 'nl']) {
    const length = manifest.description[lang].length;
    assert.ok(length >= 10 && length <= 100, `description.${lang}: ${length} characters`);
    assert.ok(read(`docs/${lang}.md`).length >= 300, `docs/${lang}.md is too short for the store`);
  }
  assert.match(manifest.description.en, /Unofficial/);
  assert.match(manifest.description.fr, /Non officiel/);
  const intro = manifest.config_schema.find((f) => f.key === 'intro').description;
  assert.match(intro.en, /never tested with a real account/);
  assert.match(intro.fr, /jamais testé avec un vrai compte/);
});

test('every text is in English, French and Dutch', () => {
  for (const [path, text] of texts(manifest)) {
    for (const lang of ['en', 'fr', 'nl']) {
      assert.ok(text[lang]?.trim(), `${path} needs ${lang}`);
    }
  }
});

test('the configuration matches the code', () => {
  const fields = Object.fromEntries(manifest.config_schema.map((f) => [f.key, f]));
  assert.equal(fields.password.type, 'secret');
  // Never claim the secret is encrypted: Gladys stores it as is.
  for (const text of Object.values(fields.password.description)) {
    assert.doesNotMatch(text, /(?<!not |non |niet )(encrypted|chiffré|versleuteld)/i);
  }
  for (const [key, value] of Object.entries(DEFAULTS)) {
    assert.equal(fields[key].default, value, `${key} default`);
  }
  assert.deepEqual(
    fields.consumption.options.map((o) => o.value),
    Object.values(CONSUMPTION),
  );
  assert.ok(fields.email);
  for (const link of fields.intro.links) {
    assert.match(link.url, /^https:\/\//);
  }
});

test('the actions of the manifest are the handlers of the code', () => {
  assert.deepEqual(
    manifest.actions.map((a) => a.key),
    Object.values(ACTIONS),
  );
  for (const key of Object.keys(ACTIONS)) {
    assert.ok(handlers.includes(`onAction(ACTIONS.${key}`), key);
  }
  const request = manifest.actions.find((a) => a.key === ACTIONS.REQUEST_CODE);
  assert.deepEqual(
    request.fields[0].options.map((o) => o.value),
    Object.keys(CODE_CHANNELS),
  );
  const verify = manifest.actions.find((a) => a.key === ACTIONS.VERIFY_CODE);
  assert.equal(verify.fields[0].key, 'code');
  for (const action of manifest.actions) {
    assert.ok(action.timeout_seconds <= 60);
  }
});

test('the licenses ship in the image', () => {
  assert.match(dockerfile, /COPY LICENSE THIRD_PARTY_NOTICES\.md/);
  assert.equal(pkg.license, 'Apache-2.0');
  assert.match(read('LICENSE'), /Apache License\s+Version 2\.0/);
  assert.match(read('THIRD_PARTY_NOTICES.md'), /aioengiebelgium[\s\S]*MIT License/);
});
