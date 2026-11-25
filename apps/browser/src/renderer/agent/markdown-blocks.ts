import DOMPurify from 'dompurify';
import { Marked, type Token, type TokensList } from 'marked';

const markdown = new Marked({ async: false, breaks: true });
const SANITIZE = {
  ALLOWED_TAGS: [
    'p',
    'br',
    'strong',
    'em',
    'del',
    'a',
    'code',
    'pre',
    'ul',
    'ol',
    'li',
    'blockquote',
    'h1',
    'h2',
    'h3',
    'h4',
    'hr',
    'table',
    'thead',
    'tbody',
    'tr',
    'th',
    'td',
  ],
  ALLOWED_ATTR: ['href', 'title', 'start'],
};

export interface MarkdownBlock {
  raw: string;
  links: string;
  html: string;
}

// A streamed reply changes only its last blocks, so earlier blocks keep their sanitized HTML and their DOM.
// Reference links are compared too: a definition that arrives later changes how earlier blocks render.
export function markdownBlocks(text: string, previous: MarkdownBlock[]): MarkdownBlock[] {
  const tokens = markdown.lexer(text);
  const links = JSON.stringify(tokens.links);
  return tokens.map((token, index) => {
    const old = previous[index];
    return old?.raw === token.raw && old.links === links
      ? old
      : { raw: token.raw, links, html: render(token, tokens.links) };
  });
}

function render(token: Token, links: TokensList['links']): string {
  return DOMPurify.sanitize(markdown.parser(Object.assign([token], { links })), SANITIZE);
}
