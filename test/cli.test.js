'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runCli } = require('../src/cli');

test('CLI help and site listing work without a settings file', async () => {
  const messages = [];
  assert.equal(await runCli(['--help'], { stdout: (message) => messages.push(message) }), 0);
  assert.match(messages.pop(), /Usage: node main.js/);
  assert.equal(await runCli(['--list-sites'], { stdout: (message) => messages.push(message) }), 0);
  assert.match(messages.pop(), /gelb/);
});

test('CLI configuration and argument failures return a failure status', async () => {
  const errors = [];
  const stderr = (error) => errors.push(error);
  assert.equal(await runCli(['--amount', '0'], { stderr }), 1);
  assert.match(errors.pop(), /amount/);
  assert.equal(await runCli(['--invalid'], { stderr }), 1);
  assert.match(errors.pop(), /Unknown option/);
  assert.equal(await runCli(['--config', '/missing/settings.json'], { stderr }), 1);
  assert.match(errors.pop(), /Could not read settings/);
});

test('the original node main.js entry point downloads files and exits after writes finish', async (t) => {
  const fs = require('node:fs/promises');
  const path = require('node:path');
  const os = require('node:os');
  const { createServer } = require('node:http');
  const { once } = require('node:events');
  const { execFile } = require('node:child_process');
  const { promisify } = require('node:util');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'treasure-cli-'));
  const server = createServer((request, response) => {
    response.write('image');
    setTimeout(() => response.end('body'), 40);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  });
  const url = `http://127.0.0.1:${server.address().port}/test.jpg`;
  const preload = path.join(directory, 'fixture.cjs');
  await fs.writeFile(
    preload,
    `require(${JSON.stringify(require.resolve('booru'))}).forSite = () => ({ search: async () => [{ id: '1', fileUrl: ${JSON.stringify(url)}, tags: ['cat'] }] });`,
  );
  const settings = path.join(directory, 'settings.json');
  await fs.writeFile(
    settings,
    JSON.stringify({
      site: 'danb',
      amount: 1,
      tags: [],
      random: false,
      organized: false,
      allsite: false,
    }),
  );
  const outputDir = path.join(directory, 'batches');
  const result = await promisify(execFile)(
    process.execPath,
    [
      '--require',
      preload,
      path.resolve(__dirname, '../main.js'),
      '--config',
      settings,
      '--output',
      outputDir,
    ],
    { timeout: 10000 },
  );
  assert.match(result.stdout, /completed: 1 downloaded/);
  const [id] = await fs.readdir(outputDir);
  const manifest = JSON.parse(await fs.readFile(path.join(outputDir, id, 'manifest.json')));
  const file = await fs.readFile(path.join(outputDir, id, manifest.files[0].path), 'utf8');
  assert.equal(file, 'imagebody');
});
