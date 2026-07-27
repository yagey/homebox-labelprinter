(function () {
  const els = {
    name: document.getElementById('in-name'),
    parent: document.getElementById('in-parent'),
    url: document.getElementById('in-url'),
    items: document.getElementById('in-items'),
    photo: document.getElementById('in-photo'),
    printBtn: document.getElementById('print-btn'),
    labelPage: document.getElementById('label-page'),
    labelName: document.getElementById('label-name'),
    labelParent: document.getElementById('label-parent'),
    labelText: document.getElementById('label-text'),
    labelContents: document.getElementById('label-contents'),
    labelQr: document.getElementById('label-qr'),
    labelPhoto: document.getElementById('label-photo'),
    parentStatus: document.getElementById('parent-status')
  };

  // Homebox photo URLs embed a short-lived access_token - if it's expired
  // or the URL is otherwise bad, just hide the image rather than showing a
  // broken-image icon on the label.
  els.labelPhoto.addEventListener('error', () => {
    els.labelPhoto.style.display = 'none';
  });

  function renderPhoto(url) {
    if (!url) {
      els.labelPhoto.style.display = 'none';
      els.labelPhoto.removeAttribute('src');
      return;
    }
    els.labelPhoto.src = url;
    els.labelPhoto.style.display = 'block';
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

  // Shrinks label text (via the --label-scale CSS var) until it fits the
  // fixed half-letter box; if it still doesn't fit at the smallest
  // readable scale, drops trailing content lines instead. This is what
  // guarantees the label never spills onto a second printed page - the
  // #label-page overflow:hidden in print.html is the hard backstop.
  function fitToPage(lines) {
    const MIN_SCALE = 0.55;
    const MAX_SCALE = 2.5;
    let scale = 1;
    els.labelPage.style.setProperty('--label-scale', '1');

    let fits = () => els.labelText.scrollHeight <= els.labelText.clientHeight + 1;

    if (fits()) {
      // Short content (e.g. one item) would otherwise sit tiny in a corner -
      // grow to fill the available space instead of leaving it mostly blank.
      while (scale < MAX_SCALE) {
        const next = Math.min(MAX_SCALE, scale + 0.1);
        els.labelPage.style.setProperty('--label-scale', next.toFixed(2));
        if (!fits()) {
          els.labelPage.style.setProperty('--label-scale', scale.toFixed(2));
          break;
        }
        scale = next;
      }
      return;
    }

    while (!fits() && scale > MIN_SCALE) {
      scale = Math.max(MIN_SCALE, scale - 0.05);
      els.labelPage.style.setProperty('--label-scale', scale.toFixed(2));
    }
    if (fits()) return;

    // Still doesn't fit at minimum scale - drop items from the end until it fits.
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
    renderPhoto(els.photo.value.trim());

    const lines = els.items.value.split('\n').map(s => s.trim()).filter(Boolean);
    renderContents(lines, 0);
    renderQr(els.url.value);
    fitToPage(lines);
  }

  // ---- Full ancestor tree resolution ----
  // The location page only ever renders its IMMEDIATE parent - to get the
  // full tree, hop through each ancestor's own page in a hidden background
  // tab (same technique bulk mode uses), reading its parent link, and repeat
  // until there isn't one.

  function standaloneGetBreadcrumb() {
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

  async function fetchBreadcrumb(url) {
    const tab = await chrome.tabs.create({ url, active: false });
    await waitForTabComplete(tab.id);
    let result = { name: '', parentName: '', parentHref: '' };
    try {
      const [{ result: r }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: standaloneGetBreadcrumb
      });
      if (r) result = r;
    } catch (e) {
      console.error('Failed to resolve ancestor', url, e);
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
    els.photo.value = data.photoUrl || '';
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

  [els.name, els.parent, els.url, els.items, els.photo].forEach(el => {
    el.addEventListener('input', renderLabel);
  });

  els.printBtn.addEventListener('click', () => window.print());

  loadData();
})();
