// lib/storage.js
// Shared storage layer for LinkedIn Message Templates.
// Exposes a single global: TemplateStorage
// Uses chrome.storage.sync so templates follow the user's Chrome login across devices
// (~100KB total / ~8KB per item quota — comfortably fits dozens of short templates).

(function (global) {
  const STORAGE_KEY = 'templates';

  function generateId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return 'tmpl_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
  }

  function getTemplates() {
    return new Promise((resolve) => {
      chrome.storage.sync.get([STORAGE_KEY], (result) => {
        resolve(Array.isArray(result[STORAGE_KEY]) ? result[STORAGE_KEY] : []);
      });
    });
  }

  function saveTemplates(templates) {
    return new Promise((resolve, reject) => {
      chrome.storage.sync.set({ [STORAGE_KEY]: templates }, () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(templates);
        }
      });
    });
  }

  async function addTemplate({ title, body }) {
    const templates = await getTemplates();
    const now = Date.now();
    const template = {
      id: generateId(),
      title: (title || '').trim(),
      body: (body || '').trim(),
      folderId: null, // reserved for Phase 2 (categories/folders)
      createdAt: now,
      updatedAt: now,
    };
    templates.push(template);
    await saveTemplates(templates);
    return template;
  }

  async function updateTemplate(id, changes) {
    const templates = await getTemplates();
    const index = templates.findIndex((t) => t.id === id);
    if (index === -1) return null;
    templates[index] = {
      ...templates[index],
      ...changes,
      id: templates[index].id, // never let changes override id
      updatedAt: Date.now(),
    };
    await saveTemplates(templates);
    return templates[index];
  }

  async function deleteTemplate(id) {
    const templates = await getTemplates();
    const next = templates.filter((t) => t.id !== id);
    await saveTemplates(next);
    return next;
  }

  async function reorderTemplates(orderedIds) {
    const templates = await getTemplates();
    const byId = new Map(templates.map((t) => [t.id, t]));
    const reordered = orderedIds.map((id) => byId.get(id)).filter(Boolean);
    // Defensive: append anything missing from orderedIds rather than silently dropping it
    templates.forEach((t) => {
      if (!orderedIds.includes(t.id)) reordered.push(t);
    });
    await saveTemplates(reordered);
    return reordered;
  }

  function onTemplatesChanged(callback) {
    const listener = (changes, area) => {
      if (area === 'sync' && changes[STORAGE_KEY]) {
        callback(changes[STORAGE_KEY].newValue || []);
      }
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }

  global.TemplateStorage = {
    getTemplates,
    saveTemplates,
    addTemplate,
    updateTemplate,
    deleteTemplate,
    reorderTemplates,
    onTemplatesChanged,
  };
})(typeof window !== 'undefined' ? window : self);
