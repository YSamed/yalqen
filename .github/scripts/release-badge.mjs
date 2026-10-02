import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const repo = process.env.GITHUB_REPOSITORY ?? 'YSamed/yalqen'
const outDir = process.argv[2] ?? 'badges'

const palette = {
  light: { fill: '#ffffff', stroke: '#e3e2e8', strong: '#1d1d22', muted: '#6a6a75', divider: '#dcdbe2', shadow: 0.1 },
  dark: { fill: '#161b22', stroke: '#30363d', strong: '#f0f6fc', muted: '#9198a1', divider: '#3d444d', shadow: 0 },
}

const fontSize = 14
const height = 36
const margin = { x: 10, top: 6, bottom: 14 }
const fontFamily = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif"

// Helvetica advance widths per 1000 em. Viewers render with their own system font, so each
// text element pins its width with textLength and the renderer absorbs the gap in spacing.
const regularWidths = {
  ' ': 278, ',': 278, '.': 278, a: 556, b: 556, c: 500, d: 556, e: 556, f: 278, g: 556, h: 556, i: 222, j: 222,
  k: 500, l: 222, m: 833, n: 556, o: 556, p: 556, q: 556, r: 333, s: 500, t: 278, u: 556, v: 500, w: 722, x: 500,
  y: 500, z: 500,
}
const boldWidths = { ',': 278, '.': 278, v: 556 }

function textWidth(text, bold) {
  const table = bold ? boldWidths : regularWidths
  let units = 0
  for (const char of text) units += table[char] ?? (/\d/.test(char) ? 556 : 600)
  return Math.ceil((units / 1000) * fontSize * (bold ? 1.04 : 1))
}

function releasedAgo(publishedAt, now) {
  const days = Math.max(0, Math.floor((now - Date.parse(publishedAt)) / 86_400_000))
  if (days === 0) return 'released today'
  if (days === 1) return 'released yesterday'
  if (days < 14) return `released ${days} days ago`
  if (days < 60) return `released ${Math.floor(days / 7)} weeks ago`
  return `released ${Math.floor(days / 30)} months ago`
}

const escapeXml = (text) => text.replace(/[<>&'"]/g, (char) => `&#${char.charCodeAt(0)};`)

function renderBadge(groups, theme) {
  const colors = palette[theme]
  const cy = margin.top + height / 2
  const baseline = cy + fontSize * 0.35
  let x = margin.x + 16
  let body = `<circle cx="${x + 4}" cy="${cy}" r="8" fill="#2fb344" fill-opacity=".18"/><circle cx="${x + 4}" cy="${cy}" r="4" fill="#2fb344"/>`
  x += 18

  groups.forEach((group, index) => {
    if (index > 0) {
      x += 12
      body += `<rect x="${x}" y="${margin.top + 10}" width="1" height="${height - 20}" fill="${colors.divider}"/>`
      x += 13
    }
    group.forEach(({ text, bold }, position) => {
      if (position > 0) x += 6
      const width = textWidth(text, bold)
      const weight = bold ? ' font-weight="650"' : ''
      body += `<text x="${x}" y="${baseline}" fill="${bold ? colors.strong : colors.muted}"${weight} textLength="${width}" lengthAdjust="spacing">${escapeXml(text)}</text>`
      x += width
    })
  })

  const pillWidth = x + 16 - margin.x
  const totalWidth = pillWidth + margin.x * 2
  const totalHeight = height + margin.top + margin.bottom
  const label = escapeXml(groups.map((group) => group.map((segment) => segment.text).join(' ')).join(', '))
  const shadow = colors.shadow
    ? `<defs><filter id="s" x="-10%" y="-40%" width="120%" height="200%"><feDropShadow dx="0" dy="4" stdDeviation="6" flood-color="#3c3c5a" flood-opacity="${colors.shadow}"/></filter></defs>`
    : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="${totalHeight}" viewBox="0 0 ${totalWidth} ${totalHeight}" role="img" aria-label="${label}"><title>${label}</title>${shadow}<rect x="${margin.x + 0.5}" y="${margin.top + 0.5}" width="${pillWidth - 1}" height="${height - 1}" rx="${(height - 1) / 2}" fill="${colors.fill}" stroke="${colors.stroke}"${shadow && ' filter="url(#s)"'}/><g font-family="${fontFamily}" font-size="${fontSize}">${body}</g></svg>\n`
}

async function stableReleases() {
  const releases = []
  for (let page = 1; ; page++) {
    const response = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=100&page=${page}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        ...(process.env.GITHUB_TOKEN && { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }),
      },
    })
    if (!response.ok) throw new Error(`GitHub API responded ${response.status}`)
    const batch = await response.json()
    releases.push(...batch.filter((release) => !release.draft && !release.prerelease))
    if (batch.length < 100) return releases
  }
}

const isDmg = (asset) => asset.name.endsWith('.dmg')
const releases = await stableReleases()
// A release is published before its assets finish uploading, so skip ones without a DMG yet.
const latest = releases
  .filter((release) => release.assets.some(isDmg))
  .sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at))[0]
if (!latest) throw new Error('no published release has a .dmg asset')
const downloads = releases.flatMap((release) => release.assets).filter(isDmg).reduce((sum, asset) => sum + asset.download_count, 0)

async function uniqueDownloads() {
  try {
    const response = await fetch('https://yalqen.com/api/downloads', { signal: AbortSignal.timeout(8000) })
    if (!response.ok) return null
    const { uniqueDownloads: count } = await response.json()
    return Number.isSafeInteger(count) && count >= 0 ? count : null
  } catch {
    return null
  }
}
const unique = await uniqueDownloads()

const groups = [
  [{ text: latest.tag_name, bold: true }, { text: releasedAgo(latest.published_at, Date.now()), bold: false }],
  [{ text: (unique ?? downloads).toLocaleString('en-US'), bold: true }, { text: unique !== null ? 'unique downloads' : 'downloads', bold: false }],
]
mkdirSync(outDir, { recursive: true })
for (const theme of ['light', 'dark']) writeFileSync(join(outDir, `release-${theme}.svg`), renderBadge(groups, theme))
console.log(`${latest.tag_name}, ${downloads} DMG downloads, ${unique ?? 'no'} unique downloads`)
