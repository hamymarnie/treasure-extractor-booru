'use strict';

// Compatibility for consumers of the original helper module.
const fs = require('node:fs/promises');
const { downloadFile, parseFileUrl } = require('../src/downloader');

exports.CreateDirectory = (directory, options = {}) =>
  fs.mkdir(directory, { ...options, recursive: true });

exports.GetFileSize = async (url) => {
  const response = await fetch(parseFileUrl(url), {
    method: 'HEAD',
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`File size request returned HTTP ${response.status}.`);
  return response.headers.get('content-length') || '';
};

exports.AttemptToDownloadImage = async (url, destination) => {
  try {
    await downloadFile(url, destination);
    return 0;
  } catch {
    return 1;
  }
};
