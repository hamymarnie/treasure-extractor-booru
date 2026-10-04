'use strict';

const booru = require('booru');

const definitions = [
  ['danb', 'Danbooru', 'danbooru.donmai.us'],
  ['e621', 'e621', 'e621.net'],
  ['e926', 'e926', 'e926.net'],
  ['hypno', 'Hypnohub', 'hypnohub.net'],
  ['konac', 'Konachan', 'konachan.com'],
  ['konan', 'Konachan (safe)', 'konachan.net'],
  ['yandere', 'Yande.re', 'yande.re'],
  ['gelb', 'Gelbooru', 'gelbooru.com'],
  ['r34', 'Rule34', 'rule34.xxx'],
  ['r34pa', 'Paheal', 'rule34.paheal.net'],
  ['derp', 'Derpibooru', 'derpibooru.org'],
  ['real', 'Realbooru', 'realbooru.com'],
  ['xbo', 'Xbooru', 'xbooru.com'],
  ['safe', 'Safebooru', 'safebooru.org'],
  ['tbib', 'The Big Imageboard', 'tbib.org'],
];

const SITES = Object.freeze(
  definitions.map(([alias, name, domain]) =>
    Object.freeze({
      alias,
      name,
      domain,
      nsfw: booru.sites[domain].nsfw,
    }),
  ),
);

function resolveSite(value) {
  const input = String(value).trim().toLowerCase();
  if (input === 'loli' || input === 'fur') {
    throw new Error(
      `The legacy alias "${input}" is no longer supported by the upstream booru library. Choose another site.`,
    );
  }
  const domain = booru.resolveSite(input);
  const site = SITES.find((item) => item.alias === input || item.domain === domain);
  if (!site) throw new Error(`Unknown site "${input}". Use --list-sites to see supported sites.`);
  return site;
}

module.exports = { SITES, resolveSite };
