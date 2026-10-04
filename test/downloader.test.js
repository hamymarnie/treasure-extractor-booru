'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('node:http');
const { once } = require('node:events');
const { downloadFile } = require('../src/downloader');

async function fixture(t, handler) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'treasure-download-'));
  const server = createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  });
  return { directory, url: `http://127.0.0.1:${server.address().port}` };
}

test('downloads follow redirects, await the body, and rename atomically', async (t) => {
  const { directory, url } = await fixture(t, (req, res) => {
    if (req.url === '/redirect') {
      res.writeHead(302, { Location: '/file' });
      res.end();
    } else {
      res.write('first');
      setTimeout(() => res.end('second'), 20);
    }
  });
  const filename = path.join(directory, 'nested', 'image.bin');
  const result = await downloadFile(`${url}/redirect`, filename);
  assert.equal(result.bytes, 11);
  assert.equal(await fs.readFile(filename, 'utf8'), 'firstsecond');
  assert.deepEqual(await fs.readdir(path.dirname(filename)), ['image.bin']);
});

test('HTTP errors cannot create successful files; transient errors are retried', async (t) => {
  let attempts = 0;
  const { directory, url } = await fixture(t, (req, res) => {
    if (req.url === '/missing') {
      res.writeHead(404);
      res.end('no');
    } else if (++attempts === 1) {
      res.writeHead(503);
      res.end('busy');
    } else res.end('image');
  });
  await assert.rejects(downloadFile(`${url}/missing`, path.join(directory, 'missing')), /404/);
  await downloadFile(`${url}/retry`, path.join(directory, 'retry'));
  assert.equal(attempts, 2);
  assert.deepEqual(await fs.readdir(directory), ['retry']);
});

test('streamed file limits, cancellation, and timeouts remove partial files', async (t) => {
  const { directory, url } = await fixture(t, (req, res) => {
    if (req.url === '/large') {
      res.write(Buffer.alloc(512 * 1024));
      res.end(Buffer.alloc(512 * 1024 + 1));
    } else {
      res.write('partial');
    }
  });
  await assert.rejects(
    downloadFile(`${url}/large`, path.join(directory, 'large'), { maxFileSizeMB: 1, retries: 0 }),
    /size limit/,
  );
  const controller = new AbortController();
  const transfer = downloadFile(`${url}/hang`, path.join(directory, 'cancel'), {
    signal: controller.signal,
  });
  setTimeout(() => controller.abort(new Error('stop')), 40);
  await assert.rejects(transfer, /stop/);
  await assert.rejects(
    downloadFile(`${url}/hang`, path.join(directory, 'timeout'), { timeout: 40, retries: 0 }),
  );
  assert.deepEqual(await fs.readdir(directory), []);
});

test('non-HTTP URLs and empty bodies are rejected', async (t) => {
  const { directory, url } = await fixture(t, (req, res) => res.end());
  await assert.rejects(downloadFile('file:///etc/passwd', path.join(directory, 'file')), /HTTP/);
  await assert.rejects(
    downloadFile(url, path.join(directory, 'empty'), { retries: 0 }),
    /empty file/,
  );
  assert.deepEqual(await fs.readdir(directory), []);
});
