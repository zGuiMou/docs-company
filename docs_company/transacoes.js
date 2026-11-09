const API_BASE = location.hostname === 'localhost' && location.port !== '3000' ? 'http://localhost:3000' : '';
const apiUrl = path => `${API_BASE}${path}`;
const state = { transactions: [], cities: [], isAdmin: false };
const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const dateFormatter = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeZone: 'UTC' });
const form = document.getElementById('transactionForm');
const rows = document.getElementById('transactionRows');
const feedback = document.getElementById('adminFeedback');

async function request(path, options = {}) {
  const response = await fetch(apiUrl(path), { credentials: 'include', ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Não foi possível concluir a solicitação.');
  return data;
}

function localDateValue() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

function renderAuth(user) {
  const authArea = document.getElementById('authArea');
  if (!user) return;

  const avatar = user.avatar
    ? `https://cdn.discordapp.com/avatars/${encodeURIComponent(user.id)}/${encodeURIComponent(user.avatar)}.${user.avatar.startsWith('a_') ? 'gif' : 'png'}?size=64`
    : '';
  const pill = document.createElement('div');
  pill.className = 'user-pill';
  if (avatar) {
    const image = document.createElement('img');
    image.className = 'user-avatar';
    image.src = avatar;
    image.alt = '';
    pill.append(image);
  } else {
    const initials = document.createElement('span');
    initials.className = 'user-avatar initials';
    initials.textContent = (user.username || 'U').slice(0, 1).toUpperCase();
    pill.append(initials);
  }
  const name = document.createElement('span');
  name.className = 'user-name';
  name.textContent = user.username || 'Usuário';
  const logout = document.createElement('a');
  logout.className = 'logout-link';
  logout.href = 'http://localhost:3000/auth/logout';
  logout.textContent = 'Sair';
  pill.append(name, logout);
  authArea.replaceChildren(pill);
}

function populateCities() {
  const citySelect = document.getElementById('transactionCity');
  const cityFilter = document.getElementById('cityFilter');
  for (const city of state.cities) {
    const option = document.createElement('option');
    option.value = city.name;
    option.textContent = city.name;
    citySelect.append(option);

    const filterOption = option.cloneNode(true);
    cityFilter.append(filterOption);
  }
}

function renderCities() {
  const roster = document.getElementById('cityRoster');
  const fragment = document.createDocumentFragment();
  for (const city of state.cities) {
    const item = document.createElement('div');
    item.className = 'city-row';
    const avatar = document.createElement('span');
    avatar.className = 'mayor-avatar';
    avatar.setAttribute('aria-label', 'Prefeito não eleito');
    avatar.textContent = '?';
    const identity = document.createElement('span');
    identity.className = 'city-name';
    const name = document.createElement('strong');
    name.textContent = city.name;
    const mayor = document.createElement('small');
    mayor.textContent = city.mayor || 'Não Eleito';
    identity.append(name, mayor);
    item.append(avatar, identity);
    fragment.append(item);
  }
  roster.replaceChildren(fragment);
}

function filteredTransactions() {
  const query = document.getElementById('searchInput').value.trim().toLocaleLowerCase('pt-BR');
  const city = document.getElementById('cityFilter').value;
  const type = document.getElementById('typeFilter').value;
  return state.transactions.filter(transaction => {
    const matchesText = !query || `${transaction.description} ${transaction.counterparty}`.toLocaleLowerCase('pt-BR').includes(query);
    return matchesText && (!city || transaction.city === city) && (!type || transaction.type === type);
  });
}

function renderSummary() {
  const income = state.transactions.filter(item => item.type === 'Receita').reduce((sum, item) => sum + item.amount, 0);
  const expense = state.transactions.filter(item => item.type === 'Despesa').reduce((sum, item) => sum + item.amount, 0);
  document.getElementById('metricCount').textContent = String(state.transactions.length);
  document.getElementById('metricIncome').textContent = currency.format(income);
  document.getElementById('metricExpense').textContent = currency.format(expense);
}

function addCell(row, value, className = '') {
  const cell = document.createElement('td');
  if (className) cell.className = className;
  cell.textContent = value;
  row.append(cell);
  return cell;
}

function renderTransactions() {
  const visible = filteredTransactions();
  const fragment = document.createDocumentFragment();
  document.getElementById('recordsCount').textContent = `${visible.length} ${visible.length === 1 ? 'registro' : 'registros'}`;
  document.getElementById('actionsHeading').hidden = !state.isAdmin;

  if (!visible.length) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.className = 'table-message';
    cell.colSpan = state.isAdmin ? 7 : 6;
    cell.textContent = state.transactions.length ? 'Nenhuma transação corresponde aos filtros.' : 'Ainda não há transações cadastradas.';
    row.append(cell);
    fragment.append(row);
  }

  for (const transaction of visible) {
    const row = document.createElement('tr');
    addCell(row, dateFormatter.format(new Date(`${transaction.date}T00:00:00Z`)));
    addCell(row, transaction.city);
    const movement = addCell(row, transaction.type, `movement ${transaction.type === 'Receita' ? 'income' : 'expense'}`);
    movement.setAttribute('aria-label', transaction.type);
    addCell(row, transaction.description);
    addCell(row, transaction.counterparty || '—');
    addCell(row, currency.format(transaction.amount), `amount-cell ${transaction.type === 'Receita' ? 'income' : 'expense'}`);

    if (state.isAdmin) {
      const actions = document.createElement('td');
      const group = document.createElement('div');
      group.className = 'row-actions';
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.dataset.action = 'edit';
      edit.dataset.id = transaction.id;
      edit.textContent = 'Editar';
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'delete-button';
      remove.dataset.action = 'delete';
      remove.dataset.id = transaction.id;
      remove.textContent = 'Remover';
      group.append(edit, remove);
      actions.append(group);
      row.append(actions);
    }
    fragment.append(row);
  }
  rows.replaceChildren(fragment);
  renderSummary();
}

function setFeedback(message, error = false) {
  feedback.textContent = message;
  feedback.classList.toggle('error', error);
}

function resetForm() {
  form.reset();
  document.getElementById('transactionId').value = '';
  document.getElementById('transactionDate').value = localDateValue();
  document.getElementById('saveTransaction').textContent = 'Adicionar transação';
  document.getElementById('cancelEdit').hidden = true;
}

function beginEdit(transaction) {
  document.getElementById('transactionId').value = transaction.id;
  document.getElementById('transactionDate').value = transaction.date;
  document.getElementById('transactionCity').value = transaction.city;
  document.getElementById('transactionType').value = transaction.type;
  document.getElementById('transactionAmount').value = transaction.amount;
  document.getElementById('transactionDescription').value = transaction.description;
  document.getElementById('transactionCounterparty').value = transaction.counterparty || '';
  document.getElementById('saveTransaction').textContent = 'Salvar alterações';
  document.getElementById('cancelEdit').hidden = false;
  setFeedback(`Editando transação de ${transaction.city}.`);
  document.getElementById('adminTitle').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  const id = document.getElementById('transactionId').value;
  const payload = {
    date: document.getElementById('transactionDate').value,
    city: document.getElementById('transactionCity').value,
    type: document.getElementById('transactionType').value,
    amount: Number(document.getElementById('transactionAmount').value),
    description: document.getElementById('transactionDescription').value,
    counterparty: document.getElementById('transactionCounterparty').value,
  };
  const button = document.getElementById('saveTransaction');
  button.disabled = true;
  try {
    await request(id ? `/api/transacoes/${encodeURIComponent(id)}` : '/api/transacoes', {
      method: id ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    resetForm();
    setFeedback(id ? 'Transação atualizada.' : 'Transação adicionada.');
    await loadTransactions();
  } catch (error) {
    setFeedback(error.message, true);
  } finally {
    button.disabled = false;
  }
});

document.getElementById('cancelEdit').addEventListener('click', () => {
  resetForm();
  setFeedback('Edição cancelada.');
});

rows.addEventListener('click', async event => {
  const button = event.target.closest('button[data-action]');
  if (!button || !state.isAdmin) return;
  const transaction = state.transactions.find(item => item.id === button.dataset.id);
  if (!transaction) return;
  if (button.dataset.action === 'edit') {
    beginEdit(transaction);
    return;
  }
  if (!window.confirm(`Remover a transação de ${transaction.city}?`)) return;
  button.disabled = true;
  try {
    await request(`/api/transacoes/${encodeURIComponent(transaction.id)}`, { method: 'DELETE' });
    if (document.getElementById('transactionId').value === transaction.id) resetForm();
    setFeedback('Transação removida.');
    await loadTransactions();
  } catch (error) {
    setFeedback(error.message, true);
  } finally {
    button.disabled = false;
  }
});

async function loadTransactions() {
  const data = await request('/api/transacoes', { cache: 'no-store' });
  state.transactions = Array.isArray(data.transactions) ? data.transactions : [];
  if (Array.isArray(data.cities) && data.cities.length) {
    state.cities = data.cities;
    document.getElementById('transactionCity').replaceChildren();
    document.getElementById('cityFilter').replaceChildren(new Option('Todas as cidades', ''));
    populateCities();
    renderCities();
  }
  document.getElementById('loadError').hidden = true;
  renderTransactions();
}

async function start() {
  try {
    const auth = await request('/auth/me', { cache: 'no-store' });
    renderAuth(auth.user);
    state.isAdmin = Boolean(auth.isAdmin);
    if (state.isAdmin) {
      document.getElementById('adminWorkspace').hidden = false;
      document.getElementById('transactionDate').value = localDateValue();
    }
    await loadTransactions();
  } catch (error) {
    const message = document.getElementById('loadError');
    message.textContent = `Não foi possível carregar as transações: ${error.message}`;
    message.hidden = false;
    rows.replaceChildren();
  }
}

for (const control of ['searchInput', 'cityFilter', 'typeFilter']) {
  document.getElementById(control).addEventListener('input', renderTransactions);
  document.getElementById(control).addEventListener('change', renderTransactions);
}

start();
