'use strict';

const http = require('node:http');
const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const { pipeline } = require('node:stream/promises');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { normalizeConfig } = require('./config');
const { SITES } = require('./sites');
const { JobManager } = require('./jobs');

const PUBLIC = path.resolve(__dirname, '../public');
const ID = /^[a-zA-Z0-9-]+$/;
const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
};

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function json(response, status, value) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(value));
}

function readJson(request) {
  if (!request.headers['content-type']?.startsWith('application/json')) {
    request.resume();
    return Promise.reject(httpError(415, 'Send an application/json request.'));
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    const cleanup = () => {
      request.removeListener('data', data);
      request.removeListener('end', end);
      request.removeListener('error', fail);
      request.removeListener('aborted', aborted);
    };
    const fail = (error) => {
      cleanup();
      request.resume();
      reject(error);
    };
    const aborted = () => fail(httpError(400, 'Request was interrupted.'));
    const data = (chunk) => {
      bytes += chunk.length;
      if (bytes > 16384) {
        fail(httpError(413, 'Request exceeds the 16 KB limit.'));
        return;
      }
      chunks.push(chunk);
    };
    const end = () => {
      cleanup();
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(httpError(400, 'Invalid JSON body.'));
      }
    };
    request.on('data', data);
    request.once('end', end);
    request.once('error', fail);
    request.once('aborted', aborted);
  });
}

async function resolveFile(root, relative) {
  const base = await fs.realpath(root);
  const filename = path.resolve(base, relative);
  if (!filename.startsWith(`${base}${path.sep}`))
    throw httpError(403, 'Path is outside the batch directory.');
  const resolved = await fs.realpath(filename);
  if (!resolved.startsWith(`${base}${path.sep}`))
    throw httpError(403, 'Path is outside the batch directory.');
  return resolved;
}

async function readManifest(outputRoot, id) {
  if (!ID.test(id)) throw httpError(400, 'Invalid batch ID.');
  const filename = await resolveFile(outputRoot, path.join(id, 'manifest.json'));
  return JSON.parse(await fs.readFile(filename, 'utf8'));
}

async function listBatches(outputRoot) {
  let directories;
  try {
    directories = await fs.readdir(outputRoot, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const batches = [];
  for (const directory of directories
    .filter((entry) => entry.isDirectory() && ID.test(entry.name))
    .sort((a, b) => b.name.localeCompare(a.name))) {
    if (batches.length >= 100) break;
    try {
      const { files, ...manifest } = await readManifest(outputRoot, directory.name);
      batches.push(manifest);
    } catch {
      // Legacy folders and interrupted/corrupt manifests do not block the library.
    }
  }
  return batches;
}

function createApp({ config, manager = new JobManager() }) {
  const defaults = normalizeConfig(config);
  const outputRoot = path.resolve(defaults.outputDir);
  const token = randomBytes(32).toString('hex');
  const server = http.createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; img-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    try {
      const port = server.address().port;
      const allowedHosts = [`127.0.0.1:${port}`, `localhost:${port}`];
      if (!allowedHosts.includes(request.headers.host))
        throw httpError(403, 'Use the local server address.');
      if (request.headers.origin && request.headers.origin !== `http://${request.headers.host}`)
        throw httpError(403, 'Cross-origin requests are not allowed.');
      if (!['GET', 'HEAD', 'POST'].includes(request.method))
        throw httpError(405, 'Method not allowed.');
      const url = new URL(request.url, `http://${request.headers.host}`);
      const route = url.pathname;
      if (request.method === 'POST') {
        if (request.headers['x-extractor-token'] !== token)
          throw httpError(403, 'Missing or invalid session token. Reload the page.');
        if (route === '/api/jobs') {
          const input = await readJson(request);
          if (!input || typeof input !== 'object' || Array.isArray(input))
            throw httpError(400, 'Settings must be an object.');
          let selected;
          try {
            selected = normalizeConfig({ ...defaults, ...input, outputDir: outputRoot });
          } catch (error) {
            throw httpError(400, error.message);
          }
          json(response, 202, manager.start(selected));
          return;
        }
        const cancellation = route.match(/^\/api\/jobs\/([a-zA-Z0-9-]+)\/cancel$/);
        if (cancellation) {
          const job = manager.cancel(cancellation[1]);
          if (!job) throw httpError(404, 'Job not found.');
          json(response, 200, job);
          return;
        }
        throw httpError(404, 'Endpoint not found.');
      }
      if (route === '/api/config') {
        json(response, 200, { defaults, sites: SITES, outputRoot, token });
        return;
      }
      if (route === '/api/jobs') {
        json(response, 200, manager.list());
        return;
      }
      const jobMatch = route.match(/^\/api\/jobs\/([a-zA-Z0-9-]+)$/);
      if (jobMatch) {
        const job = manager.get(jobMatch[1]);
        if (!job) throw httpError(404, 'Job not found.');
        json(response, 200, job);
        return;
      }
      if (route === '/api/batches') {
        json(response, 200, await listBatches(outputRoot));
        return;
      }
      const batchMatch = route.match(/^\/api\/batches\/([a-zA-Z0-9-]+)$/);
      if (batchMatch) {
        json(response, 200, await readManifest(outputRoot, batchMatch[1]));
        return;
      }
      let filename;
      let attachment = false;
      if (route.startsWith('/files/')) {
        let segments;
        try {
          segments = route.slice(7).split('/').map(decodeURIComponent);
        } catch {
          throw httpError(400, 'Invalid file path.');
        }
        const [id, ...parts] = segments;
        if (
          !ID.test(id) ||
          !parts.length ||
          parts.some(
            (part) =>
              !part || part === '.' || part === '..' || part.includes('/') || part.includes('\\'),
          )
        ) {
          throw httpError(403, 'Invalid file path.');
        }
        filename = await resolveFile(outputRoot, path.join(id, ...parts));
        const manifest = await readManifest(outputRoot, id);
        const relative = parts.join('/');
        if (
          relative !== 'manifest.json' &&
          !manifest.files.some((file) => file.status === 'downloaded' && file.path === relative)
        ) {
          throw httpError(404, 'File not listed in this batch.');
        }
        attachment =
          url.searchParams.has('download') ||
          !['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.mp4', '.webm'].includes(
            path.extname(filename).toLowerCase(),
          );
      } else {
        const assets = {
          '/': 'index.html',
          '/app.js': 'app.js',
          '/styles.css': 'styles.css',
          '/favicon.svg': 'favicon.svg',
        };
        if (!assets[route]) throw httpError(404, 'Page not found.');
        filename = path.join(PUBLIC, assets[route]);
      }
      const stat = await fs.stat(filename);
      if (!stat.isFile()) throw httpError(404, 'File not found.');
      response.setHeader(
        'Content-Type',
        CONTENT_TYPES[path.extname(filename).toLowerCase()] || 'application/octet-stream',
      );
      response.setHeader('Content-Length', stat.size);
      response.setHeader('Cache-Control', 'no-store');
      if (attachment)
        response.setHeader(
          'Content-Disposition',
          `attachment; filename="${path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_')}"`,
        );
      if (request.method === 'HEAD') {
        response.end();
        return;
      }
      await pipeline(createReadStream(filename), response);
    } catch (error) {
      if (response.headersSent || response.destroyed) {
        response.destroy();
        return;
      }
      const status = error.status || (error.code === 'ENOENT' ? 404 : 500);
      json(response, status, {
        error:
          status === 500
            ? 'Could not complete the request. Check the server console.'
            : error.message,
      });
      if (status === 500) console.error(error);
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  return {
    server,
    manager,
    outputRoot,
    async close() {
      await manager.stop();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

module.exports = { createApp, resolveFile, listBatches };
