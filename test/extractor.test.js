'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { extract } = require('../src/extractor');
const { SITES } = require('../src/sites');

async function output(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'treasure-extract-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}
const post = (id) => ({
  id: String(id),
  fileUrl: `https://example.com/image-${id}.jpg?token=secret`,
  tags: ['cat'],
  rating: 's',
});
async function save(url, filename) {
  await fs.mkdir(path.dirname(filename), { recursive: true });
  await fs.writeFile(filename, 'image');
  return { bytes: 5 };
}

test('limits and deduplicates posts, bounds concurrency, and records exact results', async (t) => {
  const outputDir = await output(t);
  let active = 0;
  let peak = 0;
  const result = await extract(
    { outputDir, amount: 6, concurrency: 2 },
    {
      search: async () => [post(1), post(1), {}, post(2), post(3), post(4), post(5)],
      download: async (url, filename) => {
        active++;
        peak = Math.max(peak, active);
        await delay(15);
        active--;
        if (url.includes('image-3')) throw new Error('unavailable');
        return save(url, filename);
      },
    },
  );
  assert.equal(result.found, 6);
  assert.equal(result.downloaded, 3);
  assert.equal(result.skipped, 2);
  assert.equal(result.failed, 1);
  assert.equal(result.processed, 6);
  assert.equal(result.bytes, 15);
  assert.equal(result.status, 'partial');
  assert.equal(peak, 2);
  const manifest = JSON.parse(await fs.readFile(path.join(result.batchPath, 'manifest.json')));
  assert.equal(manifest.status, 'partial');
  assert.equal(manifest.files.length, 6);
  assert.match(await fs.readFile(path.join(result.batchPath, 'sources.txt'), 'utf8'), /image-4/);
  assert.equal((await fs.readdir(path.join(result.batchPath, 'images'))).length, 3);
});

test('organized output retains content.json and batches have collision-free names', async (t) => {
  const outputDir = await output(t);
  const options = { search: async () => [post(1)], download: save };
  const [one, two] = await Promise.all([
    extract({ outputDir, organized: true, amount: 1 }, options),
    extract({ outputDir, organized: true, amount: 1 }, options),
  ]);
  assert.notEqual(one.id, two.id);
  const info = JSON.parse(await fs.readFile(path.join(one.batchPath, '0', 'content.json')));
  assert.deepEqual(info.tags, ['cat']);
  assert.equal(one.files[0].path, '0/0000-image-1.jpg');
});

test('allsite ignores organized, isolates site errors, and groups sources by site', async (t) => {
  const outputDir = await output(t);
  const calls = [];
  const result = await extract(
    { outputDir, allsite: true, organized: true, amount: 1 },
    {
      search: async (site) => {
        calls.push(site);
        if (site === 'gelb') throw new Error('API unavailable');
        return [post(site)];
      },
      download: save,
    },
  );
  assert.deepEqual(
    calls,
    SITES.map((site) => site.alias),
  );
  assert.equal(result.downloaded, SITES.length - 1);
  assert.equal(result.status, 'partial');
  assert.match(result.errors[0], /gelb/);
  assert.equal((await fs.readdir(path.join(result.batchPath, 'danb'))).length, 2);
});

test('cancellation settles workers and saves a final manifest', async (t) => {
  const outputDir = await output(t);
  const controller = new AbortController();
  let active = 0;
  const result = await extract(
    { outputDir, concurrency: 2 },
    {
      signal: controller.signal,
      search: async () => [post(1), post(2), post(3)],
      download: async (url, filename, { signal }) => {
        active++;
        setTimeout(() => controller.abort(new Error('stop')), 10);
        try {
          await delay(200, undefined, { signal });
        } finally {
          active--;
        }
        return save(url, filename);
      },
    },
  );
  assert.equal(result.status, 'cancelled');
  assert.equal(active, 0);
  assert.equal(result.files.length, 2);
  const manifest = JSON.parse(await fs.readFile(path.join(result.batchPath, 'manifest.json')));
  assert.equal(manifest.status, 'cancelled');
});

test('search failure is distinct from an empty successful search', async (t) => {
  const outputDir = await output(t);
  const failure = await extract(
    { outputDir },
    {
      search: async () => {
        throw new Error('offline');
      },
    },
  );
  const empty = await extract({ outputDir }, { search: async () => [] });
  assert.equal(failure.status, 'failed');
  assert.equal(empty.status, 'completed');
  assert.equal(empty.downloaded, 0);
});

test('Derpibooru request URLs omit absent credentials and accept a site-scoped token', async (t) => {
  const booru = require('booru');
  const { searchPosts, siteCredentials } = require('../src/extractor');
  const { normalizeConfig } = require('../src/config');
  const request = booru.BooruClass.prototype.doSearchRequest;
  const originalToken = process.env.TREASURE_DERP_TOKEN;
  t.after(() => {
    booru.BooruClass.prototype.doSearchRequest = request;
    if (originalToken === undefined) delete process.env.TREASURE_DERP_TOKEN;
    else process.env.TREASURE_DERP_TOKEN = originalToken;
  });
  const urls = [];
  booru.BooruClass.prototype.doSearchRequest = async (tags, { uri }) => {
    urls.push(new URL(uri));
    return { images: [] };
  };
  delete process.env.TREASURE_DERP_TOKEN;
  await searchPosts(
    'derp',
    normalizeConfig({ site: 'derp', tags: ['safe'], amount: 1, random: false }),
  );
  assert.equal(urls[0].searchParams.has('key'), false);
  process.env.TREASURE_DERP_TOKEN = 'fixture-token';
  await searchPosts('derp', normalizeConfig({ site: 'derp', amount: 1, random: false }));
  assert.equal(urls[1].searchParams.get('key'), 'fixture-token');
  assert.equal(siteCredentials('gelb', { TREASURE_DERP_TOKEN: 'fixture-token' }), undefined);
  assert.deepEqual(
    siteCredentials('gelb', { TREASURE_GELB_API_KEY: 'fixture-key', TREASURE_GELB_USER_ID: '1' }),
    { api_key: 'fixture-key', user_id: '1' },
  );
});
