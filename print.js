(function () {
  const els = {
    name: document.getElementById('in-name'),
    parent: document.getElementById('in-parent'),
    url: document.getElementById('in-url'),
    items: document.getElementById('in-items'),
    photos: document.getElementById('in-photos'),
    printBtn: document.getElementById('print-btn'),
    labelPage: document.getElementById('label-page'),
    labelName: document.getElementById('label-name'),
    labelParent: document.getElementById('label-parent'),
    labelText: document.getElementById('label-text'),
    labelContents: document.getElementById('label-contents'),
    labelQr: document.getElementById('label-qr'),
    labelPhotos: document.getElementById('label-photos'),
    labelMnemonic: document.getElementById('label-mnemonic'),
    parentStatus: document.getElementById('parent-status')
  };

  // Each thumbnail gets an explicit height from CSS (100% of the fixed-height
  // strip) before it even loads, so - unlike the single-photo version this
  // replaced - there's no async-load race to guard against here; only a
  // per-image error handler is needed (Homebox photo URLs embed a
  // short-lived access_token - if it's expired, hide just that thumbnail
  // rather than showing a broken-image icon).
  function renderPhotos(urls) {
    els.labelPhotos.innerHTML = '';
    if (!urls.length) {
      els.labelPhotos.style.display = 'none';
      return;
    }
    els.labelPhotos.style.display = 'flex';
    for (const url of urls) {
      const img = document.createElement('img');
      img.src = url;
      img.alt = '';
      img.addEventListener('error', () => { img.style.display = 'none'; });
      els.labelPhotos.appendChild(img);
    }
  }

  // Generated mnemonic icon (no real photo needed, no network calls): a
  // deterministic keyword -> emoji match against the name/contents, on a
  // deterministic pastel background so the same location always looks the
  // same. Purely a visual memory aid, not meant to be precise.
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

  function getMnemonicIcon(name, items) {
    const text = (name + ' ' + items.join(' ')).toLowerCase();
    let emoji = MNEMONIC_DEFAULT_EMOJI;
    for (const [keywords, e] of MNEMONIC_KEYWORDS) {
      if (keywords.some(k => text.includes(k))) {
        emoji = e;
        break;
      }
    }
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
    const color = MNEMONIC_PALETTE[hash % MNEMONIC_PALETTE.length];
    return { emoji, color };
  }

  function renderMnemonic(name, items) {
    const { emoji, color } = getMnemonicIcon(name || '', items);
    els.labelMnemonic.textContent = emoji;
    els.labelMnemonic.style.background = color;
  }

  function renderQr(text) {
    els.labelQr.innerHTML = '';
    if (!text) return;
    try {
      const qr = qrcode(0, 'M'); // type 0 = auto-detect smallest size, M = medium error correction
      qr.addData(text);
      qr.make();
      els.labelQr.innerHTML = qr.createSvgTag({ scalable: true });
    } catch (e) {
      els.labelQr.innerHTML = '<div style="font-size:12px;color:#a00">QR generation failed</div>';
      console.error('QR generation failed', e);
    }
  }

  // Shrinks label text until it fits the fixed half-letter box. Name/parent/
  // photos scale via --label-scale down to MIN_SCALE (a comfortable reading
  // floor); the contents list has its OWN independent --contents-scale that
  // keeps shrinking (with narrower columns) well past that point, since a
  // long inventory list is common and shouldn't get truncated just because
  // name/parent already hit their minimum. Only as an extreme last resort
  // (contents scale also maxed out) does it drop trailing items - the
  // #label-page overflow:hidden in print.html is the hard backstop either way.
  function fitToPage(lines) {
    const MIN_SCALE = 0.55;
    const MAX_SCALE = 2.5;
    const MIN_CONTENTS_SCALE = 0.3;
    let scale = 1;
    els.labelPage.style.setProperty('--label-scale', '1');
    els.labelPage.style.setProperty('--contents-scale', '1');

    let fits = () => els.labelText.scrollHeight <= els.labelText.clientHeight + 1;

    if (fits()) {
      // Short content (e.g. one item) would otherwise sit tiny in a corner -
      // grow to fill the available space instead of leaving it mostly blank.
      while (scale < MAX_SCALE) {
        const next = Math.min(MAX_SCALE, scale + 0.1);
        els.labelPage.style.setProperty('--label-scale', next.toFixed(2));
        els.labelPage.style.setProperty('--contents-scale', next.toFixed(2));
        if (!fits()) {
          els.labelPage.style.setProperty('--label-scale', scale.toFixed(2));
          els.labelPage.style.setProperty('--contents-scale', scale.toFixed(2));
          break;
        }
        scale = next;
      }
      return;
    }

    while (!fits() && scale > MIN_SCALE) {
      scale = Math.max(MIN_SCALE, scale - 0.05);
      els.labelPage.style.setProperty('--label-scale', scale.toFixed(2));
      els.labelPage.style.setProperty('--contents-scale', scale.toFixed(2));
    }
    if (fits()) return;

    // Name/parent/photos are now fixed at MIN_SCALE (still readable) - keep
    // shrinking just the contents text/columns further instead of dropping
    // items.
    let contentsScale = MIN_SCALE;
    while (!fits() && contentsScale > MIN_CONTENTS_SCALE) {
      contentsScale = Math.max(MIN_CONTENTS_SCALE, contentsScale - 0.03);
      els.labelPage.style.setProperty('--contents-scale', contentsScale.toFixed(2));
    }
    if (fits()) return;

    // Still doesn't fit even at the smallest contents scale (an extremely
    // long list) - drop items from the end as a last resort.
    let visible = lines.length;
    while (visible > 0 && !fits()) {
      visible--;
      renderContents(lines.slice(0, visible), lines.length - visible);
    }
  }

  function renderContents(lines, hiddenCount) {
    els.labelContents.innerHTML = '';
    if (lines.length === 0 && !hiddenCount) {
      const d = document.createElement('div');
      d.id = 'label-empty';
      d.textContent = 'No items listed';
      els.labelContents.appendChild(d);
      return;
    }
    for (const line of lines) {
      const d = document.createElement('div');
      d.textContent = '• ' + line;
      els.labelContents.appendChild(d);
    }
    if (hiddenCount > 0) {
      const d = document.createElement('div');
      d.id = 'label-truncated';
      d.textContent = `+ ${hiddenCount} more (edit list above)`;
      els.labelContents.appendChild(d);
    }
  }

  function renderLabel() {
    els.labelName.textContent = els.name.value || '(unnamed location)';
    els.labelParent.textContent = els.parent.value ? ('Located in: ' + els.parent.value) : '';
    renderPhotos(els.photos.value.split('\n').map(s => s.trim()).filter(Boolean));

    const lines = els.items.value.split('\n').map(s => s.trim()).filter(Boolean);
    renderContents(lines, 0);
    renderQr(els.url.value);
    renderMnemonic(els.name.value, lines);
    fitToPage(lines);
  }

  // ---- Full ancestor tree resolution ----
  // The location page only ever renders its IMMEDIATE parent - to get the
  // full tree, hop through each ancestor's own page in a hidden background
  // tab (same technique bulk mode uses), reading its parent link, and repeat
  // until there isn't one.

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

  async function loadData() {
    const res = await new Promise(r => chrome.storage.local.get('hbLabelData', r));
    const data = res.hbLabelData || {};
    els.name.value = data.name || '';
    els.parent.value = data.parentName || '';
    els.url.value = data.url || '';
    els.items.value = (data.items || []).join('\n');
    els.photos.value = (data.photoUrls || []).join('\n');
    renderLabel();

    if (data.parentHref) {
      els.parentStatus.textContent = '(resolving full tree...)';
      try {
        const chain = await resolveFullParentPath(data.parentName, data.parentHref);
        if (chain.length) els.parent.value = chain.join(' > ');
      } catch (e) {
        console.error('Ancestor resolution failed', e);
      }
      els.parentStatus.textContent = '';
      renderLabel();
    }
  }

  [els.name, els.parent, els.url, els.items, els.photos].forEach(el => {
    el.addEventListener('input', renderLabel);
  });

  els.printBtn.addEventListener('click', () => window.print());

  loadData();
})();
