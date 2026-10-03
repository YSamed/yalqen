const SEARCH_ICON =
  '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 2.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9zm3.3 7.8 3.2 3.2"/></svg>';

export function searchFieldMarkup(options: {
  action: string;
  label: string;
  valueHtml: string;
  autofocus?: boolean;
}): string {
  return (
    `<form class="search-field inset" action="${options.action}" method="get" role="search">` +
    `<span class="search-icon">${SEARCH_ICON}</span>` +
    `<input name="q" type="search" placeholder="${options.label}" aria-label="${options.label}" value="${options.valueHtml}"${options.autofocus ? ' autofocus' : ''} />` +
    '</form>'
  );
}
