'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { resolveSite } = require('./sites');

const DEFAULTS = Object.freeze({
  site: 'danb',
  tags: [],
  amount: 50,
  random: true,
  organized: false,
  allsite: false,
  concurrency: 4,
  retries: 2,
  timeout: 30000,
  maxFileSizeMB: 100,
  outputDir: './batches',
});

function normalizeConfig(input = {}) {
  if (!input || Array.isArray(input) || typeof input !== 'object') {
    throw new Error('Settings must be a JSON object.');
  }
  const config = { ...DEFAULTS, ...input };
  config.site = resolveSite(config.site).alias;
  if (typeof config.tags === 'string') config.tags = config.tags.split(/[\s,]+/).filter(Boolean);
  if (
    !Array.isArray(config.tags) ||
    config.tags.some((tag) => typeof tag !== 'string' || tag.length > 200)
  ) {
    throw new Error('tags must be a string or an array of strings (up to 200 characters each).');
  }
  config.tags = [...new Set(config.tags.map((tag) => tag.trim()).filter(Boolean))];
  if (config.tags.length > 100) throw new Error('Use at most 100 tags.');
  for (const key of ['random', 'organized', 'allsite']) {
    if (typeof config[key] !== 'boolean') throw new Error(`${key} must be true or false.`);
  }
  for (const [key, min, max] of [
    ['amount', 1, 1000],
    ['concurrency', 1, 8],
    ['retries', 0, 5],
    ['timeout', 1000, 300000],
    ['maxFileSizeMB', 1, 2048],
  ]) {
    if (!Number.isInteger(config[key]) || config[key] < min || config[key] > max) {
      throw new Error(`${key} must be an integer between ${min} and ${max}.`);
    }
  }
  if (
    typeof config.outputDir !== 'string' ||
    !config.outputDir.trim() ||
    config.outputDir.includes('\0')
  ) {
    throw new Error('outputDir must be a non-empty filesystem path.');
  }
  return Object.fromEntries(Object.keys(DEFAULTS).map((key) => [key, config[key]]));
}

async function loadConfig(filename = path.resolve('settings.json'), overrides = {}) {
  let data;
  try {
    data = JSON.parse(await fs.readFile(filename, 'utf8'));
  } catch (error) {
    throw new Error(`Could not read settings at ${filename}: ${error.message}`, { cause: error });
  }
  if (!data || Array.isArray(data) || typeof data !== 'object') {
    throw new Error(`Settings at ${filename} must be a JSON object.`);
  }
  return normalizeConfig({ ...data, ...overrides });
}

module.exports = { DEFAULTS, normalizeConfig, loadConfig };
