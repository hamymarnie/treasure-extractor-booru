#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { parseArgs } = require('node:util');
const { loadConfig } = require('./src/config');
const { createApp } = require('./src/server');

async function start() {
  const { values } = parseArgs({
    options: {
      port: { type: 'string', default: process.env.PORT || '3000' },
      config: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    console.log(
      'Usage: npm start -- [--port 3000] [--config ./settings.json]\nThe web tool listens only on 127.0.0.1.',
    );
    return;
  }
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('Port must be an integer between 1 and 65535.');
  const config = await loadConfig(values.config && path.resolve(values.config));
  const app = createApp({ config });
  app.server.on('error', (error) => {
    console.error(
      error.code === 'EADDRINUSE'
        ? `Port ${port} is in use. Choose another with --port.`
        : error.message,
    );
    process.exitCode = 1;
  });
  app.server.listen(port, '127.0.0.1', () => {
    console.log(`Treasure Extractor: http://127.0.0.1:${port}`);
    console.log(`Saving batches to ${app.outputRoot}`);
  });
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    console.log('\nFinishing active downloads and stopping…');
    await app.close();
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

if (require.main === module)
  start().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
module.exports = { start };
