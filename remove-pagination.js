// Homebox paginates its item list client-side (default 10-12 items per
// page, from an "itemsPerTablePage" preference). This bumps that preference
// to a large number, so the full item list renders without clicking through
// pages, both for browsing and so this extension's own scraping
// (content.js/bulk.js) sees every item with no pagination-walking logic
// needed.
//
// The preference lives in localStorage AND syncs to the Homebox server for
// logged-in users - and the app re-pulls it FROM the server on every page
// load, which overwrites a localStorage-only change almost immediately. So
// this updates both: localStorage first (document_start, before Homebox's
// app boots and reads it, for the fastest fix on THIS load) and the server
// setting via the same API Homebox itself uses (so future page loads don't
// just pull the old value back down). This is a real, persistent change to
// your actual "items per page" setting, not a temporary trick.
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
    // If this fails, Homebox just falls back to its normal paginated
    // behavior for this load - no worse than before this feature existed.
  }

  // Not logged in yet (e.g. sitting on a login page) - fetch() below would
  // just fail harmlessly, but skip the extra network round trip.
  fetch('/api/v1/users/self/settings', { credentials: 'same-origin' })
    .then(res => (res.ok ? res.json() : null))
    .then(body => {
      const current = body && body.item;
      if (!current || current.itemsPerTablePage === BIG_PAGE_SIZE) return;
      return fetch('/api/v1/users/self/settings', {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...current, itemsPerTablePage: BIG_PAGE_SIZE })
      });
    })
    .catch(() => { /* ignore - self-corrects on a later page visit */ });
})();
