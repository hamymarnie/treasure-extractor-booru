# Treasure Extractor — Booru

A local tool for collecting files from booru websites. Use the browser interface or the original CLI; both run the same downloader and save files on your machine.

Requires **Node.js 22.14 or newer**. No database, frontend build, or cloud account is needed.

## Get started

```sh
npm ci
npm start
```

Open **http://127.0.0.1:3000**. Choose a source, enter tags, and start an extraction. The interface shows download progress, lets you cancel a batch, and provides a library of saved batches with previews and file downloads. Batch history is read from disk and remains available after restarting the server.

To use another port or settings file:

```sh
npm start -- --port 8080 --config ./settings.json
```

The server listens on `127.0.0.1` for local use. Browser settings apply to the current extraction; they do not overwrite `settings.json`. The web tool always saves to the output directory configured when the server starts. One web extraction runs at a time.

## CLI

The original command still works:

```sh
node main.js
```

It reads `settings.json` in your working directory. Arguments override settings:

```sh
node main.js --site safe --tags "landscape rating:safe" --amount 50
node main.js --site danb --tags "scenery" --organized --no-random
npm run cli -- --allsite --amount 10 --concurrency 2
node main.js --output ./my-collection --config ./settings.json
node main.js --list-sites
node main.js --help
```

Press **Ctrl+C** to cancel. The command waits for active transfers to settle and writes the final batch manifest. Exit codes are `0` for a completed extraction, `1` for configuration errors or batches with failures, and `130` for cancellation. A successful search with no matching posts completes with zero downloads.

## Configuration

Your existing `settings.json` remains compatible, including `site`, `tags`, `amount`, `random`, `organized`, and `allsite`. The checked-in settings keep the original repository's chosen source and tags. Here is a small example:

```json
{
  "site": "safe",
  "tags": ["landscape", "rating:safe"],
  "amount": 50,
  "random": true,
  "organized": false,
  "allsite": false,
  "concurrency": 4,
  "retries": 2,
  "timeout": 30000,
  "maxFileSizeMB": 100,
  "outputDir": "./batches"
}
```

| Setting         | Meaning                                                                            | Default     |
| --------------- | ---------------------------------------------------------------------------------- | ----------- |
| `site`          | Site alias, upstream alias, or domain                                              | `danb`      |
| `tags`          | Array of tags, or a space/comma-separated string                                   | `[]`        |
| `amount`        | Maximum posts requested **per site**, from 1 to 1,000                              | `50`        |
| `random`        | Ask the source for randomized results                                              | `true`      |
| `organized`     | Save each post in its own folder with `content.json`                               | `false`     |
| `allsite`       | Search all supported sources, grouped in site folders; ignores `organized`         | `false`     |
| `concurrency`   | Simultaneous file transfers, from 1 to 8                                           | `4`         |
| `retries`       | Additional attempts for transient download failures, from 0 to 5                   | `2`         |
| `timeout`       | Time limit in milliseconds for a search or transfer attempt, from 1,000 to 300,000 | `30000`     |
| `maxFileSizeMB` | Per-file size limit, from 1 to 2,048 MB                                            | `100`       |
| `outputDir`     | Output path, relative to the current working directory or absolute                 | `./batches` |

Spaces and commas separate tags; use underscores inside a tag such as `blue_sky`. Site search limits, access restrictions, authentication, and random sampling can return fewer posts than requested. Duplicate URLs and posts without downloadable files are skipped. The manifest records the actual results.

### Supported sources

| Alias     | Source             | Domain             |
| --------- | ------------------ | ------------------ |
| `danb`    | Danbooru           | danbooru.donmai.us |
| `e621`    | e621               | e621.net           |
| `e926`    | e926               | e926.net           |
| `hypno`   | Hypnohub           | hypnohub.net       |
| `konac`   | Konachan           | konachan.com       |
| `konan`   | Konachan (safe)    | konachan.net       |
| `yandere` | Yande.re           | yande.re           |
| `gelb`    | Gelbooru           | gelbooru.com       |
| `r34`     | Rule34             | rule34.xxx         |
| `r34pa`   | Paheal             | rule34.paheal.net  |
| `derp`    | Derpibooru         | derpibooru.org     |
| `real`    | Realbooru          | realbooru.com      |
| `xbo`     | Xbooru             | xbooru.com         |
| `safe`    | Safebooru          | safebooru.org      |
| `tbib`    | The Big Imageboard | tbib.org           |

Site support and post normalization come from the [booru library](https://github.com/AtoraSuunva/booru). The original `fur` and `loli` aliases are no longer supported by that library; choosing one reports a migration error. All-source mode continues when an individual site's search fails.

### Site credentials

For APIs that require credentials, set environment variables using the selected site's alias. The downloader passes them only to that site and keeps them out of web responses and batch manifests:

```sh
# Bash example; replace these placeholders with your own credentials.
export TREASURE_GELB_API_KEY="your-api-key"
export TREASURE_GELB_USER_ID="your-user-id"
npm start
```

For any supported alias, the optional variables are `TREASURE_<ALIAS>_API_KEY`, `TREASURE_<ALIAS>_USER_ID`, and `TREASURE_<ALIAS>_LOGIN`, with the alias in uppercase. For example, Danbooru uses `TREASURE_DANB_LOGIN` and `TREASURE_DANB_API_KEY`. Derpibooru uses `TREASURE_DERP_TOKEN` instead of these three fields. Use the fields required by your source. Credentials can also be loaded with Node's environment-file option, such as `node --env-file=.env web.js`; `.env` files are ignored by Git.

## Saved files

Every extraction gets a timestamp and a unique ID:

```text
batches/<batch-id>/
  manifest.json
  sources.txt
  images/
    0000-example.jpg
```

With `organized: true`, files and the original post metadata live together:

```text
batches/<batch-id>/
  manifest.json
  0/
    0000-example.jpg
    content.json
```

With `allsite: true`, each site's files and `sources.txt` live in `batches/<batch-id>/<site>/`. Filenames exclude URL query strings and unsafe filesystem characters.

`manifest.json` records the settings, timestamps, status, source metadata, downloaded paths, byte counts, skipped posts, and failures. Files stream to temporary `.part` files and are renamed only after successful completion. Failed or cancelled transfers remove their temporary files. Downloads support HTTP(S) redirects, bounded retries, and file size limits.

Cancellation aborts file transfers immediately and stops waiting for a search. The upstream booru library does not expose search cancellation, so an already-started search may finish in the background. Interrupted processes do not resume automatically. Old pre-v2 batch folders remain on disk; the web library lists batches that have a v2 manifest.

## Development

```sh
npm run dev     # Restart the local server when backend files change
npm run check   # Check JavaScript syntax
npm test        # Run deterministic tests using local fixtures
npm audit --omit=dev
```

Tests cover settings and aliases, the CLI entry point, streaming downloads, redirects, retries, timeouts, size limits, concurrency, cancellation, output formats, web jobs, history, and local API/file access. CI runs checks on Node.js 22 and 24 on Linux and Windows.

The code uses CommonJS and built-in Node APIs. `src/config.js` validates settings, `src/extractor.js` runs batches, `src/downloader.js` streams files, and `src/server.js` serves the local interface. `main.js` remains the CLI entry point; `modules/directory.js` retains compatibility wrappers for the original helper exports. Installed dependencies and generated batches are excluded from Git.

Originally created by **marnie**. Licensed under ISC.
