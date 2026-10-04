'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { request } = require('node:http');
const { setTimeout: delay } = require('node:timers/promises');
const { createApp } = require('../src/server');
const { JobManager } = require('../src/jobs');
const { extract } = require('../src/extractor');

const IMAGE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
  'base64',
);

async function fixture(t, { slow = false } = {}) {
  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'treasure-web-'));
  const manager = new JobManager((config, context) =>
    extract(config, {
      ...context,
      search: async () => [
        { id: '1', fileUrl: 'https://example.com/image.png', tags: ['cat'], rating: 's' },
      ],
      download: async (url, filename, { signal }) => {
        if (slow) await delay(2000, undefined, { signal });
        await fs.mkdir(path.dirname(filename), { recursive: true });
        await fs.writeFile(filename, IMAGE);
        return { bytes: IMAGE.length };
      },
    }),
  );
  const app = createApp({ config: { outputDir, amount: 1 }, manager });
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  t.after(async () => {
    await app.close();
    await fs.rm(outputDir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const boot = await fetch(`${base}/api/config`).then((response) => response.json());
  const post = (route, body, headers = {}) =>
    fetch(base + route, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Extractor-Token': boot.token, ...headers },
      body: JSON.stringify(body),
    });
  return { ...app, outputDir, base, boot, post };
}

async function finished(base, id) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const job = await fetch(`${base}/api/jobs/${id}`).then((response) => response.json());
    if (!['running', 'cancelling'].includes(job.status)) return job;
    await delay(10);
  }
  throw new Error('Job did not settle.');
}

test('web assets, extraction, progress, history, and downloads work together', async (t) => {
  const { base, outputDir, post } = await fixture(t);
  for (const route of ['/', '/styles.css', '/app.js', '/favicon.svg']) {
    const response = await fetch(base + route);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    await response.arrayBuffer();
  }
  const response = await post('/api/jobs', { tags: 'cat', amount: 1, outputDir: '/outside' });
  assert.equal(response.status, 202);
  const initial = await response.json();
  assert.equal(initial.config.outputDir, outputDir);
  const job = await finished(base, initial.id);
  assert.equal(job.status, 'completed');
  assert.equal(job.downloaded, 1);
  const batches = await fetch(base + '/api/batches').then((result) => result.json());
  assert.equal(batches.length, 1);
  const batch = await fetch(`${base}/api/batches/${job.batchId}`).then((result) => result.json());
  assert.equal(batch.files.length, 1);
  const file = await fetch(`${base}/files/${job.batchId}/${batch.files[0].path}`);
  assert.equal(file.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await file.arrayBuffer()), IMAGE);
  const head = await fetch(`${base}/files/${job.batchId}/${batch.files[0].path}`, {
    method: 'HEAD',
  });
  assert.equal(Number(head.headers.get('content-length')), IMAGE.length);
  const manifest = await fetch(`${base}/files/${job.batchId}/manifest.json?download`);
  assert.match(manifest.headers.get('content-disposition'), /attachment/);
});

test('web rejects cross-origin requests, hostile Hosts, and unauthenticated writes', async (t) => {
  const { base, post } = await fixture(t);
  assert.equal((await post('/api/jobs', {}, { 'X-Extractor-Token': '' })).status, 403);
  assert.equal((await post('/api/jobs', {}, { Origin: 'https://example.com' })).status, 403);
  const hostileHost = await new Promise((resolve, reject) => {
    request(base + '/api/config', { headers: { Host: 'attacker.example' } }, (response) => {
      response.resume();
      resolve(response.statusCode);
    })
      .on('error', reject)
      .end();
  });
  assert.equal(hostileHost, 403);
  assert.equal((await post('/api/jobs', { amount: 0 })).status, 400);
  assert.equal(
    (await post('/api/jobs', { amount: 1 }, { 'Content-Type': 'text/plain' })).status,
    415,
  );
  assert.equal((await fetch(base + '/api/missing')).status, 404);
  assert.equal((await fetch(base + '/api/jobs', { method: 'DELETE' })).status, 405);
  const malformed = await fetch(base + '/api/jobs', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Extractor-Token': (await fetch(base + '/api/config').then((r) => r.json())).token,
    },
    body: '{',
  });
  assert.equal(malformed.status, 400);
  assert.equal((await post('/api/jobs', { tags: 'x'.repeat(17000) })).status, 413);
});

test('one job runs at a time and cancellation persists its status', async (t) => {
  const { base, post } = await fixture(t, { slow: true });
  const job = await post('/api/jobs', {}).then((response) => response.json());
  assert.equal((await post('/api/jobs', {})).status, 409);
  await delay(30);
  assert.equal((await post(`/api/jobs/${job.id}/cancel`, {})).status, 200);
  const result = await finished(base, job.id);
  assert.equal(result.status, 'cancelled');
  const batch = await fetch(`${base}/api/batches/${result.batchId}`).then((response) =>
    response.json(),
  );
  assert.equal(batch.status, 'cancelled');
  assert.equal((await post('/api/jobs/missing/cancel', {})).status, 404);
});

test('history survives restart; traversal and symlink escape cannot expose files', async (t) => {
  const { base, outputDir, post } = await fixture(t);
  const initial = await post('/api/jobs', {}).then((response) => response.json());
  const job = await finished(base, initial.id);
  const restarted = createApp({ config: { outputDir } });
  restarted.server.listen(0, '127.0.0.1');
  await once(restarted.server, 'listening');
  t.after(() => restarted.close());
  const newBase = `http://127.0.0.1:${restarted.server.address().port}`;
  const history = await fetch(newBase + '/api/batches').then((response) => response.json());
  assert.equal(history[0].id, job.batchId);
  const traversal = await fetch(`${base}/files/${job.batchId}/%2e%2e%2fsettings.json`);
  assert.equal(traversal.status, 403);
  const secret = path.join(os.tmpdir(), `treasure-secret-${job.id}.txt`);
  await fs.writeFile(secret, 'private');
  t.after(() => fs.rm(secret, { force: true }));
  try {
    await fs.symlink(secret, path.join(outputDir, job.batchId, 'secret.txt'));
  } catch (error) {
    if (error.code === 'EPERM') return;
    throw error;
  }
  assert.equal((await fetch(`${base}/files/${job.batchId}/secret.txt`)).status, 403);
  assert.equal((await fetch(`${base}/files/${job.batchId}/sources.txt`)).status, 404);
});
