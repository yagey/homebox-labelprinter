(function () {
  const container = document.getElementById('labels-container');

  function renderQr(el, text) {
    el.innerHTML = '';
    if (!text) return;
    try {
      const qr = qrcode(0, 'M');
      qr.addData(text);
      qr.make();
      el.innerHTML = qr.createSvgTag({ scalable: true });
    } catch (e) {
      el.innerHTML = '<div style="font-size:12px;color:#a00">QR failed</div>';
    }
  }

  // Generated mnemonic icon (no real photo needed, no network calls) - see
  // print.js for the full rationale, same lookup table duplicated here.
  const MNEMONIC_KEYWORDS = [
    [['beer', 'brew', 'wine', 'liquor', 'bar cart'], '🍺'],
    [['kitchen', 'cook', 'pan', 'pot', 'dish', 'utensil'], '🍳'],
    [['tool', 'wrench', 'screwdriver', 'hammer', 'drill', 'saw'], '🔧'],
    [['cable', 'wire', 'electronic', 'charger', 'adapter', 'circuit'], '🔌'],
    [['cloth', 'shirt', 'jacket', 'shoe', 'sock', 'closet', 'apparel'], '👕'],
    [['paint', 'brush', 'craft', 'art', 'yarn', 'fabric'], '🎨'],
    [['car', 'garage', 'auto', 'tire', 'oil'], '🚗'],
    [['food', 'snack', 'can', 'pantry', 'grocery'], '🥫'],
    [['medicine', 'med', 'first aid', 'pill', 'bandage'], '💊'],
    [['camera', 'photo', 'lens'], '📷'],
    [['game', 'toy', 'puzzle', 'lego'], '🎮'],
    [['book', 'document', 'paper', 'office', 'file'], '📚'],
    [['holiday', 'christmas', 'decoration', 'ornament'], '🎄'],
    [['garden', 'plant', 'seed', 'soil', 'lawn'], '🌱'],
    [['clean', 'soap', 'detergent', 'vacuum', 'broom'], '🧹'],
    [['sport', 'ball', 'bike', 'camp', 'outdoor'], '⚽'],
    [['bath', 'towel', 'shampoo', 'toiletry'], '🧴'],
    [['light', 'lamp', 'bulb', 'lighting'], '💡'],
    [['pet', 'dog', 'cat', 'leash', 'litter'], '🐾'],
    [['shelf', 'bin', 'box', 'container', 'storage'], '📦']
  ];
  const MNEMONIC_DEFAULT_EMOJI = '📦';
  const MNEMONIC_PALETTE = ['#FDE68A', '#BFDBFE', '#FBCFE8', '#BBF7D0', '#DDD6FE', '#FECACA', '#FED7AA', '#A7F3D0'];

  function renderMnemonic(el, name, items) {
    const text = ((name || '') + ' ' + items.join(' ')).toLowerCase();
    let emoji = MNEMONIC_DEFAULT_EMOJI;
    for (const [keywords, e] of MNEMONIC_KEYWORDS) {
      if (keywords.some(k => text.includes(k))) {
        emoji = e;
        break;
      }
    }
    let hash = 0;
    const n = name || '';
    for (let i = 0; i < n.length; i++) hash = (hash * 31 + n.charCodeAt(i)) >>> 0;
    el.textContent = emoji;
    el.style.background = MNEMONIC_PALETTE[hash % MNEMONIC_PALETTE.length];
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

  // ---- Full ancestor tree resolution (same technique as print.js: hop
  // through each ancestor's own page in a hidden background tab, reading
  // its immediate parent link, until there isn't one). ----

  // Returns a Promise (chrome.scripting.executeScript awaits it) - a browser
  // tab reaching "complete" only means the HTML/assets finished loading, not
  // that the Nuxt/Vue app has hydrated and rendered the h1/breadcrumb yet.
  // On a remote host with real network latency (vs. near-zero on localhost)
  // that hydration can take a couple seconds, so poll instead of reading once.
  function standaloneGetBreadcrumb() {
    function attempt() {
      const h1 = document.querySelector('h1');
      let name = '';
      if (h1) {
        for (const node of h1.childNodes) {
          if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) {
            name = node.textContent.trim();
            break;
          }
        }
        if (!name) name = h1.textContent.trim();
      }
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
      return { name, parentName, parentHref };
    }

    return new Promise((resolve) => {
      let tries = 0;
      const tick = () => {
        tries++;
        const data = attempt();
        if (data.name || tries >= 25) {
          resolve(data);
        } else {
          setTimeout(tick, 500);
        }
      };
      tick();
    });
  }

  async function fetchBreadcrumb(url) {
    const tab = await chrome.tabs.create({ url, active: false });
    let result = { name: '', parentName: '', parentHref: '' };
    // A redirect (auth check, tunnel challenge, etc.) can tear down the
    // frame right after "complete" fires and just before the script
    // injection runs, throwing "Frame with ID ... was removed" - retry a
    // few times, re-checking the tab's actual status each time, rather than
    // failing outright on that one race.
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        await ensureTabComplete(tab.id);
        const [{ result: r }] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: standaloneGetBreadcrumb
        });
        if (r) result = r;
        break;
      } catch (e) {
        if (attempt === 3) {
          console.error('Failed to resolve ancestor', url, e);
        } else {
          await new Promise(r => setTimeout(r, 500));
        }
      }
    }
    try { await chrome.tabs.remove(tab.id); } catch (e) { /* ignore */ }
    return result;
  }

  async function resolveFullParentPath(initialName, initialHref) {
    const chain = [];
    let name = initialName;
    let href = initialHref;
    let guard = 0;
    while (name && href && guard < 25) {
      chain.push(name);
      guard++;
      const data = await fetchBreadcrumb(href);
      name = data.parentName;
      href = data.parentHref;
    }
    return chain.reverse(); // root-first
  }

  // Shrinks a label's text until it fits the fixed half-letter box. Name/
  // parent/photos scale via --label-scale down to MIN_SCALE (a comfortable
  // reading floor); the contents list has its OWN independent
  // --contents-scale that keeps shrinking (with narrower columns) well past
  // that point, since a long inventory list is common and shouldn't get
  // truncated just because name/parent already hit their minimum. Only as
  // an extreme last resort (contents scale also maxed out) does it drop
  // trailing items - the .label-page overflow:hidden is the hard backstop
  // either way.
  function fitToPage(labelPage, labelText, itemsIn, renderContents) {
    const MIN_SCALE = 0.55;
    const MAX_SCALE = 2.5;
    const MIN_CONTENTS_SCALE = 0.3;
    let scale = 1;
    labelPage.style.setProperty('--label-scale', '1');
    labelPage.style.setProperty('--contents-scale', '1');

    const fits = () => labelText.scrollHeight <= labelText.clientHeight + 1;

    if (fits()) {
      // Short content (e.g. one item) would otherwise sit tiny in a corner -
      // grow to fill the available space instead of leaving it mostly blank.
      while (scale < MAX_SCALE) {
        const next = Math.min(MAX_SCALE, scale + 0.1);
        labelPage.style.setProperty('--label-scale', next.toFixed(2));
        labelPage.style.setProperty('--contents-scale', next.toFixed(2));
        if (!fits()) {
          labelPage.style.setProperty('--label-scale', scale.toFixed(2));
          labelPage.style.setProperty('--contents-scale', scale.toFixed(2));
          break;
        }
        scale = next;
      }
      return;
    }

    while (!fits() && scale > MIN_SCALE) {
      scale = Math.max(MIN_SCALE, scale - 0.05);
      labelPage.style.setProperty('--label-scale', scale.toFixed(2));
      labelPage.style.setProperty('--contents-scale', scale.toFixed(2));
    }
    if (fits()) return;

    // Name/parent/photos are now fixed at MIN_SCALE (still readable) - keep
    // shrinking just the contents text/columns further instead of dropping
    // items.
    let contentsScale = MIN_SCALE;
    while (!fits() && contentsScale > MIN_CONTENTS_SCALE) {
      contentsScale = Math.max(MIN_CONTENTS_SCALE, contentsScale - 0.03);
      labelPage.style.setProperty('--contents-scale', contentsScale.toFixed(2));
    }
    if (fits()) return;

    // Still doesn't fit even at the smallest contents scale (an extremely
    // long list) - drop items from the end as a last resort.
    const lines = itemsIn.value.split('\n').map(s => s.trim()).filter(Boolean);
    let visible = lines.length;
    while (visible > 0 && !fits()) {
      visible--;
      renderContents(lines.slice(0, visible), lines.length - visible);
    }
  }

  function buildBlock(data, index) {
    const block = document.createElement('div');
    block.className = 'item-block';

    const panel = document.createElement('div');
    panel.className = 'panel no-print';
    panel.innerHTML = `
      <label>Location name</label>
      <input type="text" data-field="name" value="${escapeAttr(data.name || '')}">
      <label>Parent location tree <span class="parent-status" data-field="parent-status"></span></label>
      <input type="text" data-field="parent" value="${escapeAttr(data.parentName || '')}">
      <label>QR target URL</label>
      <input type="text" data-field="url" value="${escapeAttr(data.url || '')}">
      <label>Contents (one per line)</label>
      <textarea data-field="items">${escapeHtml((data.items || []).join('\n'))}</textarea>
      <label>Photo URLs (optional - one per line, blank to omit)</label>
      <textarea data-field="photos">${escapeHtml((data.photoUrls || []).join('\n'))}</textarea>
    `;

    const labelPage = document.createElement('div');
    labelPage.className = 'label-page';
    labelPage.innerHTML = `
      <div class="label-left-col">
        <div class="label-qr"></div>
        <div class="label-mnemonic"></div>
      </div>
      <div class="label-text">
        <div class="label-photos"></div>
        <div class="label-name"></div>
        <div class="label-parent"></div>
        <div class="label-contents-title">Contents</div>
        <div class="label-contents"></div>
      </div>
    `;

    block.appendChild(panel);
    block.appendChild(labelPage);
    container.appendChild(block);

    const nameIn = panel.querySelector('[data-field="name"]');
    const parentIn = panel.querySelector('[data-field="parent"]');
    const urlIn = panel.querySelector('[data-field="url"]');
    const itemsIn = panel.querySelector('[data-field="items"]');
    const photosIn = panel.querySelector('[data-field="photos"]');
    const parentStatus = panel.querySelector('[data-field="parent-status"]');

    const labelText = labelPage.querySelector('.label-text');
    const labelName = labelPage.querySelector('.label-name');
    const labelParent = labelPage.querySelector('.label-parent');
    const labelContents = labelPage.querySelector('.label-contents');
    const labelQr = labelPage.querySelector('.label-qr');
    const labelPhotos = labelPage.querySelector('.label-photos');
    const labelMnemonic = labelPage.querySelector('.label-mnemonic');

    // Each thumbnail gets an explicit height from CSS before it even loads,
    // so no async-load race guard is needed here - just a per-image error
    // handler (see print.js for the full rationale).
    function renderPhotos(urls) {
      labelPhotos.innerHTML = '';
      if (!urls.length) {
        labelPhotos.style.display = 'none';
        return;
      }
      labelPhotos.style.display = 'flex';
      urls.forEach(url => {
        const img = document.createElement('img');
        img.src = url;
        img.alt = '';
        img.addEventListener('error', () => { img.style.display = 'none'; });
        labelPhotos.appendChild(img);
      });
    }

    function renderContents(lines, hiddenCount) {
      labelContents.innerHTML = '';
      if (lines.length === 0 && !hiddenCount) {
        const d = document.createElement('div');
        d.className = 'label-empty';
        d.textContent = 'No items listed';
        labelContents.appendChild(d);
        return;
      }
      lines.forEach(line => {
        const d = document.createElement('div');
        d.textContent = '• ' + line;
        labelContents.appendChild(d);
      });
      if (hiddenCount > 0) {
        const d = document.createElement('div');
        d.className = 'label-truncated';
        d.textContent = `+ ${hiddenCount} more (edit list above)`;
        labelContents.appendChild(d);
      }
    }

    function refresh() {
      labelName.textContent = nameIn.value || '(unnamed location)';
      labelParent.textContent = parentIn.value ? ('Located in: ' + parentIn.value) : '';
      renderPhotos(photosIn.value.split('\n').map(s => s.trim()).filter(Boolean));

      const lines = itemsIn.value.split('\n').map(s => s.trim()).filter(Boolean);
      renderContents(lines, 0);
      renderQr(labelQr, urlIn.value);
      renderMnemonic(labelMnemonic, nameIn.value, lines);
      fitToPage(labelPage, labelText, itemsIn, renderContents);
    }

    [nameIn, parentIn, urlIn, itemsIn, photosIn].forEach(el => el.addEventListener('input', refresh));
    refresh();

    if (data.parentHref) {
      parentStatus.textContent = '(resolving full tree...)';
      resolveFullParentPath(data.parentName, data.parentHref)
        .then(chain => {
          if (chain.length) {
            parentIn.value = chain.join(' > ');
            refresh();
          }
        })
        .catch(e => console.error('Ancestor resolution failed', e))
        .finally(() => { parentStatus.textContent = ''; });
    }
  }

  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function escapeAttr(s) {
    return escapeHtml(s).replace(/"/g, '&quot;');
  }

  document.getElementById('print-all-btn').addEventListener('click', () => window.print());

  chrome.storage.local.get('hbBulkLabels', (res) => {
    const list = res.hbBulkLabels || [];
    if (list.length === 0) {
      container.innerHTML = '<p>No labels to show. Go back to the Locations page and use "Bulk Print Labels".</p>';
      return;
    }
    list.forEach((data, i) => buildBlock(data, i));
  });
})();
