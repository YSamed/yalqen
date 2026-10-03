import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_URL = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).repository;
const POST_LIMIT = 300;
const HIGHLIGHT_SECTIONS = ['Features', 'Bug Fixes', 'Performance'];

const USAGE = `Usage: node scripts/release-announcement.mjs [version] [--changelog <path>]

Prints a short post (X/Bluesky, at most ${POST_LIMIT} characters) and a Discussions post
for the given version, or the newest one in CHANGELOG.md.`;

export function parseRelease(changelog, version) {
  const releases = changelog.split(/^## /m).slice(1);
  const block = version ? releases.find((release) => release.startsWith(`[${version}]`)) : releases[0];
  if (!block) return null;
  const [heading, ...lines] = block.split('\n');
  const sections = {};
  let current = null;
  for (const line of lines) {
    const section = line.match(/^### (.+)/);
    if (section) {
      current = section[1].trim();
      sections[current] = [];
    } else if (current && line.startsWith('* ')) {
      sections[current].push(plainEntry(line.slice(2)));
    }
  }
  return {
    version: heading.match(/^\[([^\]]+)\]/)?.[1] ?? heading.trim(),
    date: heading.match(/\((\d{4}-\d{2}-\d{2})\)/)?.[1] ?? null,
    sections,
  };
}

function plainEntry(entry) {
  const text = entry.replace(/\s*\(\[[^\]]+\]\([^)]+\)\)/g, '').trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function highlights(release) {
  return HIGHLIGHT_SECTIONS.flatMap((section) => release.sections[section] ?? []);
}

export function shortPost(release) {
  const head = `Yalqen ${release.version} is out.`;
  const tail = `${REPO_URL}/releases/tag/v${release.version}`;
  const items = highlights(release).map((item) => `• ${item}`);
  const compose = (lines) => [head, '', ...lines, '', tail].join('\n').replace(/\n{3,}/g, '\n\n');
  for (let count = items.length; count > 0; count--) {
    const omitted = items.length - count;
    const lines = omitted ? [...items.slice(0, count), `…and ${omitted} more`] : items.slice(0, count);
    if (compose(lines).length <= POST_LIMIT) return compose(lines);
  }
  return compose(items.length ? [`${items.length} changes`] : []);
}

export function discussionPost(release) {
  const body = HIGHLIGHT_SECTIONS.filter((section) => release.sections[section]?.length).flatMap((section) => [
    `### ${section}`,
    '',
    ...release.sections[section].map((item) => `- ${item}`),
    '',
  ]);
  return [
    `## Yalqen ${release.version}${release.date ? ` (${release.date})` : ''}`,
    '',
    ...(body.length ? body : ['Maintenance release.', '']),
    `Download: ${REPO_URL}/releases/tag/v${release.version}`,
    '',
    'Already installed? Yalqen updates itself; the update button in the toolbar installs it right away.',
  ].join('\n');
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log(USAGE);
    return;
  }
  const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const flag = args.indexOf('--changelog');
  const changelogPath = flag >= 0 ? path.resolve(args[flag + 1]) : path.join(project, 'CHANGELOG.md');
  const version = args
    .find((arg, index) => !arg.startsWith('--') && (flag < 0 || index !== flag + 1))
    ?.replace(/^v/, '');
  const release = parseRelease(fs.readFileSync(changelogPath, 'utf8'), version);
  if (!release) {
    console.error(`No release ${version ?? ''} found in ${changelogPath}`);
    process.exitCode = 1;
    return;
  }
  console.log(`--- Short post (X / Bluesky) ---\n\n${shortPost(release)}\n`);
  console.log(`--- Discussions ---\n\n${discussionPost(release)}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
