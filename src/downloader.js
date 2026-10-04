'use strict';

const { createWriteStream } = require('node:fs');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { setTimeout: delay } = require('node:timers/promises');

const USER_AGENT = 'TreasureExtractor/2.0 (https://github.com/hamymarnie/treasure-extractor-booru)';

function parseFileUrl(value) {
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Only HTTP(S) file URLs without embedded credentials are supported.');
  }
  return url;
}

async function downloadFile(
  url,
  destination,
  { signal, timeout = 30000, retries = 2, maxFileSizeMB = 100, fetchImpl = fetch } = {},
) {
  const source = parseFileUrl(url);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${randomUUID()}.part`;
  const maxBytes = maxFileSizeMB * 1024 * 1024;
  for (let attempt = 0; attempt <= retries; attempt++) {
    signal?.throwIfAborted();
    const transferSignal = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(timeout)])
      : AbortSignal.timeout(timeout);
    let response;
    try {
      response = await fetchImpl(source, {
        signal: transferSignal,
        headers: { 'User-Agent': USER_AGENT },
      });
      if (!response.ok) {
        const error = new Error(`Download returned HTTP ${response.status}.`);
        error.retryable =
          response.status === 429 || response.status === 408 || response.status >= 500;
        throw error;
      }
      if (!response.body) throw new Error('The server returned no file body.');
      if (Number(response.headers.get('content-length')) > maxBytes) {
        throw new Error(`File exceeds the ${maxFileSizeMB} MB size limit.`);
      }
      let bytes = 0;
      const meter = new Transform({
        transform(chunk, encoding, callback) {
          bytes += chunk.length;
          callback(
            bytes > maxBytes ? new Error(`File exceeds the ${maxFileSizeMB} MB size limit.`) : null,
            chunk,
          );
        },
      });
      await pipeline(
        Readable.fromWeb(response.body),
        meter,
        createWriteStream(temporary, { flags: 'wx' }),
        {
          signal: transferSignal,
        },
      );
      transferSignal.throwIfAborted();
      if (bytes === 0) throw new Error('The server returned an empty file.');
      await fs.rename(temporary, destination);
      return { bytes, path: destination };
    } catch (error) {
      if (response?.body && !response.body.locked) await response.body.cancel().catch(() => {});
      await fs.rm(temporary, { force: true });
      signal?.throwIfAborted();
      const retryable =
        error.retryable ||
        error.name === 'TypeError' ||
        transferSignal.aborted ||
        ['ECONNRESET', 'ETIMEDOUT', 'UND_ERR_SOCKET'].includes(error.code);
      if (!retryable || attempt === retries) throw error;
      const retryAfter = Number(response?.headers.get('retry-after'));
      const backoff = retryAfter > 0 ? Math.min(retryAfter * 1000, 10000) : 500 * 2 ** attempt;
      await delay(backoff, undefined, { signal });
    }
  }
}

module.exports = { USER_AGENT, parseFileUrl, downloadFile };
