/*
 * Local development uses the API on port 3000. On Render, pages and API share
 * one origin, so transparently turn legacy localhost API calls into /api calls.
 */
(() => {
  const localApi = 'http://localhost:3000';
  const isLocalStaticSite = location.hostname === 'localhost' && location.port === '8000';
  if (isLocalStaticSite) return;

  const originalFetch = window.fetch.bind(window);
  window.fetch = (resource, options) => {
    if (typeof resource === 'string' && resource.startsWith(localApi)) {
      return originalFetch(resource.slice(localApi.length), options);
    }
    if (resource instanceof Request && resource.url.startsWith(localApi)) {
      return originalFetch(new Request(resource.url.slice(localApi.length), resource), options);
    }
    return originalFetch(resource, options);
  };

  const normalizeLink = link => {
    const href = link.getAttribute('href');
    if (href && href.startsWith(localApi)) link.href = href.slice(localApi.length) || '/';
  };
  document.querySelectorAll('a[href]').forEach(normalizeLink);
  // Login/logout buttons are created after authentication checks on several pages.
  new MutationObserver(records => records.forEach(record => record.addedNodes.forEach(node => {
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    if (node.matches?.('a[href]')) normalizeLink(node);
    node.querySelectorAll?.('a[href]').forEach(normalizeLink);
  }))).observe(document.documentElement, { childList: true, subtree: true });
})();
