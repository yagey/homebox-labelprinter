# Homebox Label Printer (Chrome extension)

Adds a floating "Print Label" button to any Homebox location page. Clicking
it opens an editable preview - QR code (linking straight back to that
location), location name, full parent location tree, and current contents -
sized to print as a half letter-page (8.5in x 5.5in) label you can fold or
trim. If you're sliding it into a portrait UPS label pouch, just rotate the
printed paper 90deg by hand when inserting it - the label text prints
upright/normal, so it reads correctly on the box after that turn.

## Install (unpacked / developer mode)

1. Unzip this folder somewhere permanent (don't delete it after installing -
   Chrome loads the extension files live from this location).
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select this folder (the one containing
   `manifest.json`).
5. Visit any Homebox location page (any host - `localhost`, a LAN IP, or your
   own domain all work with no configuration).
6. A green **"Print Label"** button appears in the bottom-right corner.

## Usage

1. Click **Print Label** on a location page.
2. A new tab opens with the location name and contents pre-filled from what's
   on the page. The parent field starts with just the immediate parent, then
   updates a moment later to the full ancestor chain (e.g.
   `Garage > Shelf A > Bin 3`) - it briefly opens each ancestor's own page in
   a hidden background tab to walk up the tree, since Homebox's UI only ever
   shows the immediate parent. Review and edit anything that scraped
   incorrectly (the fields are plain text, not tied to Homebox's database).
3. Click **Print label**. Your browser's print dialog opens targeting a
   normal full Letter page (8.5in x 11in) - no custom paper size needed,
   since most printers ignore/mishandle a custom half-letter page size
   anyway. The label prints on the top half only; the bottom half is left
   blank with a dashed "fold/cut here" guide. Fold or cut along that line to
   get your actual half-page (8.5in x 5.5in) label.

## Bulk mode

1. Go to the Locations tree page (`/locations`).
2. Click the green **"Bulk Print Labels"** button (bottom-right).
3. Check the locations you want labels for (Select all / Select none helpers
   provided), then click **Generate labels**.
4. The extension briefly opens each selected location in a background tab
   to read its current contents, then closes it automatically - you'll see
   a "Scraping X of N" status while this runs. Nothing is modified in
   Homebox; this is read-only.
5. A new tab opens with one editable label per selected location. Review/edit
   each, then click **Print all labels** to send everything to your
   browser's print dialog in one go - each label gets its own full
   8.5in x 11in sheet (top half only, same as single-label print), with a
   dashed fold/cut guide below it.

## Photos

If the location has photos uploaded in Homebox, they're all pulled in
automatically as a side-by-side thumbnail strip on the label (a real
mnemonic - much more useful for spotting the right bin/shelf at a glance
than a generic icon). The "Photo URLs" field on the print page is editable
(one URL per line, blank to omit); if any photo fails to load (e.g. its
access token expired while you were reviewing the label), that thumbnail
is silently hidden rather than showing a broken-image icon.

## Item quantities

If an item's quantity in Homebox is set to more than 1, its label line
shows a count prefix, e.g. "(2) Chainsaw blade" - items with a quantity of
1 (the default) show with no prefix. This is scraped with a best-effort
heuristic (no reliable way to target Homebox's quantity badge/column
directly), so double-check it on the editable Contents field before
printing.

## Mnemonic icon

Below the QR code, every label also gets a small colored icon - a fun,
fully local (no network calls) visual aid: an emoji picked by matching
keywords in the location name/contents (e.g. "Beer Brewing" -> 🍺, a
location full of cables -> 🔌, falling back to 📦), on a deterministic
pastel background so the same location always gets the same look. This is
separate from the real photo above (if any) - it's not meant to be
precise, just a quick visual anchor.

## Locations tree auto-expand

Visiting the Locations tree page (`/locations`) automatically clicks
Homebox's own "expand all" button for you, so nested locations are fully
expanded on load instead of requiring a manual click.

## Pagination removed

Homebox's item list normally paginates client-side at 10-12 items per
page (a setting called "items per page"), which meant this extension
could only see the first page of items when scraping a location with
more items than that. Visiting any location/locations page now bumps
that setting to a large number automatically, so the full item list
renders on one page - both for browsing normally and for this
extension's scraping. This is a real, persistent change to your actual
"items per page" preference (it syncs to the Homebox server like any
other setting change there), not a temporary trick. If Homebox was
already open in a tab via client-side navigation, one hard refresh may
be needed for it to take effect.

## Works on any Homebox host - no configuration needed

The extension matches on URL *path* (`/location/*`, `/locations*`) rather
than a specific hostname, so it works out of the box whether your Homebox
is at `localhost`, a LAN IP, a Tailscale address, or your own domain - no
editing `manifest.json` required. The QR code encodes whatever URL you're
actually browsing, so scan compatibility from a phone just depends on that
URL being reachable from the phone's network.

## How it works / limitations

- The button reads (scrapes) whatever's already rendered on the location
  page - the location's name, its parent breadcrumb link, and any listed
  items - rather than calling Homebox's API. This means it needs no login
  token and works regardless of your Homebox version's exact API shape,
  but it also means scraping can occasionally miss text if a future
  Homebox UI update changes its layout significantly. Because everything
  is editable before printing, this is always recoverable by hand.
- The QR code encodes the current page's URL, so scanning it opens that
  exact location page in Homebox.
- No data leaves your browser - everything happens locally, and the QR
  library (`vendor/qrcode.min.js`, MIT licensed, by Kazuhiko Arase) is
  bundled directly rather than loaded from a CDN.
