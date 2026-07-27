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

  // ---- Full ancestor tree resolution (same technique as print.js: hop
  // through each ancestor's own page in a hidden background tab, reading
  // its immediate parent link, until there isn't one). ----

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

  // Shrinks a label's text (via --label-scale) until it fits the fixed
  // half-letter box; if still too tall at minimum scale, drops trailing
  // content lines. The .label-page overflow:hidden is the hard backstop.
  function fitToPage(labelPage, labelText, itemsIn, renderContents) {
    const MIN_SCALE = 0.55;
    const MAX_SCALE = 2.5;
    let scale = 1;
    labelPage.style.setProperty('--label-scale', '1');

    const fits = () => labelText.scrollHeight <= labelText.clientHeight + 1;

    if (fits()) {
      // Short content (e.g. one item) would otherwise sit tiny in a corner -
      // grow to fill the available space instead of leaving it mostly blank.
      while (scale < MAX_SCALE) {
        const next = Math.min(MAX_SCALE, scale + 0.1);
        labelPage.style.setProperty('--label-scale', next.toFixed(2));
        if (!fits()) {
          labelPage.style.setProperty('--label-scale', scale.toFixed(2));
          break;
        }
        scale = next;
      }
      return;
    }

    while (!fits() && scale > MIN_SCALE) {
      scale = Math.max(MIN_SCALE, scale - 0.05);
      labelPage.style.setProperty('--label-scale', scale.toFixed(2));
    }
    if (fits()) return;

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
    `;

    const labelPage = document.createElement('div');
    labelPage.className = 'label-page';
    labelPage.innerHTML = `
      <div class="label-qr"></div>
      <div class="label-text">
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
    const parentStatus = panel.querySelector('[data-field="parent-status"]');

    const labelText = labelPage.querySelector('.label-text');
    const labelName = labelPage.querySelector('.label-name');
    const labelParent = labelPage.querySelector('.label-parent');
    const labelContents = labelPage.querySelector('.label-contents');
    const labelQr = labelPage.querySelector('.label-qr');

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

      const lines = itemsIn.value.split('\n').map(s => s.trim()).filter(Boolean);
      renderContents(lines, 0);
      renderQr(labelQr, urlIn.value);
      fitToPage(labelPage, labelText, itemsIn, renderContents);
    }

    [nameIn, parentIn, urlIn, itemsIn].forEach(el => el.addEventListener('input', refresh));
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
