'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const booru = require('booru');
const { normalizeConfig } = require('./config');
const { SITES, resolveSite } = require('./sites');
const { downloadFile, parseFileUrl } = require('./downloader');
const { waitFor, mapConcurrent } = require('./async');

function fileName(post, index) {
  const url = parseFileUrl(post.fileUrl);
  let name;
  try {
    name = decodeURIComponent(path.posix.basename(url.pathname));
  } catch {
    name = path.posix.basename(url.pathname);
  }
  name = name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120) || 'download.bin';
  return `${String(index).padStart(4, '0')}-${name}`;
}

function metadata(post) {
  return {
    fileUrl: post.fileUrl ?? null,
    tags: post.tags ?? [],
    id: post.id ?? null,
    score: post.score ?? null,
    source: post.source ?? null,
    rating: post.rating ?? null,
    postView: post.postView ?? null,
  };
}

async function writeJson(filename, value) {
  const temporary = `${filename}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await fs.rename(temporary, filename);
}

function siteCredentials(alias, environment = process.env) {
  const prefix = `TREASURE_${alias.toUpperCase()}_`;
  const fields =
    alias === 'derp'
      ? [['TOKEN', 'token']]
      : [
          ['API_KEY', 'api_key'],
          ['USER_ID', 'user_id'],
          ['LOGIN', 'login'],
        ];
  const credentials = {};
  for (const [suffix, key] of fields) {
    if (environment[prefix + suffix]) credentials[key] = environment[prefix + suffix];
  }
  return Object.keys(credentials).length ? credentials : undefined;
}

async function searchPosts(site, config) {
  const selected = resolveSite(site);
  // Credentials belong to one site and never enter browser responses/manifests.
  return booru.forSite(selected.domain, siteCredentials(selected.alias)).search(config.tags, {
    limit: config.amount,
    random: config.random,
  });
}

async function extract(
  input,
  { signal, onProgress = () => {}, search = searchPosts, download = downloadFile } = {},
) {
  const config = normalizeConfig(input);
  signal?.throwIfAborted();
  const id = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
  const batchPath = path.resolve(config.outputDir, id);
  await fs.mkdir(batchPath, { recursive: true });
  const manifest = {
    version: 2,
    id,
    status: 'running',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    config,
    downloaded: 0,
    failed: 0,
    skipped: 0,
    found: 0,
    processed: 0,
    bytes: 0,
    sites: [],
    files: [],
    errors: [],
  };
  const emit = (event) =>
    onProgress({
      id,
      downloaded: manifest.downloaded,
      failed: manifest.failed,
      skipped: manifest.skipped,
      found: manifest.found,
      processed: manifest.processed,
      bytes: manifest.bytes,
      ...event,
    });
  const sites = config.allsite ? SITES.map((site) => site.alias) : [config.site];
  const seen = new Set();
  await writeJson(path.join(batchPath, 'manifest.json'), manifest);
  emit({ type: 'started', batchPath });
  try {
    for (const site of sites) {
      signal?.throwIfAborted();
      const siteResult = { site, found: 0, downloaded: 0, failed: 0, skipped: 0 };
      manifest.sites.push(siteResult);
      emit({ type: 'searching', site });
      let posts;
      try {
        const deadline = signal
          ? AbortSignal.any([signal, AbortSignal.timeout(config.timeout)])
          : AbortSignal.timeout(config.timeout);
        posts = Array.from(await waitFor(search(site, config, deadline), deadline)).slice(
          0,
          config.amount,
        );
      } catch (error) {
        signal?.throwIfAborted();
        const message = `Search on ${site}: ${error.message}`;
        manifest.errors.push(message);
        siteResult.error = message;
        emit({ type: 'error', site, message });
        continue;
      }
      siteResult.found = posts.length;
      manifest.found += posts.length;
      emit({ type: 'found', site, count: posts.length });
      const sitePath = config.allsite ? path.join(batchPath, site) : batchPath;
      await fs.mkdir(sitePath, { recursive: true });
      const organized = config.organized && !config.allsite;
      const entries = new Array(posts.length);
      await mapConcurrent(
        posts,
        config.concurrency,
        async (post, index) => {
          const entry = { site, index, ...metadata(post), status: 'skipped', path: null, bytes: 0 };
          entries[index] = entry;
          try {
            if (!post.fileUrl || seen.has(post.fileUrl)) {
              entry.reason = post.fileUrl
                ? 'Duplicate file URL.'
                : 'Post has no downloadable file URL.';
              manifest.skipped++;
              siteResult.skipped++;
              return;
            }
            const name = fileName(post, index);
            seen.add(post.fileUrl);
            const relative = organized
              ? path.join(String(index), name)
              : config.allsite
                ? name
                : path.join('images', name);
            const destination = path.join(sitePath, relative);
            const result = await download(post.fileUrl, destination, { ...config, signal });
            if (organized)
              await writeJson(path.join(path.dirname(destination), 'content.json'), metadata(post));
            entry.path = path.relative(batchPath, destination).split(path.sep).join('/');
            entry.bytes = result.bytes;
            entry.status = 'downloaded';
            manifest.downloaded++;
            manifest.bytes += result.bytes;
            siteResult.downloaded++;
          } catch (error) {
            entry.status = signal?.aborted ? 'cancelled' : 'failed';
            entry.error = error.message;
            if (!signal?.aborted) {
              manifest.failed++;
              siteResult.failed++;
            }
          } finally {
            manifest.processed++;
            emit({ type: 'file', site, file: entry });
          }
        },
        signal,
      ).finally(async () => {
        manifest.files.push(...entries.filter(Boolean));
        if (!organized) {
          const sources = entries
            .filter((entry) => entry?.status === 'downloaded')
            .map((entry) => `[${entry.index}] ~ URL: ${entry.fileUrl}`);
          await fs.writeFile(
            path.join(sitePath, 'sources.txt'),
            `Sources for ${id}\n${sources.join('\n')}\n`,
          );
        }
        await writeJson(path.join(batchPath, 'manifest.json'), manifest);
      });
    }
    const issues = manifest.failed > 0 || manifest.errors.length > 0;
    manifest.status = issues ? (manifest.downloaded > 0 ? 'partial' : 'failed') : 'completed';
  } catch (error) {
    manifest.status = signal?.aborted ? 'cancelled' : 'failed';
    if (!signal?.aborted) manifest.errors.push(error.message);
  } finally {
    manifest.finishedAt = new Date().toISOString();
    await writeJson(path.join(batchPath, 'manifest.json'), manifest);
    emit({ type: 'finished', status: manifest.status, batchPath });
  }
  return { ...manifest, batchPath };
}

module.exports = { extract, searchPosts, siteCredentials, fileName, writeJson };
