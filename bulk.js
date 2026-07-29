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

      function attempt() {
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

        // Items: links to /item/<uuid>, de-duped by id (table view links
        // every non-action cell to the same item).
        const seen = new Map();
        for (const a of document.querySelectorAll('a[href*="/item/"]')) {
          if (!isVisible(a)) continue;
          const m = (a.getAttribute('href') || '').match(/\/item\/([a-f0-9-]+)/i);
          if (!m) continue;
          if (seen.has(m[1])) continue;
          const itemName = extractItemName(a);
          if (itemName) seen.set(m[1], itemName);
        }
        const items = Array.from(seen.values());

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

      // A browser tab reaching "complete" only means the HTML/assets finished
      // loading, not that the Nuxt/Vue app has hydrated and rendered the
      // h1/items yet. On a remote host with real network latency (vs.
      // near-zero on localhost) that hydration can take a few seconds, so
      // give this a generous budget (up to ~15s) rather than giving up early.
      let tries = 0;
      const tick = () => {
        tries++;
        const data = attempt();
        if (data.name || data.items.length || tries >= 25) {
          resolve(data);
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

  async function scrapeOne(loc) {
    const tab = await chrome.tabs.create({ url: loc.url, active: false });
    await waitForTabComplete(tab.id);
    let data;
    try {
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: standaloneScrape
      });
      data = result;
    } catch (e) {
      data = { url: loc.url, locationId: loc.id, name: loc.name, parentName: '', parentHref: '', items: [], photoUrls: [] };
    }
    try { await chrome.tabs.remove(tab.id); } catch (e) { /* ignore */ }
    return data;
  }

  generateBtn.addEventListener('click', async () => {
    const checked = Array.from(listEl.querySelectorAll('input[type="checkbox"]:checked'))
      .map(cb => tree[Number(cb.dataset.index)]);

    if (checked.length === 0) {
      statusEl.textContent = 'Select at least one location first.';
      return;
    }

    generateBtn.disabled = true;
    const results = [];
    for (let i = 0; i < checked.length; i++) {
      statusEl.textContent = `Scraping ${i + 1} of ${checked.length}: ${checked[i].name}...`;
      const data = await scrapeOne(checked[i]);
      results.push(data);
    }

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
