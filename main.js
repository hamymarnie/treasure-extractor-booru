#!/usr/bin/env node
'use strict';

const { runCli } = require('./src/cli');

if (require.main === module) {
  runCli().then((code) => {
    process.exitCode = code;
  });
}

module.exports = { runCli };
