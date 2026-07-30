// Homebox Label Printer - content script
// Runs on Homebox location pages (any host, e.g. https://homebox.example.com/location/<uuid>)

(function () {
  const NAV_TEXT_BLACKLIST = new Set([
    'Home', 'Locations', 'Search', 'Profile', 'Tools', 'Sign Out', 'Create',
    'Item / Asset', 'Location', 'Label', 'Welcome', 'HomeB x', 'Items',
    'Edit', 'Delete', 'No Items to Display'
  ]);

  function isVisible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) return false;
    // offsetParent is null for elements with display:none or fixed-position
    // ancestors hidden the same way - a cheap secondary check.
    if (el.offsetParent === null && style.position !== 'fixed') return false;
    return true;
  }

  function getLocationId() {
    const m = window.location.pathname.match(/\/location\/([a-f0-9-]+)/i);
    return m ? m[1] : null;
  }

  // Location name lives in the page's single <h1>, as a direct text node -
  // a sibling <Badge> (total value) can follow inside the same heading, so
  // grabbing the first non-empty text node avoids picking that up too.
  function getLocationName() {
    const h1 = document.querySelector('h1');
    if (!h1) return '';
    for (const node of h1.childNodes) {
      if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) {
        return node.textContent.trim();
      }
    }
    return h1.textContent.trim();
  }

  // Immediate parent: Homebox renders it as a single link inside
  // <nav aria-label="breadcrumb">. Falls back to a looser heuristic (any
  // /location/ link that isn't this page) in case a future UI change drops
  // the breadcrumb's aria-label.
  function getParentLink(locationId) {
    const nav = document.querySelector('nav[aria-label="breadcrumb"]');
    if (nav) {
      const a = nav.querySelector('a[href*="/location/"]');
      if (a) {
        const href = a.getAttribute('href') || '';
        return {
          name: a.textContent.trim(),
          href: new URL(href, window.location.origin).href
        };
      }
      return null;
    }
    const fallback = Array.from(document.querySelectorAll('a[href*="/location/"]'))
      .filter(isVisible)
      .find(a => !(a.getAttribute('href') || '').includes(locationId));
    if (!fallback) return null;
    return {
      name: fallback.textContent.trim(),
      href: new URL(fallback.getAttribute('href'), window.location.origin).href
    };
  }

  // Items: Homebox links each item's whole card (or, in table view, every
  // non-action cell) to /item/<uuid> - a card's link text includes
  // description/tags/price too, so prefer a nested name element
  // (card view's <h2>, table view's plain <span>) over the whole link text.
  // Multiple links can share one item's href (table view, one per column),
  // so entries are de-duped by id, keeping the first (name) match.
  function extractItemName(a) {
    const h2 = a.querySelector('h2');
    if (h2 && h2.textContent.trim()) return h2.textContent.trim();
    const span = a.querySelector('span');
    if (span && span.textContent.trim()) return span.textContent.trim();
    const firstLine = a.textContent.split('\n').map(s => s.trim()).find(Boolean);
    return firstLine || '';
  }

  // Best-effort quantity: Homebox shows it as a small badge (card view) or
  // table column with no distinguishing class/attribute to target directly.
  // Card view's insured/archived indicators are icons (no text), and table
  // view's asset-ID column (which CAN also be a bare number) sits BEFORE the
  // name column while quantity sits right AFTER it in both layouts - so the
  // first bare-integer leaf element found after the name is reliably the
  // quantity, not the asset ID or a later column like price. Falls back to
  // 1 (shown without a count prefix) if nothing matches.
  function extractItemQuantity(a, name) {
    const container = a.closest('tr') || a;
    let seenName = false;
    for (const el of container.querySelectorAll('*')) {
      if (el.children.length > 0) continue; // only leaf elements
      const text = el.textContent.trim();
      if (!seenName) {
        if (text === name) seenName = true;
        continue;
      }
      if (/^\d{1,5}$/.test(text)) return parseInt(text, 10);
    }
    return 1;
  }

  function scrapeItemsOnPage(seen) {
    for (const a of document.querySelectorAll('a[href*="/item/"]')) {
      if (!isVisible(a)) continue;
      const m = (a.getAttribute('href') || '').match(/\/item\/([a-f0-9-]+)/i);
      if (!m) continue;
      const id = m[1];
      if (seen.has(id)) continue;
      const name = extractItemName(a);
      if (name) seen.set(id, { name, quantity: extractItemQuantity(a, name) });
    }
  }

  // Homebox paginates its item list client-side - normally disabled by
  // remove-pagination.js (bumps the "items per page" preference), but
  // that's an async fix that also syncs to the server, racing against
  // Homebox's own preference sync on a slow connection. This is a safety
  // net: if pagination controls are still showing (bare numeric page-
  // number buttons, outside any item card/row so they can't be confused
  // with a quantity/asset-ID badge), click through them and merge items
  // from every page.
  function findNextPageButton(currentPage) {
    let best = null;
    let bestValue = currentPage;
    for (const btn of document.querySelectorAll('button')) {
      if (btn.closest('a[href*="/item/"]') || btn.closest('tr')) continue;
      const text = btn.textContent.trim();
      if (!/^\d{1,4}$/.test(text)) continue;
      const value = parseInt(text, 10);
      if (value > currentPage && (best === null || value < bestValue)) {
        best = btn;
        bestValue = value;
      }
    }
    return best;
  }

  // Resolves once the item link count on the CURRENT page stops changing
  // for 2 consecutive checks (up to ~15s) - generous for the initial,
  // network-bound hydration; pagination clicks are purely client-side (all
  // items are already fetched into memory), so this resolves near-instantly
  // for page 2+.
  function waitForItemsSettled() {
    return new Promise((resolve) => {
      let tries = 0;
      let lastCount = -1;
      let stableChecks = 0;
      const tick = () => {
        tries++;
        const count = document.querySelectorAll('a[href*="/item/"]').length;
        if (count === lastCount) {
          stableChecks++;
        } else {
          stableChecks = 0;
          lastCount = count;
        }
        if (stableChecks >= 2 || tries >= 25) {
          resolve();
        } else {
          setTimeout(tick, 600);
        }
      };
      tick();
    });
  }

  async function scrapeAllItemPages() {
    const seen = new Map();
    await waitForItemsSettled();
    scrapeItemsOnPage(seen);
    let currentPage = 1;
    let guard = 0;
    while (guard < 50) {
      guard++;
      const btn = findNextPageButton(currentPage);
      if (!btn) break;
      btn.click();
      currentPage++;
      await waitForItemsSettled();
      scrapeItemsOnPage(seen);
    }
    return Array.from(seen.values()).map(({ name, quantity }) => (quantity > 1 ? `(${quantity}) ${name}` : name));
  }

  // All uploaded photos, if any - Homebox's photo <img> src already embeds
  // a short-lived access_token query param, so it's a self-contained URL
  // our extension pages can just reuse directly (no separate auth needed).
  function getPhotoUrls() {
    const seen = new Set();
    const urls = [];
    for (const img of document.querySelectorAll('img[src*="/attachments/"]')) {
      if (!isVisible(img) || seen.has(img.src)) continue;
      seen.add(img.src);
      urls.push(img.src);
    }
    return urls;
  }

  // Best-effort scrape of the currently rendered location page. Because the
  // exact DOM/class names can change between Homebox versions, everything
  // scraped here is shown in an EDITABLE form on the print page - so
  // imperfect scraping is always fixable by the user before printing.
  async function scrapeLocationData() {
    const locationId = getLocationId();
    const parent = getParentLink(locationId);

    return {
      url: window.location.href,
      locationId,
      name: getLocationName(),
      parentName: parent ? parent.name : '',
      parentHref: parent ? parent.href : '', // NOT rewritten - used for the ancestor-walk, must stay on the real browsing origin
      items: await scrapeAllItemPages(),
      photoUrls: getPhotoUrls()
    };
  }

  function injectButton() {
    // Homebox is a client-side-routed SPA - navigating away from a location
    // page (e.g. back to /locations) doesn't reload the page, so the content
    // script doesn't re-run and this leftover button would otherwise never
    // get cleaned up, overlapping whatever button belongs on the new route.
    const existing = document.getElementById('hb-btn-group');
    if (!getLocationId()) { // only on single-location pages
      if (existing) existing.remove();
      return;
    }
    if (existing) return;

    const group = document.createElement('div');
    group.id = 'hb-btn-group';
    Object.assign(group.style, {
      position: 'fixed',
      bottom: '24px',
      right: '24px',
      zIndex: 999999,
      display: 'flex',
      flexDirection: 'column',
      gap: '8px'
    });

    function makeBtn(text, bg) {
      const b = document.createElement('button');
      b.textContent = text;
      Object.assign(b.style, {
        padding: '12px 18px',
        background: bg,
        color: '#fff',
        border: 'none',
        borderRadius: '8px',
        fontSize: '14px',
        fontFamily: 'sans-serif',
        cursor: 'pointer',
        boxShadow: '0 2px 8px rgba(0,0,0,0.3)'
      });
      return b;
    }

    const printBtn = makeBtn('🖨  Print Label', '#2c7a4b');
    printBtn.addEventListener('click', async () => {
      // Even on an already-visible page, the photo gallery can still be a
      // beat behind the rest of the page hydrating (e.g. clicking right
      // after navigating here) - wait for the scraped photo count to stop
      // changing before finalizing. Items get their own dedicated wait
      // (plus a pagination-walk) inside scrapeLocationData().
      await new Promise((resolve) => {
        let tries = 0;
        let lastPhotoCount = -1;
        let stableChecks = 0;
        const tick = () => {
          tries++;
          const count = getPhotoUrls().length;
          if (count === lastPhotoCount) {
            stableChecks++;
          } else {
            stableChecks = 0;
            lastPhotoCount = count;
          }
          if (stableChecks >= 2 || tries >= 10) {
            resolve();
          } else {
            setTimeout(tick, 300);
          }
        };
        tick();
      });

      const data = await scrapeLocationData();
      chrome.storage.local.set({ hbLabelData: data }, () => {
        chrome.runtime.sendMessage({ type: 'hbOpenPage', page: 'print.html' });
      });
    });

    const bulkBtn = makeBtn('📋  Bulk Print', '#3b6ea5');
    bulkBtn.addEventListener('click', () => {
      // Bulk mode needs the full locations tree, which only the /locations
      // page renders - so this shortcut just opens that page (on whatever
      // host is actually being browsed). The bulk button injected there
      // (below) takes over from there.
      chrome.runtime.sendMessage({ type: 'hbOpenPage', page: null, url: window.location.origin + '/locations' });
    });

    group.appendChild(printBtn);
    group.appendChild(bulkBtn);
    document.body.appendChild(group);
  }

  // ---- Bulk mode: runs on the /locations tree page ----

  function scrapeLocationTree() {
    // Every location in the tree is a link to /location/<uuid>. Indentation
    // depth (for display only) is approximated by counting ancestor
    // elements up to the tree's root container.
    const links = Array.from(document.querySelectorAll('a[href*="/location/"]'));
    const seen = new Set();
    const result = [];
    for (const a of links) {
      const m = (a.getAttribute('href') || '').match(/\/location\/([a-f0-9-]+)/i);
      if (!m) continue;
      const id = m[1];
      if (seen.has(id)) continue;
      seen.add(id);
      let depth = 0;
      let el = a;
      while (el && el.parentElement) {
        el = el.parentElement;
        depth++;
        if (depth > 40) break; // safety
      }
      result.push({
        id,
        name: a.textContent.trim(),
        url: new URL(a.getAttribute('href'), window.location.origin).href,
        depth
      });
    }
    // Normalize depth to a small 0..N range relative to the shallowest item.
    if (result.length) {
      const min = Math.min(...result.map(r => r.depth));
      result.forEach(r => { r.depth = r.depth - min; });
    }
    return result;
  }

  function injectBulkButton() {
    // Same SPA-navigation cleanup concern as injectButton() above.
    const existing = document.getElementById('hb-bulk-print-btn');
    if (!/\/locations/.test(window.location.pathname)) {
      if (existing) existing.remove();
      return;
    }
    if (existing) return;

    const btn = document.createElement('button');
    btn.id = 'hb-bulk-print-btn';
    btn.textContent = '🖨  Bulk Print Labels';
    Object.assign(btn.style, {
      position: 'fixed',
      bottom: '24px',
      right: '24px',
      zIndex: 999999,
      padding: '12px 18px',
      background: '#2c7a4b',
      color: '#fff',
      border: 'none',
      borderRadius: '8px',
      fontSize: '14px',
      fontFamily: 'sans-serif',
      cursor: 'pointer',
      boxShadow: '0 2px 8px rgba(0,0,0,0.3)'
    });

    btn.addEventListener('click', () => {
      const tree = scrapeLocationTree();
      chrome.storage.local.set({ hbLocationTree: tree }, () => {
        chrome.runtime.sendMessage({ type: 'hbOpenPage', page: 'bulk.html' });
      });
    });

    document.body.appendChild(btn);
  }

  // Auto-expand the full locations tree on load. Homebox already has a
  // built-in "expand all" button (data-pos="start" uniquely identifies it
  // among the tree control button group) - just click it for the user. The
  // tree data loads asynchronously, so retry a bounded number of times
  // per page visit rather than clicking once and giving up; clicking after
  // it's already expanded is harmless (idempotent), but retries stop after
  // a few seconds so a manual re-collapse later isn't fought.
  let autoExpandHref = null;
  let autoExpandAttempts = 0;

  function autoExpandLocationTree() {
    if (!/\/locations/.test(window.location.pathname)) {
      autoExpandHref = null;
      autoExpandAttempts = 0;
      return;
    }
    if (autoExpandHref !== window.location.href) {
      autoExpandHref = window.location.href;
      autoExpandAttempts = 0;
    }
    if (autoExpandAttempts >= 8) return;
    const btn = document.querySelector('button[data-pos="start"]');
    if (btn && isVisible(btn)) {
      btn.click();
      autoExpandAttempts++;
    }
  }

  // Homebox is a single-page app; buttons can get removed on client-side
  // navigation, so keep re-checking.
  injectButton();
  injectBulkButton();
  autoExpandLocationTree();
  setInterval(() => { injectButton(); injectBulkButton(); autoExpandLocationTree(); }, 1500);
})();
