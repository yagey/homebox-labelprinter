(function () {
  const listEl = document.getElementById('list');
  const generateBtn = document.getElementById('generate-btn');
  const statusEl = document.getElementById('status');

  let tree = [];

  function render() {
    listEl.innerHTML = '';
    tree.forEach((loc, i) => {
      const row = document.createElement('div');
      row.className = 'row';
      row.style.paddingLeft = (loc.depth * 18) + 'px';

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.id = 'loc-' + i;
      cb.dataset.index = i;

      const label = document.createElement('label');
      label.htmlFor = cb.id;
      label.textContent = loc.name;

      row.appendChild(cb);
      row.appendChild(label);
      listEl.appendChild(row);
    });
  }

  document.getElementById('select-all').addEventListener('click', () => {
    listEl.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = true);
  });
  document.getElementById('select-none').addEventListener('click', () => {
    listEl.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
  });

  // Self-contained function injected into each location's tab.
  // Cannot reference anything outside its own body - chrome.scripting
  // serializes and runs this in the target page.
  function standaloneScrape() {
    return new Promise((resolve) => {
      function isVisible(el) {
        if (!el) return false;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) return false;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) return false;
        if (el.offsetParent === null && style.position !== 'fixed') return false;
        return true;
      }

      // Item name: prefer a nested name element (card view's <h2>, table
      // view's plain <span>) over the whole link's text, which in card view
      // also includes description/tags/price.
      function extractItemName(a) {
        const h2 = a.querySelector('h2');
        if (h2 && h2.textContent.trim()) return h2.textContent.trim();
        const span = a.querySelector('span');
        if (span && span.textContent.trim()) return span.textContent.trim();
        const firstLine = a.textContent.split('\n').map(s => s.trim()).find(Boolean);
        return firstLine || '';
      }

      // Best-effort quantity: Homebox shows it as a small badge (card view)
      // or table column with no distinguishing class/attribute to target
      // directly. Card view's insured/archived indicators are icons (no
      // text), and table view's asset-ID column (which CAN also be a bare
      // number) sits BEFORE the name column while quantity sits right AFTER
      // it in both layouts - so the first bare-integer leaf element found
      // after the name is reliably the quantity, not the asset ID or a
      // later column like price. Falls back to 1 (shown without a count
      // prefix) if nothing matches.
      function extractItemQuantity(a, name) {
        const container = a.closest('tr') || a;
        let seenName = false;
        for (const el of container.querySelectorAll('*')) {
          if (el.children.length > 0) continue;
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
          if (seen.has(m[1])) continue;
          const itemName = extractItemName(a);
          if (itemName) seen.set(m[1], { name: itemName, quantity: extractItemQuantity(a, itemName) });
        }
      }

      // Homebox paginates its item list client-side - normally disabled by
      // this extension's remove-pagination.js (a separate content script
      // that bumps the "items per page" preference), but that's an async
      // fix that also syncs to the server, racing against Homebox's own
      // preference sync on a slow connection - especially with several
      // background tabs scraping at once, it can lose that race. This is a
      // safety net: if pagination controls are still showing (bare numeric
      // page-number buttons, outside any item card/row so they can't be
      // confused with a quantity/asset-ID badge), click through them and
      // merge items from every page.
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

      // A browser tab reaching "complete" only means the HTML/assets
      // finished loading, not that the Nuxt/Vue app has hydrated and
      // rendered the items yet. On a remote host with real network latency
      // (vs. near-zero on localhost) that hydration can take a few
      // seconds, so give this a generous budget (up to ~15s) rather than
      // giving up early - resolving once the item link count on the
      // CURRENT page stops changing for 2 consecutive checks. Pagination
      // clicks are purely client-side (all items are already fetched into
      // memory), so this resolves near-instantly for page 2+.
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

      async function attempt() {
        const locationId = (location.pathname.match(/\/location\/([a-f0-9-]+)/i) || [])[1];

        // Immediate parent: single link inside <nav aria-label="breadcrumb">.
        let parentName = '';
        let parentHref = '';
        const nav = document.querySelector('nav[aria-label="breadcrumb"]');
        if (nav) {
          const a = nav.querySelector('a[href*="/location/"]');
          if (a) {
            parentName = a.textContent.trim();
            parentHref = new URL(a.getAttribute('href'), location.origin).href;
          }
        }

        // Location name: first text node of the page's <h1> (skips a
        // sibling total-value badge rendered inside the same heading).
        let name = '';
        const h1 = document.querySelector('h1');
        if (h1) {
          for (const node of h1.childNodes) {
            if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) {
              name = node.textContent.trim();
              break;
            }
          }
          if (!name) name = h1.textContent.trim();
        }

        const items = await scrapeAllItemPages();

        // All uploaded photos, if any - each <img> src already embeds a
        // short-lived access_token query param, so it's a self-contained
        // URL our extension pages can reuse directly.
        const seenPhotos = new Set();
        const photoUrls = [];
        for (const img of document.querySelectorAll('img[src*="/attachments/"]')) {
          if (!isVisible(img) || seenPhotos.has(img.src)) continue;
          seenPhotos.add(img.src);
          photoUrls.push(img.src);
        }

        return { url: location.href, locationId, name, parentName, parentHref, items, photoUrls };
      }

      // Wait for the page to have at least rendered a name before running
      // attempt() (which does its own internal waiting/retrying for items).
      let tries = 0;
      const tick = () => {
        tries++;
        const h1 = document.querySelector('h1');
        const hasName = h1 && h1.textContent.trim();
        if (hasName || tries >= 25) {
          attempt().then(resolve);
        } else {
          setTimeout(tick, 600);
        }
      };
      tick();
    });
  }

  function waitForTabComplete(tabId) {
    return new Promise((resolve) => {
      function listener(updatedTabId, info) {
        if (updatedTabId === tabId && info.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      }
      chrome.tabs.onUpdated.addListener(listener);
    });
  }

  // Waits for the tab to report "complete" - but if it's already complete
  // (no further onUpdated event coming), waitForTabComplete would hang
  // forever waiting for an event that already happened, so check first.
  async function ensureTabComplete(tabId) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === 'complete') return;
    await waitForTabComplete(tabId);
  }

  async function scrapeOne(loc) {
    const tab = await chrome.tabs.create({ url: loc.url, active: false });
    let data = { url: loc.url, locationId: loc.id, name: loc.name, parentName: '', parentHref: '', items: [], photoUrls: [] };
    // A redirect (auth check, tunnel challenge, etc.) can tear down the
    // frame right after "complete" fires and just before the script
    // injection runs, throwing "Frame with ID ... was removed" - retry a
    // few times, re-checking the tab's actual status each time, rather than
    // failing outright on that one race.
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        await ensureTabComplete(tab.id);
        const [{ result }] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: standaloneScrape
        });
        data = result;
        break;
      } catch (e) {
        if (attempt < 3) await new Promise(r => setTimeout(r, 500));
      }
    }
    try { await chrome.tabs.remove(tab.id); } catch (e) { /* ignore */ }
    return data;
  }

  // Scrapes several locations at once (bounded pool of background tabs)
  // instead of one at a time - each can now take up to ~15s to hydrate over
  // a slow connection, so doing them sequentially would be painfully slow
  // for a large selection. Results are written back by original index so
  // the output order matches the checked list regardless of completion order.
  const SCRAPE_CONCURRENCY = 5;
  async function scrapeAll(locs, onProgress) {
    const results = new Array(locs.length);
    let nextIndex = 0;
    let completed = 0;
    async function worker() {
      while (nextIndex < locs.length) {
        const i = nextIndex++;
        results[i] = await scrapeOne(locs[i]);
        completed++;
        onProgress(completed, locs.length);
      }
    }
    const workers = Array.from({ length: Math.min(SCRAPE_CONCURRENCY, locs.length) }, worker);
    await Promise.all(workers);
    return results;
  }

  generateBtn.addEventListener('click', async () => {
    const checked = Array.from(listEl.querySelectorAll('input[type="checkbox"]:checked'))
      .map(cb => tree[Number(cb.dataset.index)]);

    if (checked.length === 0) {
      statusEl.textContent = 'Select at least one location first.';
      return;
    }

    generateBtn.disabled = true;
    const results = await scrapeAll(checked, (done, total) => {
      statusEl.textContent = `Scraping ${done} of ${total}...`;
    });

    statusEl.textContent = 'Done. Opening label sheet...';
    chrome.storage.local.set({ hbBulkLabels: results }, () => {
      window.location.href = chrome.runtime.getURL('labels.html');
    });
  });

  chrome.storage.local.get('hbLocationTree', (res) => {
    tree = res.hbLocationTree || [];
    render();
  });
})();
