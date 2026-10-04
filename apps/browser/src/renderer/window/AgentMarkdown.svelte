<script lang="ts">
  import DOMPurify from 'dompurify';
  import { marked } from 'marked';

  let { text }: { text: string } = $props();
  const html = $derived(
    DOMPurify.sanitize(marked.parse(text, { async: false, breaks: true }), {
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
    }),
  );

  function links(element: HTMLDivElement): { destroy(): void } {
    const click = (event: MouseEvent) => {
      const link = event.target instanceof Element ? event.target.closest('a') : null;
      if (!link) return;
      event.preventDefault();
      try {
        const url = new URL(link.getAttribute('href') ?? '');
        if (url.protocol === 'https:' || url.protocol === 'http:')
          window.yalqen.send({ type: 'new-tab', url: url.href });
      } catch {}
    };
    element.addEventListener('click', click);
    return { destroy: () => element.removeEventListener('click', click) };
  }
</script>

<!-- Only the allowlisted, sanitized output of DOMPurify enters this element. -->
<!-- eslint-disable-next-line svelte/no-at-html-tags -->
<div class="markdown" use:links>{@html html}</div>

<style>
  .markdown {
    overflow-wrap: anywhere;
    font-size: var(--ai-text);
    line-height: 1.6;
    user-select: text;
  }
  .markdown :global(p) {
    margin: 0 0 10px;
  }
  .markdown :global(> :last-child) {
    margin-bottom: 0;
  }
  .markdown :global(h1),
  .markdown :global(h2),
  .markdown :global(h3),
  .markdown :global(h4) {
    margin: 16px 0 6px;
    font-size: var(--ai-text);
    font-weight: 600;
    line-height: 1.4;
  }
  .markdown :global(h1),
  .markdown :global(h2) {
    font-size: 15px;
  }
  .markdown :global(ul),
  .markdown :global(ol) {
    margin: 6px 0 12px;
    padding-left: 20px;
  }
  .markdown :global(li) {
    padding-left: 2px;
  }
  .markdown :global(li p) {
    margin: 4px 0;
  }
  .markdown :global(a) {
    color: var(--accent);
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .markdown :global(code) {
    padding: 1px 5px;
    border-radius: 5px;
    background: var(--surface-hover);
    font: var(--ai-mono) var(--ai-mono-font);
  }
  .markdown :global(pre) {
    max-width: 100%;
    margin: 12px 0;
    padding: 10px 12px;
    overflow-x: auto;
    border: 1px solid var(--page-divider);
    border-radius: 10px;
    background: var(--surface-strong);
  }
  .markdown :global(pre code) {
    padding: 0;
    background: none;
    font-size: var(--ai-mono);
    line-height: 1.6;
  }
  .markdown :global(blockquote) {
    margin: 10px 0;
    padding-left: 12px;
    border-left: 2px solid var(--accent);
    color: var(--text-muted);
  }
  .markdown :global(hr) {
    margin: 14px 0;
    border: 0;
    border-top: 1px solid var(--page-divider);
  }
  .markdown :global(table) {
    display: block;
    max-width: 100%;
    overflow-x: auto;
    border-collapse: collapse;
    font-size: var(--ai-small);
  }
  .markdown :global(th),
  .markdown :global(td) {
    padding: 5px 8px;
    border-bottom: 1px solid var(--page-divider);
    text-align: left;
  }
</style>
