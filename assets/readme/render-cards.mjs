// Renders the README feature cards and install requirements: node assets/readme/render-cards.mjs
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const outDir = join(dirname(fileURLToPath(import.meta.url)), 'cards')

const icons = {
  command: '<path d="M7 9a2 2 0 1 1 2 -2v10a2 2 0 1 1 -2 -2h10a2 2 0 1 1 -2 2v-10a2 2 0 1 1 2 2h-10"/>',
  tabs: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M9 4v16"/>',
  devtools: '<path d="M7 8l-4 4l4 4"/><path d="M17 8l4 4l-4 4"/><path d="M14 4l-4 16"/>',
  blocking: '<path d="M12 3a12 12 0 0 0 8.5 3a12 12 0 0 1 -8.5 15a12 12 0 0 1 -8.5 -15a12 12 0 0 0 8.5 -3"/><path d="M9 12l2 2l4 -4"/>',
  https: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11v-4a4 4 0 1 1 8 0v4"/>',
  memory: '<path d="M13 3l0 7l6 0l-8 11l0 -7l-6 0l8 -11"/>',
  macos: '<rect x="5" y="6" width="14" height="10" rx="1"/><path d="M3 19h18"/>',
  silicon: '<rect x="5" y="5" width="14" height="14" rx="1"/><path d="M9 9h6v6h-6z"/><path d="M3 10h2M3 14h2M10 3v2M14 3v2M21 10h-2M21 14h-2M14 21v-2M10 21v-2"/>',
  signed: '<path d="M12 3a12 12 0 0 0 8.5 3a12 12 0 0 1 -8.5 15a12 12 0 0 1 -8.5 -15a12 12 0 0 0 8.5 -3"/><path d="M9 12l2 2l4 -4"/>',
  updates: '<path d="M20 11a8.1 8.1 0 0 0 -15.5 -2m-.5 -4v4h4"/><path d="M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4"/>',
}

const requirements = {
  en: ['macOS 13+', 'Apple Silicon', 'Signed and notarized', 'Updates itself'],
  tr: ['macOS 13+', 'Apple Silicon', 'İmzalı ve notarize', 'Kendini günceller'],
  'zh-CN': ['macOS 13+', 'Apple Silicon', '已签名并公证', '自动更新'],
}

const copy = {
  en: {
    command: ['Command bar', 'Open tabs, search and run actions', 'without leaving the keyboard.'],
    tabs: ['Vertical tabs', 'Pinned tabs, address bar and window', 'controls in one compact panel.'],
    devtools: ['Developer tools', 'Chromium DevTools built in, plus', 'a one-key phone view.'],
    blocking: ['Ad and tracker blocking', 'A built-in filter engine with', 'third-party cookie blocking.'],
    https: ['HTTPS-only and secure DNS', 'Keep connections and DNS', 'lookups encrypted.'],
    memory: ['Memory saver', 'Idle tabs free their memory and', 'reload when you click them.'],
  },
  tr: {
    command: ['Komut çubuğu', 'Sekme aç, ara ve komut çalıştır;', 'klavyeden hiç ayrılmadan.'],
    tabs: ['Dikey sekmeler', 'Sabit sekmeler, adres çubuğu ve', 'pencere düğmeleri tek panelde.'],
    devtools: ['Geliştirici araçları', 'Yerleşik Chromium DevTools ve', 'tek tuşla telefon görünümü.'],
    blocking: ['Reklam engelleme', 'Yerleşik filtre motoru; izleyici', 've üçüncü taraf çerez engelleme.'],
    https: ['HTTPS ve güvenli DNS', 'Bağlantılar ve DNS sorguları', 'şifreli kalır.'],
    memory: ['Bellek tasarrufu', 'Boştaki sekmeler belleği boşaltır,', 'tıklayınca yeniden yüklenir.'],
  },
  'zh-CN': {
    command: ['命令栏', '无需离开键盘即可打开标签页、', '搜索和执行操作。'],
    tabs: ['垂直标签页', '固定标签页、地址栏和窗口控制', '集中在一个紧凑面板中。'],
    devtools: ['开发者工具', '内置 Chromium DevTools，', '一键切换手机视图。'],
    blocking: ['广告和跟踪器拦截', '内置过滤引擎，', '并拦截第三方 Cookie。'],
    https: ['仅 HTTPS 和安全 DNS', '连接和 DNS 查询', '始终保持加密。'],
    memory: ['内存节省', '闲置标签页释放内存，', '点击时重新加载。'],
  },
}

const palette = {
  light: { fill: '#ffffff', stroke: '#e3e2e8', title: '#1d1d22', text: '#6a6a75', icon: '#e8711a', tint: 0.12, shadow: 0.08 },
  dark: { fill: '#161b22', stroke: '#30363d', title: '#f0f6fc', text: '#9198a1', icon: '#fc893e', tint: 0.16, shadow: 0 },
}

const width = 276
const height = 136
const margin = { x: 8, top: 4, bottom: 12 }
const fontFamily = "-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',Helvetica,Arial,sans-serif"
const escapeXml = (text) => text.replace(/[<>&'"]/g, (char) => `&#${char.charCodeAt(0)};`)

function card(id, [title, ...lines], theme) {
  const colors = palette[theme]
  const x = margin.x
  const y = margin.top
  const shadow = colors.shadow
    ? `<defs><filter id="s" x="-10%" y="-10%" width="120%" height="130%"><feDropShadow dx="0" dy="3" stdDeviation="4" flood-color="#3c3c5a" flood-opacity="${colors.shadow}"/></filter></defs>`
    : ''
  const text = lines
    .map((line, index) => `<text x="${x + 18}" y="${y + 100 + index * 19}" font-size="13" fill="${colors.text}">${escapeXml(line)}</text>`)
    .join('')
  const totalWidth = width + margin.x * 2
  const totalHeight = height + margin.top + margin.bottom
  const label = escapeXml(`${title}. ${lines.join(' ')}`)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="${totalHeight}" viewBox="0 0 ${totalWidth} ${totalHeight}" role="img" aria-label="${label}"><title>${label}</title>${shadow}<rect x="${x + 0.5}" y="${y + 0.5}" width="${width - 1}" height="${height - 1}" rx="16" fill="${colors.fill}" stroke="${colors.stroke}"${shadow && ' filter="url(#s)"'}/><circle cx="${x + 36}" cy="${y + 36}" r="18" fill="${colors.icon}" fill-opacity="${colors.tint}"/><g transform="translate(${x + 26} ${y + 26}) scale(${20 / 24})" fill="none" stroke="${colors.icon}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${icons[id]}</g><g font-family="${fontFamily}"><text x="${x + 18}" y="${y + 76}" font-size="15" font-weight="650" fill="${colors.title}">${escapeXml(title)}</text>${text}</g></svg>\n`
}

// Helvetica advance widths per 1000 em; textLength absorbs the difference to the viewer's font.
const charWidths = {
  ' ': 278, '+': 584, '.': 278, A: 667, S: 667, O: 778, a: 556, c: 500, d: 556, e: 556, f: 278, g: 556, h: 556,
  i: 222, l: 222, m: 833, n: 556, o: 556, p: 556, r: 333, s: 500, t: 278, u: 556, v: 500, z: 500, k: 500, K: 667,
  'İ': 278, 'ı': 222, 'ü': 556,
}

function textWidth(text, fontSize) {
  let units = 0
  for (const char of text) units += /[\u3000-\u9fff\uff00-\uffef]/.test(char) ? 1000 : charWidths[char] ?? (/\d/.test(char) ? 556 : 560)
  return Math.ceil((units / 1000) * fontSize)
}

function requirementsPill(items, theme) {
  const colors = palette[theme]
  const fontSize = 13.5
  const pillHeight = 36
  const cy = margin.top + pillHeight / 2
  let x = margin.x + 16
  let body = ''
  items.forEach((label, index) => {
    if (index > 0) {
      x += 14
      body += `<rect x="${x}" y="${margin.top + 11}" width="1" height="${pillHeight - 22}" fill="${colors.stroke}"/>`
      x += 15
    }
    const id = ['macos', 'silicon', 'signed', 'updates'][index]
    body += `<g transform="translate(${x} ${cy - 8}) scale(${16 / 24})" fill="none" stroke="${colors.icon}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${icons[id]}</g>`
    x += 16 + 7
    const width = textWidth(label, fontSize)
    body += `<text x="${x}" y="${cy + fontSize * 0.35}" font-size="${fontSize}" fill="${colors.title}" textLength="${width}" lengthAdjust="spacing">${escapeXml(label)}</text>`
    x += width
  })
  const pillWidth = x + 16 - margin.x
  const totalWidth = pillWidth + margin.x * 2
  const totalHeight = pillHeight + margin.top + margin.bottom
  const label = escapeXml(items.join(', '))
  const shadow = colors.shadow
    ? `<defs><filter id="s" x="-5%" y="-30%" width="110%" height="180%"><feDropShadow dx="0" dy="3" stdDeviation="4" flood-color="#3c3c5a" flood-opacity="${colors.shadow}"/></filter></defs>`
    : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="${totalHeight}" viewBox="0 0 ${totalWidth} ${totalHeight}" role="img" aria-label="${label}"><title>${label}</title>${shadow}<rect x="${margin.x + 0.5}" y="${margin.top + 0.5}" width="${pillWidth - 1}" height="${pillHeight - 1}" rx="${(pillHeight - 1) / 2}" fill="${colors.fill}" stroke="${colors.stroke}"${shadow && ' filter="url(#s)"'}/><g font-family="${fontFamily}">${body}</g></svg>\n`
}

mkdirSync(outDir, { recursive: true })
for (const [lang, items] of Object.entries(requirements)) {
  for (const theme of ['light', 'dark']) {
    const suffix = lang === 'en' ? '' : `.${lang}`
    writeFileSync(join(outDir, `requirements-${theme}${suffix}.svg`), requirementsPill(items, theme))
  }
}
for (const [lang, features] of Object.entries(copy)) {
  for (const [id, lines] of Object.entries(features)) {
    for (const theme of ['light', 'dark']) {
      const suffix = lang === 'en' ? '' : `.${lang}`
      writeFileSync(join(outDir, `${id}-${theme}${suffix}.svg`), card(id, lines, theme))
    }
  }
}
