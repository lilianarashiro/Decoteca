'use strict';

/* ===== Configuração ===== */
const APP_NAME = 'Decoteca';
const DEFAULT_CATEGORIES = ['Aniversário', 'Páscoa', 'Festa Junina', 'Halloween', 'Natal', "St. Patrick's"];
const DEFAULT_TYPES = ['Impressão 3D', 'Toalha de mesa', 'Para pendurar'];
const EXPORT_TAG = 'acervo-festivo';
const PHOTO_MAX_SIZE = 1200;   // lado maior da foto salva, em pixels
const PHOTO_QUALITY = 0.82;

/* ===== Ícones ===== */
const ICON = {
  search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21"/></svg>',
  heart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="heart" d="M12 20.5s-7.5-4.6-9.2-9.4C1.6 7.6 3.8 4.5 7.1 4.5c2 0 3.6 1.1 4.9 2.9 1.3-1.8 2.9-2.9 4.9-2.9 3.3 0 5.5 3.1 4.3 6.6-1.7 4.8-9.2 9.4-9.2 9.4z"/></svg>',
  filter: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 8h8M15 8h6M3 16h4M11 16h10"/><circle cx="13" cy="8" r="2"/><circle cx="9" cy="16" r="2"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5l14 14M19 5 5 19"/></svg>',
  camera: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
};

/* ===== Utilidades ===== */
const $ = (sel, root = document) => root.querySelector(sel);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Comparação sem diferenciar maiúsculas, acentos e espaços nas pontas
const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().replace(/\s+/g, ' ').toLowerCase();
const clean = s => String(s ?? '').trim().replace(/\s+/g, ' ');
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const byNewest = (a, b) => (b.createdAt || '').localeCompare(a.createdAt || '');

function uniqueKeepOrder(values) {
  const seen = new Set();
  return values.filter(v => !seen.has(norm(v)) && seen.add(norm(v)));
}

// Valores distintos de um campo de texto livre, para o autocompletar
function distinctValues(field, exceptId) {
  const values = state.items.filter(i => i.id !== exceptId).map(i => clean(i[field])).filter(Boolean);
  return uniqueKeepOrder(values).sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

// Se já existe um valor equivalente, reaproveita a grafia dele
function canonical(value, existing) {
  const v = clean(value);
  return existing.find(e => norm(e) === norm(v)) || v;
}

function formatDim(n) {
  return n === null || n === undefined ? '' : String(n).replace('.', ',');
}

function parseDim(str) {
  const s = String(str).trim().replace(',', '.');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : NaN;
}

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
}

/* ===== Banco de dados local (IndexedDB) ===== */
const db = {
  _open: null,
  open() {
    if (!this._open) {
      this._open = new Promise((resolve, reject) => {
        const req = indexedDB.open('acervo-festivo', 1);
        req.onupgradeneeded = () => {
          const d = req.result;
          if (!d.objectStoreNames.contains('items')) d.createObjectStore('items', { keyPath: 'id' });
          if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'key' });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return this._open;
  },
  async run(store, mode, fn) {
    const d = await this.open();
    return new Promise((resolve, reject) => {
      const t = d.transaction(store, mode);
      const req = fn(t.objectStore(store));
      t.oncomplete = () => resolve(req ? req.result : undefined);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error('Operação cancelada.'));
    });
  },
  getAll: store => db.run(store, 'readonly', s => s.getAll()),
  get: (store, key) => db.run(store, 'readonly', s => s.get(key)),
  put: (store, value) => db.run(store, 'readwrite', s => s.put(value)),
  putMany: (store, values) => db.run(store, 'readwrite', s => { values.forEach(v => s.put(v)); }),
  del: (store, key) => db.run(store, 'readwrite', s => s.delete(key)),
  clear: store => db.run(store, 'readwrite', s => s.clear()),
};

/* ===== Estado ===== */
const state = {
  items: [],
  lists: { categories: [], types: [] },
  query: '',
  onlyFav: false,
  filters: { categories: new Set(), types: new Set(), brands: new Set(), locations: new Set() },
  homeScroll: 0,
};

function normalizeItem(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.photo !== 'string' || !raw.photo.startsWith('data:image/')) return null;
  const num = v => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  const strs = a => Array.isArray(a) ? uniqueKeepOrder(a.filter(x => typeof x === 'string').map(clean).filter(Boolean)) : [];
  const now = new Date().toISOString();
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : uid(),
    photo: raw.photo,
    name: typeof raw.name === 'string' ? clean(raw.name) : '',
    categories: strs(raw.categories),
    types: strs(raw.types),
    brand: typeof raw.brand === 'string' ? clean(raw.brand) : '',
    location: typeof raw.location === 'string' ? clean(raw.location) : '',
    notes: typeof raw.notes === 'string' ? raw.notes.trim() : '',
    height: num(raw.height),
    width: num(raw.width),
    depth: num(raw.depth),
    favorite: !!raw.favorite,
    sample: !!raw.sample,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : now,
  };
}

async function saveItem(item) {
  await db.put('items', item);
  const i = state.items.findIndex(x => x.id === item.id);
  if (i >= 0) state.items[i] = item; else state.items.push(item);
}

async function removeItem(id) {
  await db.del('items', id);
  state.items = state.items.filter(i => i.id !== id);
}

async function saveLists() {
  await db.put('meta', { key: 'lists', categories: state.lists.categories, types: state.lists.types });
}

function addListValue(key, name) {
  const existing = state.lists[key].find(v => norm(v) === norm(name));
  if (existing) return existing;
  state.lists[key].push(clean(name));
  return clean(name);
}

// Garante que toda categoria/tipo usada num item exista nas listas
function syncListsWithItems() {
  for (const item of state.items) {
    item.categories = item.categories.map(c => addListValue('categories', c));
    item.types = item.types.map(t => addListValue('types', t));
  }
}

/* ===== Fotos ===== */
function compressImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, PHOTO_MAX_SIZE / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.round(img.naturalWidth * scale);
      const h = Math.round(img.naturalHeight * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', PHOTO_QUALITY));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Não foi possível ler esta imagem.'));
    };
    img.src = url;
  });
}

/* ===== Diálogos ===== */
function openDialog(html, cls = '') {
  const d = document.createElement('dialog');
  d.className = `dlg ${cls}`;
  d.innerHTML = html;
  document.body.appendChild(d);
  d.addEventListener('close', () => d.remove());
  d.addEventListener('click', e => { if (e.target === d) d.close('cancel'); });
  d.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => d.close('cancel')));
  d.showModal();
  return d;
}

function askText(title, initial = '') {
  return new Promise(resolve => {
    const d = openDialog(`
      <form method="dialog" class="dlg-body">
        <h2>${esc(title)}</h2>
        <input name="v" class="text-input" value="${esc(initial)}" required maxlength="60" autocomplete="off">
        <div class="dlg-actions">
          <button type="button" class="btn" data-close>Cancelar</button>
          <button value="ok" class="btn btn-primary">OK</button>
        </div>
      </form>`);
    const input = $('input', d);
    input.select();
    d.addEventListener('close', () => resolve(d.returnValue === 'ok' ? clean(input.value) || null : null));
  });
}

function choose(title, message, buttons) {
  return new Promise(resolve => {
    const d = openDialog(`
      <form method="dialog" class="dlg-body">
        <h2>${esc(title)}</h2>
        <p>${esc(message)}</p>
        <div class="dlg-actions">
          ${buttons.map(b => `<button value="${esc(b.value)}" class="btn ${b.cls || ''}">${esc(b.label)}</button>`).join('')}
        </div>
      </form>`);
    d.addEventListener('close', () => resolve(d.returnValue || 'cancel'));
  });
}

const confirmDanger = (title, message, label) =>
  choose(title, message, [{ value: 'cancel', label: 'Cancelar' }, { value: 'ok', label, cls: 'btn-danger' }]).then(v => v === 'ok');

/* ===== Autocompletar ===== */
function setupAutocomplete(input, getOptions) {
  const list = document.createElement('ul');
  list.className = 'ac-list';
  list.hidden = true;
  input.parentNode.appendChild(list);
  let options = [];
  let active = -1;

  const hide = () => { list.hidden = true; active = -1; };

  const show = () => {
    const v = norm(input.value);
    options = getOptions().filter(o => !v || norm(o).includes(v));
    const exact = options.some(o => norm(o) === v);
    if (!options.length && !v) return hide();
    list.innerHTML = options.slice(0, 8).map((o, i) => `<li data-i="${i}">${esc(o)}</li>`).join('')
      + (v && !exact ? `<li class="ac-new">Novo: “${esc(clean(input.value))}”</li>` : '');
    if (exact && options.length === 1) return hide();
    active = -1;
    list.hidden = false;
  };

  const pick = i => {
    input.value = options[i];
    input.dispatchEvent(new Event('input', { bubbles: true }));
    hide();
  };

  input.addEventListener('input', e => { if (e.isTrusted) show(); });
  input.addEventListener('focus', show);
  input.addEventListener('blur', () => setTimeout(hide, 120));
  input.addEventListener('keydown', e => {
    const lis = [...list.querySelectorAll('li[data-i]')];
    if (list.hidden || !lis.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + lis.length) % lis.length;
      lis.forEach((li, i) => li.classList.toggle('active', i === active));
    } else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault();
      pick(active);
    } else if (e.key === 'Escape') {
      hide();
    }
  });
  list.addEventListener('mousedown', e => {
    e.preventDefault();
    const li = e.target.closest('li');
    if (!li) return;
    if (li.dataset.i !== undefined) pick(Number(li.dataset.i)); else hide();
  });
}

/* ===== Tela inicial ===== */
function activeFilterCount() {
  const f = state.filters;
  return f.categories.size + f.types.size + f.brands.size + f.locations.size;
}

function matches(item) {
  const f = state.filters;
  if (state.onlyFav && !item.favorite) return false;
  if (f.categories.size && !item.categories.some(c => f.categories.has(c))) return false;
  if (f.types.size && !item.types.some(t => f.types.has(t))) return false;
  if (f.brands.size && !f.brands.has(item.brand)) return false;
  if (f.locations.size && !f.locations.has(item.location)) return false;
  const q = norm(state.query);
  if (q) {
    const hay = norm([item.name, item.brand, item.location, item.notes, ...item.categories, ...item.types].join(' '));
    if (!q.split(' ').every(word => hay.includes(word))) return false;
  }
  return true;
}

function countTab() {
  const n = state.items.length;
  return `<div class="count-tab"><b>${n}</b>${n === 1 ? 'Item' : 'Itens'}</div>`;
}

function renderHome() {
  const cats = state.lists.categories
    .map(name => ({ name, item: state.items.filter(i => i.categories.includes(name)).sort(byNewest)[0] }))
    .filter(c => c.item);

  const filterCount = activeFilterCount();
  $('#view').innerHTML = `
    <section class="band">
      ${cats.length ? `
      <div class="cat-strip">
        <div class="cat-strip-inner">
          ${cats.map(c => `
            <button type="button" class="cat ${state.filters.categories.has(c.name) ? 'on' : ''}" data-cat="${esc(c.name)}" aria-pressed="${state.filters.categories.has(c.name)}">
              <span class="cat-circle"><img src="${c.item.photo}" alt=""></span>
              <span class="cat-name">${esc(c.name)}</span>
            </button>`).join('')}
        </div>
      </div>` : ''}
      <div class="page" style="padding-bottom:0">${countTab()}</div>
    </section>
    <div class="page">
      <section class="card">
        <div class="toolbar">
          <label class="search">
            ${ICON.search}
            <input id="q" type="search" placeholder="Buscar" value="${esc(state.query)}" aria-label="Buscar">
          </label>
          <button type="button" class="icon-btn ${state.onlyFav ? 'active' : ''}" id="fav-toggle" aria-pressed="${state.onlyFav}" aria-label="Mostrar só favoritos" title="Favoritos">${ICON.heart}</button>
          <button type="button" class="icon-btn" id="filter-btn" aria-label="Filtros" title="Filtros">
            ${ICON.filter}${filterCount ? `<span class="badge">${filterCount}</span>` : ''}
          </button>
        </div>
        <p class="result-info" id="result-info" hidden></p>
        <div class="grid" id="grid"></div>
      </section>
    </div>
    <button type="button" class="fab" id="add" aria-label="Cadastrar item" title="Cadastrar item">+</button>`;

  $('#view').querySelectorAll('[data-cat]').forEach(btn => btn.addEventListener('click', () => {
    const set = state.filters.categories;
    const name = btn.dataset.cat;
    if (set.has(name)) set.delete(name); else set.add(name);
    renderHome();
  }));
  $('#q').addEventListener('input', e => { state.query = e.target.value; renderGrid(); });
  $('#fav-toggle').addEventListener('click', () => { state.onlyFav = !state.onlyFav; renderHome(); });
  $('#filter-btn').addEventListener('click', openFilters);
  $('#add').addEventListener('click', () => { location.hash = '#/novo'; });

  renderGrid();
}

function renderGrid() {
  const grid = $('#grid');
  const info = $('#result-info');
  if (!state.items.length) {
    info.hidden = true;
    grid.innerHTML = `
      <div class="empty">
        <p>Nenhum item cadastrado ainda.</p>
        <button type="button" class="btn btn-primary" data-act="new">Cadastrar primeiro item</button>
        <button type="button" class="btn" data-act="samples">Ver com exemplos</button>
      </div>`;
    $('[data-act="new"]', grid).addEventListener('click', () => { location.hash = '#/novo'; });
    $('[data-act="samples"]', grid).addEventListener('click', loadSamples);
    return;
  }

  const list = state.items.filter(matches).sort(byNewest);
  const filtering = list.length !== state.items.length;
  info.hidden = !filtering;
  info.textContent = `Mostrando ${list.length} de ${plural(state.items.length, 'item', 'itens')}`;

  grid.innerHTML = list.length
    ? list.map(item => `
        <a class="tile" href="#/item/${encodeURIComponent(item.id)}" aria-label="${esc(item.name || item.categories.join(', ') || 'Item')}">
          <img src="${item.photo}" alt="" loading="lazy">
          ${item.favorite ? `<span class="tile-fav">${ICON.heart}</span>` : ''}
        </a>`).join('')
    : '<p class="empty">Nenhum item encontrado.</p>';
}

function openFilters() {
  const draft = Object.fromEntries(Object.entries(state.filters).map(([k, v]) => [k, new Set(v)]));
  const groups = [
    ['categories', 'Categoria', state.lists.categories],
    ['types', 'Tipo', state.lists.types],
    ['brands', 'Marca', distinctValues('brand')],
    ['locations', 'Localização', distinctValues('location')],
  ].filter(([, , values]) => values.length);

  const d = openDialog(`
    <div class="dlg-body">
      <div class="dlg-head"><h2>Filtros</h2><button type="button" class="icon-btn icon-btn--plain" data-close aria-label="Fechar">${ICON.close.replace('<svg', '<svg style="fill:none;stroke:currentColor;stroke-width:1.8"')}</button></div>
      ${groups.map(([key, label, values]) => `
        <h3>${label}</h3>
        <div class="chips">
          ${values.map(v => `<button type="button" class="chip ${draft[key].has(v) ? 'on' : ''}" data-key="${key}" data-v="${esc(v)}">${esc(v)}</button>`).join('')}
        </div>`).join('')}
      <div class="dlg-actions">
        <button type="button" class="btn" id="f-clear">Limpar</button>
        <button type="button" class="btn btn-primary" id="f-apply">Aplicar</button>
      </div>
    </div>`, 'dlg-wide');

  d.querySelectorAll('.chip').forEach(chip => chip.addEventListener('click', () => {
    const set = draft[chip.dataset.key];
    const v = chip.dataset.v;
    if (set.has(v)) set.delete(v); else set.add(v);
    chip.classList.toggle('on', set.has(v));
  }));
  $('#f-clear', d).addEventListener('click', () => {
    Object.values(draft).forEach(s => s.clear());
    d.querySelectorAll('.chip.on').forEach(c => c.classList.remove('on'));
  });
  $('#f-apply', d).addEventListener('click', () => {
    state.filters = draft;
    d.close();
    renderHome();
  });
}

/* ===== Tela do item ===== */
function renderItem(item) {
  const isNew = !item;
  const draft = isNew
    ? { id: uid(), photo: '', name: '', categories: [], types: [], brand: '', location: '', notes: '', height: null, width: null, depth: null, favorite: false }
    : structuredClone(item);
  let dirty = false;

  $('#view').innerHTML = `
    <div class="band band--accent"></div>
    <div class="page">
      ${countTab()}
      <section class="card card--item">
        <button type="button" class="icon-btn close-btn" id="close" aria-label="Fechar">${ICON.close}</button>
        <div class="item-layout">
          <div class="photo-col">
            <div class="photo-box" id="photo-box"></div>
            <label class="btn btn-block">${ICON.camera}<span id="photo-label"></span>
              <input type="file" accept="image/*" id="photo-input" hidden>
            </label>
          </div>
          <form class="fields" id="item-form" novalidate>
            <div class="field">
              <label class="field-label" for="name">Nome</label>
              <input id="name" class="line-input" autocomplete="off" maxlength="100" value="${esc(draft.name)}">
            </div>
            <div class="field">
              <div class="field-head"><span class="field-label">Categoria</span>${manageLink('categories')}</div>
              <div class="chips" id="cats"></div>
            </div>
            <div class="field">
              <div class="field-head"><span class="field-label">Tipo</span>${manageLink('types')}</div>
              <div class="chips" id="types"></div>
            </div>
            <div class="field">
              <div class="field-head"><label class="field-label" for="brand">Marca</label>${manageLink('brand')}</div>
              <div class="ac"><input id="brand" class="line-input" autocomplete="off" maxlength="80" value="${esc(draft.brand)}"></div>
            </div>
            <div class="field">
              <span class="field-label">Medidas (cm)</span>
              <div class="dims">
                <label>Altura<input id="height" class="line-input" inputmode="decimal" value="${formatDim(draft.height)}"></label>
                <label>Largura<input id="width" class="line-input" inputmode="decimal" value="${formatDim(draft.width)}"></label>
                <label>Profundidade<input id="depth" class="line-input" inputmode="decimal" value="${formatDim(draft.depth)}"></label>
              </div>
              <p class="error" id="dims-error" hidden>Use apenas números positivos (ex.: 12,5) ou deixe em branco.</p>
            </div>
            <div class="field">
              <div class="field-head"><label class="field-label" for="location">Localização</label>${manageLink('location')}</div>
              <div class="ac"><input id="location" class="line-input" autocomplete="off" maxlength="80" value="${esc(draft.location)}"></div>
            </div>
            <div class="field">
              <label class="field-label" for="notes">Observação</label>
              <textarea id="notes" class="line-input" rows="3" maxlength="1000">${esc(draft.notes)}</textarea>
            </div>
            <p class="error" id="form-error" hidden></p>
            <div class="item-actions">
              <button type="submit" class="btn btn-primary">${isNew ? 'Cadastrar' : 'Salvar'}</button>
              ${isNew ? '' : '<button type="button" class="btn btn-danger" id="delete">Excluir</button>'}
            </div>
          </form>
        </div>
      </section>
    </div>`;

  const form = $('#item-form');

  const renderPhoto = () => {
    $('#photo-box').innerHTML = (draft.photo
      ? `<img src="${draft.photo}" alt="Foto do item">`
      : `<label class="photo-empty" for="photo-input">${ICON.camera}<span>Toque para adicionar a foto</span></label>`)
      + `<button type="button" class="fav-float ${draft.favorite ? 'on' : ''}" id="fav" aria-pressed="${draft.favorite}" aria-label="Favorito" title="Favorito">${ICON.heart}</button>`;
    $('#photo-label').textContent = draft.photo ? 'Trocar foto' : 'Adicionar foto';
    $('#fav').addEventListener('click', toggleFav);
  };

  const toggleFav = async () => {
    draft.favorite = !draft.favorite;
    renderPhoto();
    // Em itens já salvos, o favorito vale na hora
    if (!isNew) {
      const stored = state.items.find(i => i.id === draft.id);
      await saveItem({ ...stored, favorite: draft.favorite });
    }
  };

  const renderChips = (el, key, addLabel) => {
    el.innerHTML = state.lists[key].map(v => {
      const on = draft[key].includes(v);
      return `<button type="button" class="chip ${on ? 'on' : ''}" data-v="${esc(v)}" aria-pressed="${on}">${esc(v)}</button>`;
    }).join('') + `<button type="button" class="chip chip-add" data-add>+ Nova</button>`;
    el.onclick = async e => {
      const chip = e.target.closest('.chip');
      if (!chip) return;
      if (chip.dataset.add !== undefined) {
        const name = await askText(addLabel);
        if (!name) return;
        const value = addListValue(key, name);
        await saveLists();
        if (!draft[key].includes(value)) draft[key].push(value);
      } else {
        const v = chip.dataset.v;
        draft[key] = draft[key].includes(v) ? draft[key].filter(x => x !== v) : [...draft[key], v];
      }
      dirty = true;
      renderChips(el, key, addLabel);
    };
  };

  const renderAllChips = () => {
    renderChips($('#cats'), 'categories', 'Nova categoria');
    renderChips($('#types'), 'types', 'Novo tipo');
  };

  // Mantém o formulário em dia quando um valor é renomeado ou excluído em "Gerenciar listas"
  listsChangeHandler = (sec, old, replacement) => {
    if (sec?.kind === 'list') {
      draft[sec.key] = swapValue(draft[sec.key], old, replacement);
    } else if (sec?.kind === 'text') {
      const input = $(`#${sec.key}`);
      if (norm(input.value) === norm(old)) input.value = replacement;
    }
    renderAllChips();
  };

  renderPhoto();
  renderAllChips();
  form.querySelectorAll('[data-manage]').forEach(btn => btn.addEventListener('click', () => openManageLists(btn.dataset.manage)));
  setupAutocomplete($('#brand'), () => distinctValues('brand', draft.id));
  setupAutocomplete($('#location'), () => distinctValues('location', draft.id));

  form.addEventListener('input', () => { dirty = true; });

  $('#photo-input').addEventListener('change', async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      draft.photo = await compressImage(file);
      dirty = true;
      $('#form-error').hidden = true;
      renderPhoto();
    } catch (err) {
      toast(err.message);
    }
  });

  $('#close').addEventListener('click', async () => {
    if (dirty && !(await confirmDanger('Descartar alterações?', 'As alterações feitas neste item não foram salvas.', 'Descartar'))) return;
    location.hash = '#/';
  });

  if (!isNew) {
    $('#delete').addEventListener('click', async () => {
      if (!(await confirmDanger('Excluir item?', 'Esta ação não pode ser desfeita.', 'Excluir'))) return;
      await removeItem(draft.id);
      toast('Item excluído.');
      location.hash = '#/';
    });
  }

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const error = $('#form-error');
    const dimInputs = ['height', 'width', 'depth'].map(id => $(`#${id}`));
    const dims = dimInputs.map(i => parseDim(i.value));
    dimInputs.forEach((input, i) => input.classList.toggle('invalid', Number.isNaN(dims[i])));
    const dimsBad = dims.some(Number.isNaN);
    $('#dims-error').hidden = !dimsBad;

    if (!draft.photo) {
      error.textContent = 'Adicione uma foto para salvar o item.';
      error.hidden = false;
      return;
    }
    error.hidden = true;
    if (dimsBad) return;

    [draft.height, draft.width, draft.depth] = dims;
    draft.brand = canonical($('#brand').value, distinctValues('brand', draft.id));
    draft.location = canonical($('#location').value, distinctValues('location', draft.id));
    draft.name = clean($('#name').value);
    draft.notes = $('#notes').value.trim();
    const now = new Date().toISOString();
    draft.createdAt = draft.createdAt || now;
    draft.updatedAt = now;
    delete draft.sample;

    try {
      await saveItem(draft);
    } catch (err) {
      error.textContent = `Não foi possível salvar: ${err.message}`;
      error.hidden = false;
      return;
    }
    dirty = false;
    toast(isNew ? 'Item cadastrado.' : 'Alterações salvas.');
    location.hash = '#/';
  });
}

/* ===== Gerenciar listas ===== */
// Categorias e tipos são listas próprias; marcas e localizações vêm dos itens cadastrados
const MANAGED = [
  { key: 'categories', title: 'Categorias', one: 'categoria', the: 'essa categoria', add: 'Nova categoria', kind: 'list' },
  { key: 'types', title: 'Tipos', one: 'tipo', the: 'esse tipo', add: 'Novo tipo', kind: 'list' },
  { key: 'brand', title: 'Marcas', one: 'marca', the: 'essa marca', kind: 'text', filter: 'brands' },
  { key: 'location', title: 'Localizações', one: 'localização', the: 'essa localização', kind: 'text', filter: 'locations' },
];

let listsChangeHandler = null;

function manageLink(key) {
  return `<button type="button" class="link-btn" data-manage="${key}">Gerenciar</button>`;
}

function managedValues(sec) {
  return sec.kind === 'list' ? state.lists[sec.key] : distinctValues(sec.key);
}

function itemHas(item, sec, value) {
  return sec.kind === 'list' ? item[sec.key].includes(value) : norm(item[sec.key]) === norm(value);
}

// Troca um valor de uma lista por outro; com replacement vazio, só remove
function swapValue(values, old, replacement) {
  return uniqueKeepOrder(values.flatMap(v => (v === old ? (replacement ? [replacement] : []) : [v])));
}

async function replaceInItems(sec, old, replacement) {
  const changed = state.items.filter(it => itemHas(it, sec, old));
  const now = new Date().toISOString();
  changed.forEach(it => {
    it[sec.key] = sec.kind === 'list' ? swapValue(it[sec.key], old, replacement) : replacement;
    it.updatedAt = now;
  });
  const filterSet = state.filters[sec.filter || sec.key];
  if (filterSet.delete(old) && replacement) filterSet.add(replacement);
  await db.putMany('items', changed);
}

function openManageLists(focusKey) {
  const d = openDialog(`
    <div class="dlg-body">
      <div class="dlg-head"><h2>Gerenciar listas</h2><button type="button" class="btn" data-close>Fechar</button></div>
      <div id="ml"></div>
    </div>`, 'dlg-wide');
  d.addEventListener('close', refreshHome);

  const render = () => {
    $('#ml', d).innerHTML = MANAGED.map(sec => {
      const values = managedValues(sec);
      return `
        <h3 id="ml-${sec.key}">${sec.title}</h3>
        ${sec.kind === 'text' ? '<p class="ml-hint">Valores já usados nos itens. Excluir apaga o valor desses itens.</p>' : ''}
        ${values.length ? `
        <ul class="ml-list">
          ${values.map((v, i) => `
            <li>
              <span>${esc(v)}</span>
              <small>${plural(state.items.filter(it => itemHas(it, sec, v)).length, 'item', 'itens')}</small>
              <button type="button" class="btn" data-act="rename" data-key="${sec.key}" data-i="${i}">Renomear</button>
              <button type="button" class="btn btn-danger" data-act="delete" data-key="${sec.key}" data-i="${i}">Excluir</button>
            </li>`).join('')}
        </ul>` : '<p class="ml-hint">Nada cadastrado ainda.</p>'}
        ${sec.kind === 'list' ? `<button type="button" class="btn ml-add" data-act="add" data-key="${sec.key}">+ Adicionar</button>` : ''}`;
    }).join('');
  };

  $('#ml', d).addEventListener('click', async e => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const sec = MANAGED.find(s => s.key === btn.dataset.key);
    const values = managedValues(sec);
    const old = values[Number(btn.dataset.i)];
    const notify = (...args) => listsChangeHandler?.(sec, ...args);

    if (btn.dataset.act === 'add') {
      const name = await askText(sec.add);
      if (!name) return;
      addListValue(sec.key, name);
      await saveLists();
      notify();
    }

    if (btn.dataset.act === 'rename') {
      const name = await askText(`Renomear ${sec.one}`, old);
      if (!name || name === old) return;
      const dup = values.find(v => v !== old && norm(v) === norm(name));
      const replacement = dup || name;
      if (sec.kind === 'list') {
        const list = state.lists[sec.key];
        const i = list.indexOf(old);
        if (dup) list.splice(i, 1); else list[i] = name;
        await saveLists();
      }
      await replaceInItems(sec, old, replacement);
      notify(old, replacement);
    }

    if (btn.dataset.act === 'delete') {
      const used = state.items.filter(it => itemHas(it, sec, old)).length;
      const msg = used
        ? `“${old}” está em ${plural(used, 'item', 'itens')}. Os itens continuam cadastrados, só perdem ${sec.the}.`
        : `“${old}” não está em nenhum item.`;
      if (!(await confirmDanger(`Excluir ${sec.one}?`, msg, 'Excluir'))) return;
      if (sec.kind === 'list') {
        state.lists[sec.key].splice(state.lists[sec.key].indexOf(old), 1);
        await saveLists();
      }
      await replaceInItems(sec, old, '');
      notify(old, '');
    }
    render();
  });

  render();
  if (focusKey) $(`#ml-${focusKey}`, d)?.scrollIntoView({ block: 'start' });
}

/* ===== Exportar / Importar ===== */
function exportData() {
  const data = {
    app: EXPORT_TAG,
    version: 1,
    exportedAt: new Date().toISOString(),
    lists: state.lists,
    items: state.items,
  };
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `acervo-festivo-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast(`Exportados ${plural(state.items.length, 'item', 'itens')}.`);
}

async function importData(file) {
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    return toast('Arquivo inválido: não é um JSON.');
  }
  if (!data || data.app !== EXPORT_TAG || !Array.isArray(data.items)) {
    return toast('Este arquivo não é uma exportação do app.');
  }
  const incoming = data.items.map(normalizeItem).filter(Boolean);
  const strs = a => Array.isArray(a) ? a.filter(x => typeof x === 'string').map(clean).filter(Boolean) : [];
  const lists = { categories: strs(data.lists?.categories), types: strs(data.lists?.types) };

  const mode = state.items.length
    ? await choose('Importar dados', `O arquivo tem ${plural(incoming.length, 'item', 'itens')}. Você já tem ${plural(state.items.length, 'item', 'itens')} neste aparelho.`, [
        { value: 'cancel', label: 'Cancelar' },
        { value: 'replace', label: 'Substituir tudo', cls: 'btn-danger' },
        { value: 'merge', label: 'Mesclar', cls: 'btn-primary' },
      ])
    : 'replace';
  if (mode === 'cancel') return;

  try {
    if (mode === 'replace') {
      await db.clear('items');
      state.items = incoming;
      state.lists = {
        categories: uniqueKeepOrder(lists.categories.length ? lists.categories : DEFAULT_CATEGORIES),
        types: uniqueKeepOrder(lists.types.length ? lists.types : DEFAULT_TYPES),
      };
    } else {
      // Mesclar: itens novos entram; no mesmo item, fica a versão mais recente
      const byId = new Map(state.items.map(i => [i.id, i]));
      for (const it of incoming) {
        const cur = byId.get(it.id);
        if (!cur || it.updatedAt > cur.updatedAt) byId.set(it.id, it);
      }
      state.items = [...byId.values()];
      lists.categories.forEach(v => addListValue('categories', v));
      lists.types.forEach(v => addListValue('types', v));
    }
    syncListsWithItems();
    await db.putMany('items', state.items);
    await saveLists();
  } catch (err) {
    return toast(`Erro ao importar: ${err.message}`);
  }
  state.filters = { categories: new Set(), types: new Set(), brands: new Set(), locations: new Set() };
  toast(`Importação concluída: ${plural(state.items.length, 'item', 'itens')} no total.`);
  location.hash = '#/';
  route();
}

/* ===== Itens de exemplo ===== */
const SAMPLES = [
  ['Topo de bolo', '🎂', '#ffd9e2', ['Aniversário'], ['Para pendurar'], 'Festas & Cia', 'Armário do corredor', 30, 40, null],
  ['Balões coloridos', '🎈', '#dff1ff', ['Aniversário'], ['Para pendurar'], 'Festas & Cia', 'Armário do corredor', null, null, null],
  ['Coelho sorridente', '🐰', '#fff3c9', ['Páscoa'], ['Impressão 3D'], 'Feito em casa', 'Caixa azul', 12, 7, 5],
  ['Toalha de ovos', '🥚', '#e9f7df', ['Páscoa'], ['Toalha de mesa'], 'Tok&Stok', 'Gaveta da sala', null, 140, 220],
  ['Milho de pendurar', '🌽', '#fff0d1', ['Festa Junina'], ['Para pendurar'], 'Loja do bairro', 'Caixa azul', null, null, null],
  ['Toalha da fogueira', '🔥', '#ffe2cc', ['Festa Junina'], ['Toalha de mesa'], 'Tok&Stok', 'Gaveta da sala', null, 150, 150],
  ['Abóbora 3D', '🎃', '#ffe0c2', ['Halloween'], ['Impressão 3D'], 'Feito em casa', 'Prateleira da garagem', 15, 18, 18],
  ['Fantasminha', '👻', '#ece6ff', ['Halloween'], ['Para pendurar'], 'Festas & Cia', 'Prateleira da garagem', 25, 20, null],
  ['Árvore de Natal 3D', '🎄', '#dcf2e3', ['Natal'], ['Impressão 3D'], 'Feito em casa', 'Caixa vermelha', 22, 14, 14],
  ['Estrela dourada', '⭐', '#fff5c4', ['Natal'], ['Para pendurar'], 'Loja do bairro', 'Caixa vermelha', 10, 10, 1.5],
  ['Toalha do Papai Noel', '🎅', '#ffdcdc', ['Natal'], ['Toalha de mesa'], 'Tok&Stok', 'Gaveta da sala', null, 160, 260],
  ['Trevo da sorte', '☘️', '#dff5df', ["St. Patrick's"], ['Para pendurar', 'Impressão 3D'], 'Feito em casa', 'Caixa azul', 8, 8, 2],
];

function sampleImage(emoji, bg) {
  const c = document.createElement('canvas');
  c.width = 600;
  c.height = 800;
  const ctx = c.getContext('2d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 600, 800);
  ctx.font = '300px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(emoji, 300, 420);
  return c.toDataURL('image/jpeg', 0.85);
}

async function loadSamples() {
  const base = Date.now();
  const items = SAMPLES.map(([name, emoji, bg, categories, types, brand, loc, height, width, depth], i) => {
    const stamp = new Date(base - i * 1000).toISOString();
    return {
      id: uid(), photo: sampleImage(emoji, bg), name, categories, types,
      brand: canonical(brand, distinctValues('brand')), location: canonical(loc, distinctValues('location')),
      height, width, depth, favorite: i % 5 === 0, sample: true, createdAt: stamp, updatedAt: stamp,
    };
  });
  state.items.push(...items);
  syncListsWithItems();
  await db.putMany('items', items);
  await saveLists();
  toast(`${items.length} itens de exemplo adicionados.`);
  refreshHome();
}

async function clearSamples() {
  const samples = state.items.filter(i => i.sample);
  if (!samples.length) return toast('Não há itens de exemplo.');
  if (!(await confirmDanger('Remover exemplos?', `Serão removidos ${plural(samples.length, 'item', 'itens')} de exemplo. Seus itens não são afetados.`, 'Remover'))) return;
  await db.run('items', 'readwrite', s => { samples.forEach(i => s.delete(i.id)); });
  state.items = state.items.filter(i => !i.sample);
  toast('Exemplos removidos.');
  route();
}

/* ===== Menu ===== */
function closeMenu() {
  $('#menu').hidden = true;
  $('#menu-btn').setAttribute('aria-expanded', 'false');
}

function setupMenu() {
  const menu = $('#menu');
  const btn = $('#menu-btn');
  btn.addEventListener('click', e => {
    e.stopPropagation();
    menu.hidden = !menu.hidden;
    btn.setAttribute('aria-expanded', String(!menu.hidden));
    $('[data-menu="clear-samples"]', menu).hidden = !state.items.some(i => i.sample);
  });
  document.addEventListener('click', e => { if (!menu.contains(e.target)) closeMenu(); });
  menu.addEventListener('click', e => {
    const action = e.target.closest('[data-menu]')?.dataset.menu;
    if (!action) return;
    closeMenu();
    if (action === 'export') exportData();
    if (action === 'import') $('#import-input').click();
    if (action === 'lists') openManageLists();
    if (action === 'samples') loadSamples();
    if (action === 'clear-samples') clearSamples();
  });
  $('#import-input').addEventListener('change', e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (file) importData(file);
  });
}

/* ===== Navegação ===== */
let currentView = '';

// Atualiza a tela inicial sem perder edições em andamento na tela do item
function refreshHome() {
  if (currentView === '/') renderHome();
}

function route() {
  const hash = location.hash.replace(/^#/, '') || '/';
  closeMenu();
  if (currentView === '/') state.homeScroll = window.scrollY;
  listsChangeHandler = null;

  if (hash === '/novo') {
    currentView = hash;
    renderItem(null);
    window.scrollTo(0, 0);
    return;
  }
  const m = hash.match(/^\/item\/(.+)$/);
  if (m) {
    const item = state.items.find(i => i.id === decodeURIComponent(m[1]));
    if (item) {
      currentView = hash;
      renderItem(item);
      window.scrollTo(0, 0);
      return;
    }
    location.replace('#/');
  }
  const wasHome = currentView === '/';
  currentView = '/';
  renderHome();
  if (!wasHome) window.scrollTo(0, state.homeScroll);
}

/* ===== Início ===== */
async function init() {
  document.title = APP_NAME;
  document.querySelectorAll('[data-app-name]').forEach(el => { el.textContent = APP_NAME; });
  setupMenu();
  try {
    const [items, lists] = await Promise.all([db.getAll('items'), db.get('meta', 'lists')]);
    state.items = items.map(normalizeItem).filter(Boolean);
    state.lists = lists
      ? { categories: lists.categories || [], types: lists.types || [] }
      : { categories: [...DEFAULT_CATEGORIES], types: [...DEFAULT_TYPES] };
    syncListsWithItems();
    if (!lists) await saveLists();
  } catch (err) {
    $('#view').innerHTML = `<div class="page"><p class="empty">Não foi possível abrir o armazenamento do navegador (${esc(err.message)}). Tente abrir o app por um endereço http:// ou https://, fora da navegação anônima.</p></div>`;
    return;
  }
  window.addEventListener('hashchange', route);
  route();
}

init();
