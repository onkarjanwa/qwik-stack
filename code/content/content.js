// content/content.js
//
// Two separate surfaces, two separate jobs:
//  1. A small icon injected into each open compose box's own toolbar --
//     click it to INSERT a saved template into that specific box.
//  2. A tab docked to the right edge of the page (also toggleable from the
//     extension's own toolbar icon, see background.js) -- click it to open
//     a sidebar for MANAGING templates (add / edit / delete / reorder), a
//     lighter in-page alternative to the extension's old toolbar popup.
// The two don't overlap: the docked sidebar never inserts anything, and the
// per-box picker never edits/deletes anything.
//
// LinkedIn's DOM (class names especially) changes over time and is not
// documented, so every selector below is a *best-effort guess*, spot-checked
// against a real msg-overlay-conversation-bubble (2026-09) but not every
// LinkedIn messaging surface. If LinkedIn ships a redesign and the insert
// icon stops appearing, update the arrays in SELECTORS below first -- see
// README "Known limitations" for how to re-diagnose selectors via devtools.
//
// Note: this content script matches all of linkedin.com (see manifest.json),
// not just /messaging/*, because LinkedIn's chat also opens as a floating
// msg-overlay-conversation-bubble on any page (a profile, a job posting,
// the feed) -- restricting the match to /messaging/* was the original v1
// bug that meant the insert icon never appeared there.

(function () {
  // Self-diagnostic marker: proves this content script actually executed on
  // the current page (as opposed to the manifest match pattern excluding it,
  // or the extension being disabled/stale in an already-open tab). Check
  // window.__LMT__ from devtools console at any time -- if it's undefined,
  // this script never ran here at all, which is the very first thing to
  // rule out before touching selectors.
  window.__LMT__ = {
    version: '0.5.2',
    loadedAt: new Date().toISOString(),
    url: location.href,
    inIframe: window.top !== window,
    scans: 0,
    lastComposeBoxCount: 0,
    lastInjectedCount: 0,
    managerOpen: false,
    report() {
      console.log('[LMT] report', {
        version: this.version,
        loadedAt: this.loadedAt,
        loadedOnUrl: this.url,
        currentUrl: location.href,
        scans: this.scans,
        lastComposeBoxCount: this.lastComposeBoxCount,
        lastInjectedCount: this.lastInjectedCount,
        managerOpen: this.managerOpen,
        insertButtonsInDom: document.querySelectorAll('.lmt-trigger-btn').length,
        dockTabInDom: !!document.querySelector('.lmt-dock-tab'),
      });
    },
  };
  console.log('[LMT] content script loaded on', location.href, window.top !== window ? '(inside an iframe)' : '(top frame)');

  const SELECTORS = {
    // Candidate selectors for the message text box itself, tried in order.
    composeBox: [
      'div.msg-form__contenteditable[contenteditable="true"]',
    ],
    // Generic fallback for when LinkedIn renames msg-form__contenteditable.
    // NOT queried site-wide on its own -- [contenteditable=true][role=textbox]
    // also matches LinkedIn's post-comment editor (same underlying pattern),
    // so queryAllComposeBoxes() only keeps a match here when it also sits
    // inside a messaging-looking ancestor (see isLikelyMessagingContext).
    composeBoxGenericFallback: [
      'div[contenteditable="true"][role="textbox"]',
    ],
    // Candidate selectors for the row of icon buttons (emoji, gif, attach)
    // next to the compose box, where we prefer to inject our insert icon.
    toolbar: [
      '.msg-form__left-actions',
      '.msg-form__footer',
    ],
    // Candidate selectors (searched from the conversation container upward)
    // for the open conversation's title/recipient name.
    recipientName: [
      '.msg-overlay-bubble-header__title',
      '.msg-entity-lockup__entity-title',
      '.msg-title-bar__title',
      '.artdeco-entity-lockup__title',
      '.msg-conversation-card__participant-names',
    ],
  };

  const injectedBoxes = new WeakSet();
  const lastSelectionByBox = new WeakMap();

  function query(root, selectorList) {
    for (const sel of selectorList) {
      const el = root.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  function isLikelyMessagingContext(el) {
    // Scopes the generic fallback selector to elements that sit inside one
    // of LinkedIn's own messaging containers, so it can't also pick up the
    // post-comment editor or other unrelated contenteditable/role=textbox
    // elements elsewhere on the page.
    return !!el.closest('[class*="msg-form"], [class*="msg-overlay"], [class*="msg-convo"]');
  }

  function queryAllComposeBoxes() {
    const found = new Set();
    SELECTORS.composeBox.forEach((sel) => {
      document.querySelectorAll(sel).forEach((el) => found.add(el));
    });
    SELECTORS.composeBoxGenericFallback.forEach((sel) => {
      document.querySelectorAll(sel).forEach((el) => {
        if (isLikelyMessagingContext(el)) found.add(el);
      });
    });
    return Array.from(found);
  }

  // --- Recipient name detection ------------------------------------------

  function getRecipientFirstName(box) {
    let scope = box.closest('.msg-form') || box.closest('[class*="conversation"]') || document;
    let el = query(scope, SELECTORS.recipientName);
    if (!el) {
      // Last resort: widen to the whole document. Risks grabbing the wrong
      // name if multiple threads are open, but better than nothing.
      el = query(document, SELECTORS.recipientName);
    }
    if (!el) return null;
    const raw = el.textContent && el.textContent.trim();
    if (!raw) return null;
    // Group chats / "You and 3 others" style headers aren't a single first name.
    if (/,| and | others/i.test(raw)) return null;
    const first = raw.split(/\s+/)[0];
    return first || null;
  }

  // --- Insertion -----------------------------------------------------------

  function placeCaretAtEnd(el) {
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function manualInsert(box, text) {
    const sel = window.getSelection();
    if (sel.rangeCount === 0) placeCaretAtEnd(box);
    const range = sel.getRangeAt(0);
    range.deleteContents();
    range.insertNode(document.createTextNode(text));
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
    box.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
  }

  function insertTemplateIntoBox(box, text) {
    box.focus();
    const savedRange = lastSelectionByBox.get(box);
    if (savedRange) {
      try {
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(savedRange);
      } catch (err) {
        placeCaretAtEnd(box);
      }
    } else {
      placeCaretAtEnd(box);
    }

    // Primary path: execCommand fires a real 'input' event, same as native
    // typing, which is what makes LinkedIn's own React state pick it up.
    let handled = false;
    try {
      handled = document.execCommand && document.execCommand('insertText', false, text);
    } catch (err) {
      handled = false;
    }
    if (!handled) {
      manualInsert(box, text);
    }
  }

  function trackSelection(box) {
    const save = () => {
      const sel = window.getSelection();
      if (sel.rangeCount > 0 && box.contains(sel.anchorNode)) {
        lastSelectionByBox.set(box, sel.getRangeAt(0).cloneRange());
      }
    };
    box.addEventListener('keyup', save);
    box.addEventListener('mouseup', save);
    box.addEventListener('input', save);
  }

  // --- Per-box insert picker -------------------------------------------------

  let openInsertPanel = null;
  let openInsertPanelBox = null;

  function closeInsertPanel() {
    if (openInsertPanel) {
      openInsertPanel.remove();
      openInsertPanel = null;
      openInsertPanelBox = null;
      document.removeEventListener('mousedown', handleInsertOutsideClick, true);
      document.removeEventListener('keydown', handleInsertEscape, true);
    }
  }

  function handleInsertOutsideClick(event) {
    if (openInsertPanel && !openInsertPanel.contains(event.target)) closeInsertPanel();
  }

  function handleInsertEscape(event) {
    if (event.key === 'Escape') closeInsertPanel();
  }

  async function openInsertPanelFor(box, anchorBtn) {
    closeInsertPanel();

    const panel = document.createElement('div');
    panel.className = 'lmt-panel';

    const header = document.createElement('div');
    header.className = 'lmt-panel-header';
    header.innerHTML = '<strong>Templates</strong>';
    const closeBtn = document.createElement('button');
    closeBtn.className = 'lmt-panel-close';
    closeBtn.type = 'button';
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', closeInsertPanel);
    header.appendChild(closeBtn);
    panel.appendChild(header);

    const templates = await TemplateStorage.getTemplates();

    if (templates.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'lmt-panel-empty';
      empty.textContent = "No templates yet. Add one from the templates tab docked to the right edge of the page (or the extension's toolbar icon).";
      panel.appendChild(empty);
    } else {
      const list = document.createElement('ul');
      list.className = 'lmt-panel-list';
      templates.forEach((tpl) => {
        const item = document.createElement('li');
        item.className = 'lmt-panel-item';
        const titleEl = document.createElement('p');
        titleEl.className = 'lmt-panel-item-title';
        titleEl.textContent = tpl.title || '(untitled)';
        const previewEl = document.createElement('p');
        previewEl.className = 'lmt-panel-item-preview';
        previewEl.textContent = tpl.body || '';
        item.appendChild(titleEl);
        item.appendChild(previewEl);
        item.addEventListener('click', () => {
          const firstName = getRecipientFirstName(box);
          const resolved = TemplatePlaceholders.resolveBody(tpl.body, { recipientFirstName: firstName });
          insertTemplateIntoBox(box, resolved);
          closeInsertPanel();
        });
        list.appendChild(item);
      });
      panel.appendChild(list);
    }

    document.body.appendChild(panel);

    const btnRect = anchorBtn.getBoundingClientRect();
    const preferredTop = window.scrollY + btnRect.top - panel.offsetHeight - 8;
    const fitsAbove = preferredTop >= window.scrollY;
    const top = fitsAbove ? preferredTop : window.scrollY + btnRect.bottom + 8;
    panel.style.top = `${top}px`;
    panel.style.left = `${window.scrollX + btnRect.left}px`;

    openInsertPanel = panel;
    openInsertPanelBox = box;
    setTimeout(() => {
      document.addEventListener('mousedown', handleInsertOutsideClick, true);
      document.addEventListener('keydown', handleInsertEscape, true);
    }, 0);
  }

  // --- Per-box insert icon injection ---------------------------------------

  function makeTriggerButton() {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'lmt-trigger-btn';
    btn.title = 'Insert a message template';
    btn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="3" y="5" width="18" height="14" rx="3" fill="white" fill-opacity="0.95"/>
        <rect x="6.5" y="9" width="11" height="1.6" rx="0.8" fill="#056F50"/>
        <rect x="6.5" y="12.2" width="8" height="1.6" rx="0.8" fill="#056F50"/>
      </svg>
    `;
    return btn;
  }

  function injectButtonFor(box) {
    if (injectedBoxes.has(box)) return;

    const form = box.closest('.msg-form') || box.parentElement;
    if (!form) return;

    const toolbar = query(form, SELECTORS.toolbar);
    const btn = makeTriggerButton();
    btn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (openInsertPanel && openInsertPanelBox === box) {
        closeInsertPanel();
      } else {
        openInsertPanelFor(box, btn);
      }
    });

    if (toolbar) {
      toolbar.appendChild(btn);
      console.log('[LMT] injected insert icon into toolbar', toolbar.className);
    } else {
      // Fallback: no recognizable toolbar row found -- float the button at
      // the compose box's bottom-right corner rather than skip injection.
      btn.style.position = 'absolute';
      btn.style.zIndex = '2147483000';
      const wrapper = box.parentElement;
      if (!wrapper) {
        console.log('[LMT] no toolbar and no wrapper element -- could not inject insert icon');
        return;
      }
      const computed = window.getComputedStyle(wrapper);
      if (computed.position === 'static') wrapper.style.position = 'relative';
      btn.style.bottom = '6px';
      btn.style.right = '6px';
      wrapper.appendChild(btn);
      console.log('[LMT] no toolbar found -- injected insert icon via fallback float positioning');
    }

    trackSelection(box);
    injectedBoxes.add(box);
  }

  // --- Docked tab: template manager (SalesQL-style layout) -----------------

  // Accent palette per README color system: cycles purple/yellow/blue/mint
  // (each an { bg, fg } pair -- fg is used for the doc-icon glyph, bg for
  // the rounded square behind it).
  const ICON_PALETTE = [
    { bg: '#E9DFFF', fg: '#6536E8' }, // Lavender / Purple
    { bg: '#FEF0CA', fg: '#D89400' }, // Yellow / Yellow Icon
    { bg: '#E2F0FF', fg: '#2778D8' }, // Blue / Blue Icon
    { bg: '#DDF4E8', fg: '#087A5B' }, // Mint / Mint Icon
  ];

  function iconColorsFor(index) {
    return ICON_PALETTE[index % ICON_PALETTE.length];
  }

  function docIconSvg(color) {
    return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M6 2h9l5 5v15a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z" stroke="${color}" stroke-width="1.6" stroke-linejoin="round"/>
      <path d="M14 2v5h5" stroke="${color}" stroke-width="1.6" stroke-linejoin="round"/>
    </svg>`;
  }

  let sidebarEl = null;
  let dockTabEl = null;
  let sidebarOpen = false;
  let managerView = 'list'; // 'list' | 'edit' | 'settings'
  let managerEditingId = null; // null while adding a new template
  let managerSearchQuery = '';
  let openItemMenu = null;
  let listRenderToken = 0; // guards against overlapping renders duplicating the list

  function moveItem(templates, index, delta) {
    const target = index + delta;
    if (target < 0 || target >= templates.length) return templates;
    const next = templates.slice();
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item);
    return next;
  }

  function closeItemMenu() {
    if (openItemMenu) {
      openItemMenu.remove();
      openItemMenu = null;
      document.removeEventListener('mousedown', handleItemMenuOutsideClick, true);
    }
  }

  function handleItemMenuOutsideClick(event) {
    if (openItemMenu && !openItemMenu.contains(event.target)) closeItemMenu();
  }

  function openItemMenuFor(tpl, index, total, anchorBtn) {
    closeItemMenu();
    const menu = document.createElement('div');
    menu.className = 'lmt-sb-item-menu';

    const makeRow = (label, action, danger, disabled) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'lmt-sb-item-menu-row' + (danger ? ' lmt-sb-item-menu-row--danger' : '');
      b.textContent = label;
      b.disabled = !!disabled;
      b.addEventListener('click', async (event) => {
        event.stopPropagation();
        closeItemMenu();
        if (action === 'edit') {
          managerView = 'edit';
          managerEditingId = tpl.id;
          renderManager();
        } else if (action === 'up' || action === 'down') {
          const templates = await TemplateStorage.getTemplates();
          const next = moveItem(templates, index, action === 'up' ? -1 : 1);
          await TemplateStorage.reorderTemplates(next.map((t) => t.id));
          renderManagerListItems();
        } else if (action === 'delete') {
          const confirmed = window.confirm(`Delete "${tpl.title || 'this template'}"?`);
          if (!confirmed) return;
          await TemplateStorage.deleteTemplate(tpl.id);
          renderManagerListItems();
        }
      });
      return b;
    };

    menu.appendChild(makeRow('Edit', 'edit'));
    menu.appendChild(makeRow('Move up', 'up', false, index === 0));
    menu.appendChild(makeRow('Move down', 'down', false, index === total - 1));
    menu.appendChild(makeRow('Delete', 'delete', true));

    document.body.appendChild(menu);
    const rect = anchorBtn.getBoundingClientRect();
    menu.style.top = `${window.scrollY + rect.bottom + 4}px`;
    menu.style.left = `${window.scrollX + rect.right - menu.offsetWidth}px`;

    openItemMenu = menu;
    setTimeout(() => document.addEventListener('mousedown', handleItemMenuOutsideClick, true), 0);
  }

  function handleManagerOutsideClick(event) {
    if (!sidebarOpen) return;
    if (openItemMenu) return; // let the item menu's own outside-click handler deal with it first
    if (sidebarEl && sidebarEl.contains(event.target)) return;
    if (dockTabEl && dockTabEl.contains(event.target)) return;
    closeManager();
  }

  function handleManagerEscape(event) {
    if (event.key !== 'Escape') return;
    if (openItemMenu) { closeItemMenu(); return; }
    closeManager();
  }

  function closeManager() {
    sidebarOpen = false;
    window.__LMT__.managerOpen = false;
    closeItemMenu();
    if (sidebarEl) sidebarEl.classList.remove('lmt-sidebar--open');
    document.removeEventListener('mousedown', handleManagerOutsideClick, true);
    document.removeEventListener('keydown', handleManagerEscape, true);
  }

  function toggleManager() {
    if (sidebarOpen) closeManager();
    else openManager();
  }

  async function openManager() {
    if (!sidebarEl) sidebarEl = createSidebar();
    managerView = 'list';
    managerEditingId = null;
    managerSearchQuery = '';
    await renderManager();
    sidebarEl.classList.add('lmt-sidebar--open');
    sidebarOpen = true;
    window.__LMT__.managerOpen = true;
    setTimeout(() => {
      document.addEventListener('mousedown', handleManagerOutsideClick, true);
      document.addEventListener('keydown', handleManagerEscape, true);
    }, 0);
  }

  function updateNavState() {
    const nav = sidebarEl.querySelector('.lmt-sb-nav');
    if (!nav) return;
    nav.hidden = managerView === 'edit';
    nav.querySelectorAll('.lmt-sb-nav-item').forEach((btn) => {
      const tab = btn.getAttribute('data-tab');
      const active = (tab === 'list' && managerView === 'list') || (tab === 'settings' && managerView === 'settings');
      btn.classList.toggle('is-active', active);
    });
  }

  function renderManager() {
    updateNavState();
    if (managerView === 'edit') return renderManagerForm();
    if (managerView === 'settings') return renderManagerSettings();
    return renderManagerList();
  }

  async function renderManagerList() {
    const body = sidebarEl.querySelector('.lmt-sidebar-body');
    body.innerHTML = '';
    closeItemMenu();

    const titleBlock = document.createElement('div');
    titleBlock.className = 'lmt-sb-titleblock';
    titleBlock.innerHTML = '<h2>Templates</h2><p>Create and reuse message templates</p>';
    body.appendChild(titleBlock);

    const toolbar = document.createElement('div');
    toolbar.className = 'lmt-sb-toolbar';
    toolbar.innerHTML = `
      <div class="lmt-sb-search">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="11" cy="11" r="7" stroke="#54606A" stroke-width="1.8"/><path d="M21 21l-4-4" stroke="#54606A" stroke-width="1.8" stroke-linecap="round"/></svg>
        <input type="text" class="lmt-sb-search-input" placeholder="Search templates..." />
      </div>
      <button type="button" class="lmt-sb-filter" title="Folders are planned for a future update">All ▾</button>
    `;
    const searchInput = toolbar.querySelector('.lmt-sb-search-input');
    searchInput.value = managerSearchQuery;
    searchInput.addEventListener('input', () => {
      managerSearchQuery = searchInput.value;
      renderManagerListItems();
    });
    body.appendChild(toolbar);

    const scroll = document.createElement('div');
    scroll.className = 'lmt-sb-list-scroll';
    body.appendChild(scroll);

    await renderManagerListItems();
  }

  // Guarded against overlapping calls: onTemplatesChanged (fired by any
  // storage write, including ones this same render triggers) and the direct
  // post-action calls below can both fire for one edit -- without the token
  // check, both would resolve and each append their own <ul>, duplicating
  // the list. Only the most-recently-started call is allowed to touch the DOM.
  async function renderManagerListItems() {
    const scroll = sidebarEl && sidebarEl.querySelector('.lmt-sb-list-scroll');
    if (!scroll) return;
    const token = ++listRenderToken;

    const allTemplates = await TemplateStorage.getTemplates();
    if (token !== listRenderToken) return; // superseded by a newer render

    closeItemMenu();
    scroll.innerHTML = '';

    const q = managerSearchQuery.trim().toLowerCase();
    const templates = q
      ? allTemplates.filter((t) => (t.title || '').toLowerCase().includes(q) || (t.body || '').toLowerCase().includes(q))
      : allTemplates;

    if (allTemplates.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'lmt-sidebar-empty';
      empty.textContent = 'No templates yet. Use "New Template" below to add your first one.';
      scroll.appendChild(empty);
      return;
    }

    if (templates.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'lmt-sidebar-empty';
      empty.textContent = `No templates match "${managerSearchQuery}".`;
      scroll.appendChild(empty);
      return;
    }

    const list = document.createElement('ul');
    list.className = 'lmt-sidebar-list';

    templates.forEach((tpl) => {
      const index = allTemplates.indexOf(tpl);
      const colors = iconColorsFor(index);
      const item = document.createElement('li');
      item.className = 'lmt-sidebar-item';

      const icon = document.createElement('span');
      icon.className = 'lmt-sidebar-item-icon';
      icon.style.background = colors.bg;
      icon.innerHTML = docIconSvg(colors.fg);
      item.appendChild(icon);

      const main = document.createElement('div');
      main.className = 'lmt-sidebar-item-main';
      const titleEl = document.createElement('p');
      titleEl.className = 'lmt-sidebar-item-title';
      titleEl.textContent = tpl.title || '(untitled)';
      const previewEl = document.createElement('p');
      previewEl.className = 'lmt-sidebar-item-preview';
      previewEl.textContent = tpl.body || '';
      main.appendChild(titleEl);
      main.appendChild(previewEl);
      main.addEventListener('click', () => {
        managerView = 'edit';
        managerEditingId = tpl.id;
        renderManager();
      });
      item.appendChild(main);

      const menuBtn = document.createElement('button');
      menuBtn.type = 'button';
      menuBtn.className = 'lmt-sidebar-item-menu-btn';
      menuBtn.title = 'More';
      menuBtn.textContent = '⋮';
      menuBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        openItemMenuFor(tpl, index, allTemplates.length, menuBtn);
      });
      item.appendChild(menuBtn);

      list.appendChild(item);
    });

    scroll.appendChild(list);
  }

  async function renderManagerForm() {
    const body = sidebarEl.querySelector('.lmt-sidebar-body');
    body.innerHTML = '';
    closeItemMenu();

    let editing = null;
    if (managerEditingId) {
      const templates = await TemplateStorage.getTemplates();
      editing = templates.find((t) => t.id === managerEditingId) || null;
    }

    const titleBlock = document.createElement('div');
    titleBlock.className = 'lmt-sb-titleblock';
    titleBlock.innerHTML = `<h2>${editing ? 'Edit Template' : 'New Template'}</h2>`;
    body.appendChild(titleBlock);

    const form = document.createElement('form');
    form.className = 'lmt-sidebar-form';

    const titleLabel = document.createElement('label');
    titleLabel.className = 'lmt-sidebar-form-label';
    titleLabel.textContent = 'Title';
    const titleInput = document.createElement('input');
    titleInput.type = 'text';
    titleInput.className = 'lmt-sidebar-form-input';
    titleInput.placeholder = 'e.g. Intro follow-up';
    titleInput.value = editing ? editing.title : '';
    titleLabel.appendChild(titleInput);

    const bodyLabel = document.createElement('label');
    bodyLabel.className = 'lmt-sidebar-form-label';
    bodyLabel.textContent = 'Description';
    const bodyTextarea = document.createElement('textarea');
    bodyTextarea.className = 'lmt-sidebar-form-textarea';
    bodyTextarea.rows = 7;
    bodyTextarea.placeholder = 'Hi {{first_name}}, thanks for connecting...';
    bodyTextarea.value = editing ? editing.body : '';
    bodyLabel.appendChild(bodyTextarea);

    const callout = document.createElement('div');
    callout.className = 'lmt-sb-callout';
    callout.innerHTML = '<span class="lmt-sb-callout-badge">i</span><p>You can use variables like <strong>{{first_name}}</strong>, <strong>{{company_name}}</strong> etc.</p>';

    const footer = document.createElement('div');
    footer.className = 'lmt-sb-footer';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'lmt-btn lmt-btn--secondary';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => {
      managerView = 'list';
      managerEditingId = null;
      renderManager();
    });

    const saveBtn = document.createElement('button');
    saveBtn.type = 'submit';
    saveBtn.className = 'lmt-btn lmt-btn--primary';
    saveBtn.textContent = 'Save';

    footer.appendChild(cancelBtn);
    footer.appendChild(saveBtn);

    // IMPORTANT: footer (with the type="submit" Save button) must be INSIDE
    // the <form> -- a submit button outside its form never fires the form's
    // submit event, which is exactly why Save silently did nothing before.
    form.appendChild(titleLabel);
    form.appendChild(bodyLabel);
    form.appendChild(callout);
    form.appendChild(footer);
    body.appendChild(form);

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const title = titleInput.value.trim();
      const bodyText = bodyTextarea.value.trim();
      if (!title || !bodyText) return;
      if (managerEditingId) {
        await TemplateStorage.updateTemplate(managerEditingId, { title, body: bodyText });
      } else {
        await TemplateStorage.addTemplate({ title, body: bodyText });
      }
      managerView = 'list';
      managerEditingId = null;
      renderManager();
    });

    titleInput.focus();
  }

  function renderManagerSettings() {
    const body = sidebarEl.querySelector('.lmt-sidebar-body');
    body.innerHTML = '';
    closeItemMenu();

    const titleBlock = document.createElement('div');
    titleBlock.className = 'lmt-sb-titleblock';
    titleBlock.innerHTML = '<h2>Settings</h2>';
    body.appendChild(titleBlock);

    const panel = document.createElement('div');
    panel.className = 'lmt-sb-settings';
    panel.innerHTML = `
      <p>Templates sync automatically wherever you edit them — this sidebar, or the extension's toolbar icon — edits show up in both places.</p>
      <p>Categories, search filters, and more settings are planned for a future update.</p>
    `;
    body.appendChild(panel);
  }

  function createSidebar() {
    const el = document.createElement('div');
    el.className = 'lmt-sidebar';

    const header = document.createElement('div');
    header.className = 'lmt-sb-header';
    header.innerHTML = `
      <div class="lmt-sb-brand">
        <span class="lmt-sb-brand-icon">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="3" y="5" width="18" height="14" rx="3" fill="white" fill-opacity="0.95"/>
            <rect x="6.5" y="9" width="11" height="1.6" rx="0.8" fill="#056F50"/>
            <rect x="6.5" y="12.2" width="8" height="1.6" rx="0.8" fill="#056F50"/>
          </svg>
        </span>
        <span class="lmt-sb-brand-name">QwikStack</span>
      </div>
    `;
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'lmt-sb-close';
    closeBtn.title = 'Close';
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', closeManager);
    header.appendChild(closeBtn);
    el.appendChild(header);

    const body = document.createElement('div');
    body.className = 'lmt-sidebar-body';
    el.appendChild(body);

    const nav = document.createElement('div');
    nav.className = 'lmt-sb-nav';
    nav.innerHTML = `
      <button type="button" class="lmt-sb-nav-item" data-tab="list">
        ${docIconSvg('currentColor')}
        <span>Templates</span>
      </button>
      <button type="button" class="lmt-sb-nav-item" data-tab="new">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.6"/><path d="M12 8v8M8 12h8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
        <span>New Template</span>
      </button>
      <button type="button" class="lmt-sb-nav-item" data-tab="settings">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="3.2" stroke="currentColor" stroke-width="1.6"/><path d="M12 3v2.4M12 18.6V21M4.9 4.9l1.7 1.7M17.4 17.4l1.7 1.7M3 12h2.4M18.6 12H21M4.9 19.1l1.7-1.7M17.4 6.6l1.7-1.7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
        <span>Settings</span>
      </button>
    `;
    nav.querySelector('[data-tab="list"]').addEventListener('click', () => {
      managerView = 'list';
      managerEditingId = null;
      renderManager();
    });
    nav.querySelector('[data-tab="new"]').addEventListener('click', () => {
      managerView = 'edit';
      managerEditingId = null;
      renderManager();
    });
    nav.querySelector('[data-tab="settings"]').addEventListener('click', () => {
      managerView = 'settings';
      renderManager();
    });
    el.appendChild(nav);

    document.body.appendChild(el);
    return el;
  }

  function createDockTab() {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'lmt-dock-tab';
    btn.title = 'Manage message templates';
    btn.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="3" y="5" width="18" height="14" rx="3" fill="white" fill-opacity="0.95"/>
        <rect x="6.5" y="9" width="11" height="1.6" rx="0.8" fill="#056F50"/>
        <rect x="6.5" y="12.2" width="8" height="1.6" rx="0.8" fill="#056F50"/>
      </svg>
    `;
    btn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleManager();
    });
    document.body.appendChild(btn);
    return btn;
  }

  // Keep the docked manager in sync if templates change elsewhere (e.g. a
  // different tab, or a change this same tab just made).
  TemplateStorage.onTemplatesChanged(() => {
    if (sidebarOpen && managerView === 'list') renderManagerListItems();
  });

  // Toggling from the extension's own toolbar icon: background.js has no
  // default_popup set, so clicking it fires chrome.action.onClicked there,
  // which relays a message here to open the same sidebar as the docked tab.
  if (chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((message) => {
      if (message && message.type === 'LMT_TOGGLE_MANAGER') {
        toggleManager();
      }
    });
  }

  // --- Scan / observe --------------------------------------------------------

  function scan() {
    if (!dockTabEl) dockTabEl = createDockTab();

    const boxes = queryAllComposeBoxes();
    window.__LMT__.scans += 1;
    window.__LMT__.lastComposeBoxCount = boxes.length;
    if (boxes.length === 0 && window.__LMT__.scans <= 3) {
      // Only log the miss for the first few scans so an idle tab (e.g. no
      // conversation open) doesn't spam the console forever.
      console.log('[LMT] scan #' + window.__LMT__.scans + ': found 0 compose boxes on', location.href);
    }
    boxes.forEach(injectButtonFor);
    window.__LMT__.lastInjectedCount = document.querySelectorAll('.lmt-trigger-btn').length;
  }

  let scanScheduled = false;
  function scheduleScan() {
    if (scanScheduled) return;
    scanScheduled = true;
    setTimeout(() => {
      scanScheduled = false;
      scan();
    }, 300);
  }

  const observer = new MutationObserver(scheduleScan);
  observer.observe(document.body, { childList: true, subtree: true });

  scan();
  // Safety net: LinkedIn's messaging overlay can swap content in ways that
  // don't always trigger a clean mutation our observer catches immediately.
  setInterval(scan, 4000);
})();
