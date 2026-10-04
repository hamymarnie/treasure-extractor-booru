'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeConfig } = require('../src/config');
const { resolveSite, SITES } = require('../src/sites');

test('legacy settings and aliases retain their meaning', () => {
  const config = normalizeConfig({
    site: 'gelb',
    tags: ['rating:safe', 'cat'],
    amount: 500,
    random: true,
    organized: false,
    allsite: false,
  });
  assert.equal(config.site, 'gelb');
  assert.equal(config.amount, 500);
  assert.equal(config.concurrency, 4);
  assert.equal(resolveSite('danbooru').alias, 'danb');
  assert.equal(resolveSite('e6').alias, 'e621');
  assert.equal(SITES.length, 15);
});

test('configuration normalizes tags and rejects unsafe or malformed values', () => {
  assert.deepEqual(normalizeConfig({ tags: 'cat, dog cat' }).tags, ['cat', 'dog']);
  for (const input of [
    { amount: 0 },
    { amount: 1.5 },
    { amount: '2' },
    { concurrency: 99 },
    { random: 'false' },
    { tags: [null] },
    { site: 'unknown' },
    { outputDir: '' },
    null,
  ]) {
    assert.throws(() => normalizeConfig(input));
  }
  assert.throws(() => normalizeConfig({ site: 'fur' }), /no longer supported/);
});

test('settings files must contain an object before overrides are applied', async (t) => {
  const fs = require('node:fs/promises');
  const os = require('node:os');
  const path = require('node:path');
  const { loadConfig } = require('../src/config');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'treasure-settings-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filename = path.join(directory, 'settings.json');
  for (const value of [null, [], ['cat'], 12, 'danb', false]) {
    await fs.writeFile(filename, JSON.stringify(value));
    await assert.rejects(loadConfig(filename, { amount: 1 }), /must be a JSON object/);
  }
  await fs.writeFile(filename, JSON.stringify({ site: 'safe', amount: 5 }));
  const config = await loadConfig(filename, { amount: 10 });
  assert.equal(config.site, 'safe');
  assert.equal(config.amount, 10);
});
