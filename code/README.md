# LinkedIn Message Templates — Phase 1 (MVP)

A Chrome extension: save short reply templates and insert one into a LinkedIn
chat message in one click, with `{{first_name}}` auto-filled from the
recipient's name. See `../docs` (or the project's `spec.md` / `todo.md`) for
the full spec and roadmap.

## Load it in Chrome

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select this `code/` folder.
4. Pin the extension (puzzle-piece icon in the toolbar → pin) so its popup is
   easy to reach.

If the extension was already loaded from an earlier version, click the
reload icon on its card in `chrome://extensions` **and** fully close any
already-open LinkedIn tabs before opening a new one — Chrome only injects
the content script into tabs at page load, so a tab that was open before you
reloaded the extension won't pick up the update until it's closed and
reopened (or hard-refreshed).

## Two separate surfaces

**Insert a template into a chat** — the small purple/blue icon next to a
compose box's own toolbar (emoji/attachment icons), on the message box
itself:
1. Go to `linkedin.com/messaging`, open any conversation.
2. Click the icon in that box's toolbar.
3. Pick a template — it's inserted into that box, with `{{first_name}}`
   replaced by the recipient's first name where LinkedIn's page lets us
   read it. Edit as needed, then send normally (the extension never sends
   anything itself).

**Manage templates in-page** — a tab docked to the right edge of the page,
present on any LinkedIn page:
1. Click the docked tab.
2. A sidebar slides in with your saved templates — click one to edit it, or
   the icon buttons on each row to reorder/delete.
3. **+ New** at the top adds one. This is the same data as the extension's
   toolbar popup (click the extension's icon in your Chrome toolbar) — either
   one works, they stay in sync.

## Known limitations — please verify these on real LinkedIn

LinkedIn's DOM isn't documented and changes over time, so this was built
against best-effort selectors (see the `SELECTORS` object at the top of
`content/content.js`) rather than live-tested against every LinkedIn surface.
Before relying on this day-to-day, run through:

- [ ] Insert icon appears in a **1:1 chat** compose toolbar
- [ ] Insert icon appears in a **group chat** compose toolbar (and
      `{{first_name}}` correctly falls back to "there" rather than picking a
      random member)
- [ ] Insert icon appears when opening a **brand-new conversation** (not
      just an existing thread)
- [ ] Insert icon appears in **both** the full messaging page
      (`/messaging/thread/...`) and the **messaging overlay** (the chat
      pop-up in the bottom-right of other LinkedIn pages), including one
      opened from the right-side chat list
- [ ] Inserted text actually shows up when you click **Send** (confirms the
      `execCommand('insertText')` path is registering with LinkedIn's own
      React state, not just visually appearing)
- [ ] Recipient first name resolves correctly for a normal 1:1 thread
- [ ] Insert picker closes on outside click and on **Esc**
- [ ] Insert icon does **not** appear in the post-comment box (regression
      check — the generic fallback selector also matches LinkedIn's own
      comment editor, scoped out via `isLikelyMessagingContext`)
- [ ] Docked tab is visible on any LinkedIn page
- [ ] Sidebar opens/closes on tab click, outside click, and **Esc**
- [ ] Adding, editing, deleting, and reordering a template in the sidebar
      all work, and show up immediately in the insert picker and in the
      extension's toolbar popup too

If the insert icon doesn't appear at all: open devtools on a LinkedIn
messaging page, run `window.__LMT__.report()`, and check
`lastComposeBoxCount` / `lastInjectedCount` — `0` for both means the
compose-box selectors need updating (`composeBox` / `toolbar` /
`recipientName` arrays, top of `content/content.js`); `undefined` for
`window.__LMT__` itself means the content script never ran on that page at
all (reload the extension and open a fresh tab, per the note above).

## What's intentionally not here yet

Categories/folders, search, more placeholders (`{{lastName}}`, `{{company_name}}`,
etc.), keyboard shortcuts / `/` trigger, and import/export are planned for
Phase 2 — see `spec.md`. The Phase 1 data model already reserves a `folderId`
field and the placeholder resolver is already a small registry, specifically
so Phase 2 doesn't require a rewrite.
