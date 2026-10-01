import { displayHost } from '../shared/hosts.js';
import type { AddressSuggestion } from '../shared/types.js';

export interface Visit {
  title: string;
  url: string;
  visitedAt: number;
  faviconUrl?: string;
}

interface IndexedPage {
  url: string;
  title: string;
  address: string;
  name: string;
  words: string[];
  visits: number;
  lastVisit: number;
}

interface VisitText {
  title: string;
  url: string;
  address: string;
  name: string;
  words: string[];
  host?: string;
}

// Visit objects survive title/favicon changes and index rebuilds. Weak keys let evicted
// visits disappear without retaining their browsing data in a separate cache.
const visitTexts = new WeakMap<Visit, VisitText>();

function textOf(visit: Visit): VisitText {
  let text = visitTexts.get(visit);
  if (!text || text.title !== visit.title || text.url !== visit.url) {
    const name = visit.title.toLocaleLowerCase('tr');
    text = { title: visit.title, url: visit.url, address: bareUrl(visit.url), name, words: wordsOf(name) };
    visitTexts.set(visit, text);
  }
  return text;
}

export interface HistoryIndex {
  pages: readonly IndexedPage[];
  favicons: ReadonlyMap<string, string>;
}

export interface SuggestionSources {
  tabs: readonly { id: string; title: string; url: string }[];
  bookmarks: readonly { title: string; url: string }[];
  history: HistoryIndex;
}

export const EMPTY_HISTORY_INDEX: HistoryIndex = { pages: [], favicons: new Map() };

export const MAX_SUGGESTIONS = 6;
const KIND_ORDER: Record<AddressSuggestion['kind'], number> = { command: 0, tab: 1, bookmark: 2, history: 3 };

function bareUrl(url: string): string {
  return url.replace(/^[a-z][a-z\d+\-.]*:\/\/(www\.)?/i, '').toLocaleLowerCase('tr');
}

function wordsOf(name: string): string[] {
  return name.split(/[\s\-–—|:·,.]+/);
}

function matchText(term: string, address: string, name: string, words: readonly string[]): number {
  if (address.startsWith(term)) return 4;
  if (name.startsWith(term) || words.some((word) => word.startsWith(term))) return 3;
  if (address.includes(term)) return 2;
  if (name.includes(term)) return 1;
  return 0;
}

function matchScore(term: string, title: string, url: string): number {
  const name = title.toLocaleLowerCase('tr');
  return matchText(term, bareUrl(url), name, wordsOf(name));
}

export function indexHistory(history: readonly Visit[]): HistoryIndex {
  const pages = new Map<string, IndexedPage>();
  const favicons = new Map<string, string>();
  for (const visit of history) {
    const seen = pages.get(visit.url);
    if (seen) {
      seen.visits++;
    } else {
      const { address, name, words } = textOf(visit);
      pages.set(visit.url, {
        url: visit.url,
        title: visit.title,
        address,
        name,
        words,
        visits: 1,
        lastVisit: visit.visitedAt,
      });
    }
    if (!visit.faviconUrl) continue;
    const text = textOf(visit);
    const host = (text.host ??= displayHost(visit.url));
    if (host && !favicons.has(host)) favicons.set(host, visit.faviconUrl);
  }
  return { pages: [...pages.values()], favicons };
}

interface Candidate extends AddressSuggestion {
  score: number;
  visits: number;
  lastVisit: number;
}

function compareCandidates(a: Candidate, b: Candidate): number {
  return (
    b.score - a.score || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || b.visits - a.visits || b.lastVisit - a.lastVisit
  );
}

export function suggest(input: string, sources: SuggestionSources, limit = MAX_SUGGESTIONS): AddressSuggestion[] {
  const term = input.trim().toLocaleLowerCase('tr').slice(0, 200);
  const count = Math.max(0, Math.trunc(limit));
  if (term === '' || !count) return [];
  const byUrl = new Map<string, Candidate>();
  const offer = (candidate: Candidate) => {
    const existing = byUrl.get(candidate.url);
    if (!existing) {
      byUrl.set(candidate.url, candidate);
      return;
    }
    if (KIND_ORDER[candidate.kind] < KIND_ORDER[existing.kind]) {
      byUrl.set(candidate.url, { ...candidate, visits: existing.visits, lastVisit: existing.lastVisit });
    }
  };

  for (const tab of sources.tabs) {
    const score = matchScore(term, tab.title, tab.url);
    if (score > 0)
      offer({ kind: 'tab', title: tab.title, url: tab.url, tabId: tab.id, score, visits: 0, lastVisit: 0 });
  }
  for (const bookmark of sources.bookmarks) {
    const score = matchScore(term, bookmark.title, bookmark.url);
    if (score > 0)
      offer({ kind: 'bookmark', title: bookmark.title, url: bookmark.url, score, visits: 0, lastVisit: 0 });
  }
  // Keep only the requested results instead of sorting every history match.
  const ranked: Candidate[] = [];
  const rank = (candidate: Candidate) => {
    if (ranked.length === count && compareCandidates(candidate, ranked[ranked.length - 1]) >= 0) return;
    let start = 0;
    let end = ranked.length;
    while (start < end) {
      const middle = (start + end) >>> 1;
      if (compareCandidates(candidate, ranked[middle]) < 0) end = middle;
      else start = middle + 1;
    }
    ranked.splice(start, 0, candidate);
    if (ranked.length > count) ranked.pop();
  };
  for (const page of sources.history.pages) {
    const score = matchText(term, page.address, page.name, page.words);
    if (score === 0) continue;
    const existing = byUrl.get(page.url);
    if (existing) {
      existing.visits = page.visits;
      existing.lastVisit = page.lastVisit;
    } else {
      rank({
        kind: 'history',
        title: page.title,
        url: page.url,
        score,
        visits: page.visits,
        lastVisit: page.lastVisit,
      });
    }
  }
  for (const candidate of byUrl.values()) rank(candidate);

  const { favicons } = sources.history;
  return ranked.map(({ kind, title, url, tabId }) => {
    const suggestion: AddressSuggestion = tabId ? { kind, title, url, tabId } : { kind, title, url };
    const faviconUrl = favicons.get(displayHost(url));
    if (faviconUrl) suggestion.faviconUrl = faviconUrl;
    return suggestion;
  });
}
