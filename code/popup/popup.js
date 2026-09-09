// popup/popup.js
// Template management UI: list, add, edit, delete, reorder.
// Relies on the shared TemplateStorage global from lib/storage.js.

(function () {
  const listView = document.getElementById('list-view');
  const editView = document.getElementById('edit-view');
  const emptyState = document.getElementById('empty-state');
  const listEl = document.getElementById('template-list');
  const addBtn = document.getElementById('add-btn');
  const form = document.getElementById('template-form');
  const titleInput = document.getElementById('title-input');
  const bodyInput = document.getElementById('body-input');
  const cancelBtn = document.getElementById('cancel-btn');

  let editingId = null; // null = creating a new template

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function showList() {
    editView.hidden = true;
    listView.hidden = false;
    editingId = null;
    form.reset();
  }

  function showEdit(template) {
    listView.hidden = true;
    editView.hidden = false;
    editingId = template ? template.id : null;
    titleInput.value = template ? template.title : '';
    bodyInput.value = template ? template.body : '';
    titleInput.focus();
  }

  function moveItem(templates, index, delta) {
    const target = index + delta;
    if (target < 0 || target >= templates.length) return templates;
    const next = templates.slice();
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item);
    return next;
  }

  async function render() {
    const templates = await TemplateStorage.getTemplates();
    emptyState.hidden = templates.length > 0;
    listEl.innerHTML = '';

    templates.forEach((tpl, index) => {
      const li = document.createElement('li');
      li.className = 'template-item';
      li.innerHTML = `
        <div class="template-main" data-action="edit">
          <p class="template-title">${escapeHtml(tpl.title || '(untitled)')}</p>
          <p class="template-preview">${escapeHtml(tpl.body || '')}</p>
        </div>
        <div class="template-actions">
          <button class="icon-btn" data-action="up" title="Move up" ${index === 0 ? 'disabled' : ''}>&uarr;</button>
          <button class="icon-btn" data-action="down" title="Move down" ${index === templates.length - 1 ? 'disabled' : ''}>&darr;</button>
          <button class="icon-btn danger" data-action="delete" title="Delete">&times;</button>
        </div>
      `;

      li.querySelector('[data-action="edit"]').addEventListener('click', () => showEdit(tpl));

      const upBtn = li.querySelector('[data-action="up"]');
      const downBtn = li.querySelector('[data-action="down"]');
      upBtn.addEventListener('click', async () => {
        const next = moveItem(templates, index, -1);
        await TemplateStorage.reorderTemplates(next.map((t) => t.id));
        render();
      });
      downBtn.addEventListener('click', async () => {
        const next = moveItem(templates, index, 1);
        await TemplateStorage.reorderTemplates(next.map((t) => t.id));
        render();
      });

      li.querySelector('[data-action="delete"]').addEventListener('click', async () => {
        const confirmed = confirm(`Delete "${tpl.title || 'this template'}"?`);
        if (!confirmed) return;
        await TemplateStorage.deleteTemplate(tpl.id);
        render();
      });

      listEl.appendChild(li);
    });
  }

  addBtn.addEventListener('click', () => showEdit(null));
  cancelBtn.addEventListener('click', showList);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const title = titleInput.value.trim();
    const body = bodyInput.value.trim();
    if (!title || !body) return;

    if (editingId) {
      await TemplateStorage.updateTemplate(editingId, { title, body });
    } else {
      await TemplateStorage.addTemplate({ title, body });
    }
    showList();
    render();
  });

  // Keep the popup in sync if templates change elsewhere (e.g. another window).
  TemplateStorage.onTemplatesChanged(() => {
    if (!listView.hidden) render();
  });

  render();
})();
