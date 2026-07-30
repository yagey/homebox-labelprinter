// Homebox paginates its item list client-side (default 10-12 items per
// page, from an "itemsPerTablePage" preference stored in localStorage under
// "homebox/preferences/location"). This runs at document_start - BEFORE
// Homebox's own app boots and reads that preference - and bumps it to a
// large number, so the full item list renders without clicking through
// pages, both for browsing and so this extension's own scraping
// (content.js/bulk.js) sees every item with no pagination-walking logic
// needed.
//
// This is a real, persistent change to your "items per page" setting (it
// syncs to the server like any other Homebox preference), not a temporary
// override just for this extension. If Homebox's app was already running
// via client-side navigation when this loads, a hard refresh may be needed
// once for it to take effect (this script only runs on an actual page load).
(function () {
  const KEY = 'homebox/preferences/location';
  const BIG_PAGE_SIZE = 1000;
  try {
    let prefs = {};
    const raw = localStorage.getItem(KEY);
    if (raw) prefs = JSON.parse(raw);
    if (prefs.itemsPerTablePage !== BIG_PAGE_SIZE) {
      prefs.itemsPerTablePage = BIG_PAGE_SIZE;
      localStorage.setItem(KEY, JSON.stringify(prefs));
    }
  } catch (e) {
    // If this fails for any reason, Homebox just falls back to its normal
    // paginated behavior - no worse than before this feature existed.
  }
})();
