'use strict';

const path = require('node:path');
const { parseArgs } = require('node:util');
const { loadConfig } = require('./config');
const { SITES } = require('./sites');
const { extract } = require('./extractor');

const HELP = `Treasure Extractor — download booru files locally

Usage: node main.js [options]
       npm run cli -- [options]

  --config <path>        Settings file (default: ./settings.json)
  --site <alias>         Site alias or domain
  --tags <tags>          Space- or comma-separated search tags
  --amount <number>      Maximum posts per site (1–1000)
  --output <directory>   Output directory (default: ./batches)
  --concurrency <n>      Concurrent downloads (1–8, default: 4)
  --random / --no-random Randomize search results
  --organized           Per-post folders with content.json
  --allsite             Search every supported site, grouped by site
  --list-sites          List site aliases
  --help                Show this help

Existing settings.json options remain supported. CLI options override them.
`;

async function runCli(
  args = process.argv.slice(2),
  { stdout = console.log, stderr = console.error } = {},
) {
  let controller;
  const cancel = () => controller?.abort(new Error('Cancelled by user.'));
  try {
    const { values } = parseArgs({
      args,
      options: {
        config: { type: 'string' },
        site: { type: 'string' },
        tags: { type: 'string' },
        amount: { type: 'string' },
        output: { type: 'string' },
        concurrency: { type: 'string' },
        random: { type: 'boolean' },
        'no-random': { type: 'boolean' },
        organized: { type: 'boolean' },
        allsite: { type: 'boolean' },
        'list-sites': { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
      },
    });
    if (values.help) {
      stdout(HELP);
      return 0;
    }
    if (values['list-sites']) {
      stdout(
        SITES.map((site) => `${site.alias.padEnd(8)} ${site.name} (${site.domain})`).join('\n'),
      );
      return 0;
    }
    const overrides = {};
    for (const key of ['site', 'tags', 'random', 'organized', 'allsite']) {
      if (values[key] !== undefined) overrides[key] = values[key];
    }
    for (const key of ['amount', 'concurrency']) {
      if (values[key] !== undefined) overrides[key] = Number(values[key]);
    }
    if (values['no-random']) overrides.random = false;
    if (values.output) overrides.outputDir = values.output;
    const config = await loadConfig(values.config && path.resolve(values.config), overrides);
    controller = new AbortController();
    process.once('SIGINT', cancel);
    process.once('SIGTERM', cancel);
    stdout('Starting Treasure Extractor…');
    const result = await extract(config, {
      signal: controller.signal,
      onProgress(event) {
        if (event.type === 'searching') stdout(`Searching ${event.site}…`);
        if (event.type === 'found') stdout(`Found ${event.count} posts on ${event.site}.`);
        if (event.type === 'error') stderr(event.message);
        if (event.type === 'file') {
          stdout(
            `[${event.processed}/${event.found}] ${event.file.status}: ${event.file.path || event.file.error || event.file.reason}`,
          );
        }
      },
    });
    stdout(
      `${result.status}: ${result.downloaded} downloaded, ${result.failed} failed, ${result.skipped} skipped.`,
    );
    stdout(`Batch: ${result.batchPath}`);
    for (const error of result.errors) stderr(error);
    return result.status === 'cancelled'
      ? 130
      : ['failed', 'partial'].includes(result.status)
        ? 1
        : 0;
  } catch (error) {
    stderr(error.message);
    return 1;
  } finally {
    process.removeListener('SIGINT', cancel);
    process.removeListener('SIGTERM', cancel);
  }
}

module.exports = { runCli };
