(() => {
  const cities = [
    'Aurora Continental', 'Porto das Ferrovias', 'Vale de Ferro', 'Serra do Cobre', 'Nova Estação',
    'Vila dos Trilhos', 'Rio de Carvão', 'Campo de Redstone', 'Santa Mina', 'Baía Central',
  ];
  const types = ['Pagamento municipal', 'Receita tributária', 'Serviço público', 'Repasse governamental'];
  const players = ['LiaMoraes', 'CaioTrilhos', 'NinaVale', 'TheoCobre', 'BiaRedstone', 'RafaPorto', 'IvoAurora'];
  const now = new Date();
  const transactions = Array.from({ length: 48 }, (_, index) => {
    const city = cities[(index * 7 + 2) % cities.length];
    const day = new Date(now);
    day.setDate(day.getDate() - ((index * 3) % 14));
    day.setHours(8 + (index * 5) % 13, (index * 17) % 60, 0, 0);
    const government = `Prefeitura de ${city}`;
    const participant = players[index % players.length];
    return {
      id: `DOCS-DEMO-${String(index + 1).padStart(5, '0')}`,
      city,
      type: types[index % types.length],
      from: index % 2 === 0 ? government : participant,
      to: index % 2 === 0 ? participant : government,
      amount: ((index * 173 + 240) % 4800) + 35,
      createdAt: day,
    };
  });

  const form = document.getElementById('filters');
  const search = document.getElementById('search');
  const city = document.getElementById('city');
  const type = document.getElementById('type');
  const from = document.getElementById('from');
  const to = document.getElementById('to');
  const rows = document.getElementById('transactionRows');
  const empty = document.getElementById('emptyState');
  const formatter = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  for (const name of cities) city.add(new Option(name, name));
  for (const name of types) type.add(new Option(name, name));

  const params = new URLSearchParams(location.search);
  search.value = params.get('q') || '';
  city.value = params.get('cidade') || '';
  type.value = params.get('tipo') || '';
  from.value = params.get('de') || '';
  to.value = params.get('ate') || '';

  function formatMoney(value) {
    return `${formatter.format(value)} EC$`;
  }

  function formatDate(value) {
    return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(value);
  }

  function syncUrl() {
    const next = new URLSearchParams();
    if (search.value.trim()) next.set('q', search.value.trim());
    if (city.value) next.set('cidade', city.value);
    if (type.value) next.set('tipo', type.value);
    if (from.value) next.set('de', from.value);
    if (to.value) next.set('ate', to.value);
    const query = next.toString();
    history.replaceState(null, '', `${location.pathname}${query ? `?${query}` : ''}`);
  }

  function getFilteredTransactions() {
    const query = search.value.trim().toLocaleLowerCase('pt-BR');
    const startDate = from.value ? new Date(`${from.value}T00:00:00`) : null;
    const endDate = to.value ? new Date(`${to.value}T23:59:59.999`) : null;
    return transactions.filter((item) => {
      const matchesQuery = !query || [item.id, item.city, item.type, item.from, item.to].some((value) => value.toLocaleLowerCase('pt-BR').includes(query));
      return matchesQuery
        && (!city.value || item.city === city.value)
        && (!type.value || item.type === type.value)
        && (!startDate || item.createdAt >= startDate)
        && (!endDate || item.createdAt <= endDate);
    });
  }

  function appendCell(row, value, className = '') {
    const cell = document.createElement('td');
    if (className) cell.className = className;
    cell.textContent = value;
    row.appendChild(cell);
  }

  function renderChart(filtered) {
    const counts = new Map(cities.map((name) => [name, 0]));
    filtered.forEach((item) => counts.set(item.city, counts.get(item.city) + 1));
    const maximum = Math.max(1, ...counts.values());
    const chart = document.getElementById('cityChart');
    chart.replaceChildren();
    for (const [name, count] of counts) {
      const item = document.createElement('div');
      item.className = 'city-bar';
      const head = document.createElement('div');
      head.className = 'city-bar-head';
      const label = document.createElement('span');
      label.textContent = name;
      const value = document.createElement('strong');
      value.textContent = String(count).padStart(2, '0');
      head.append(label, value);
      const track = document.createElement('div');
      track.className = 'city-bar-track';
      const fill = document.createElement('div');
      fill.className = 'city-bar-fill';
      fill.style.width = `${(count / maximum) * 100}%`;
      track.appendChild(fill);
      item.append(head, track);
      chart.appendChild(item);
    }
  }

  function render() {
    const filtered = getFilteredTransactions();
    const volume = filtered.reduce((sum, item) => sum + item.amount, 0);
    const activeCities = new Set(filtered.map((item) => item.city));
    document.getElementById('totalVolume').textContent = formatMoney(volume);
    document.getElementById('totalCount').textContent = filtered.length.toLocaleString('pt-BR');
    const cityCount = document.getElementById('cityCount');
    cityCount.replaceChildren(document.createTextNode(String(activeCities.size)));
    const cityLabel = document.createElement('small');
    cityLabel.textContent = ' / 10';
    cityCount.appendChild(cityLabel);
    document.getElementById('resultCount').textContent = `${filtered.length} resultados`;
    document.getElementById('chartCaption').textContent = `${activeCities.size} CIDADES NO RECORTE`;
    rows.replaceChildren();
    empty.hidden = filtered.length !== 0;

    for (const item of filtered) {
      const row = document.createElement('tr');
      appendCell(row, formatDate(item.createdAt), 'transaction-time');
      appendCell(row, item.city);
      appendCell(row, item.type, 'transaction-type');
      appendCell(row, item.from);
      appendCell(row, item.to);
      appendCell(row, formatMoney(item.amount), 'transaction-amount');
      appendCell(row, item.id, 'transaction-id');
      rows.appendChild(row);
    }
    renderChart(filtered);
    syncUrl();
  }

  form.addEventListener('input', render);
  form.addEventListener('change', render);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    render();
  });
  document.getElementById('clearFilters').addEventListener('click', () => {
    form.reset();
    render();
  });
  render();
})();