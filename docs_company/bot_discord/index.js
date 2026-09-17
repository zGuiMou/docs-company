const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  ModalBuilder,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const fs = require('node:fs/promises');
const path = require('node:path');

const apiUrl = (process.env.SITE_API_URL || 'http://localhost:3000').replace(/\/$/, '');
const apiKey = process.env.BOT_API_KEY;
const token = process.env.DISCORD_TOKEN;
const rulesChannelId = process.env.RULES_CHANNEL_ID || '1549529444987834509';
const rulesImageUrl = process.env.RULES_IMAGE_URL || 'https://i.imgur.com/raDRCcV.png';
const developmentChannelId = process.env.DEVELOPMENT_CHANNEL_ID || '1550243018122989678';
const faqChannelId = process.env.FAQ_CHANNEL_ID || '1550243118287159346';
const rulesStateFile = path.join(__dirname, 'data', 'rules-state.json');
const rulesVersion = 2;

if (!token || !apiKey) {
  console.error('Defina DISCORD_TOKEN e BOT_API_KEY antes de iniciar o bot.');
  process.exit(1);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const listingFilters = new Map();
const entityCache = { values: [], refreshedAt: 0, refreshPromise: null };

const statusChoices = [
  { name: 'Aberta', value: 'ABERTA' },
  { name: 'Em andamento', value: 'ANDAMENTO' },
  { name: 'Encerrada', value: 'ENCERRADA' },
];
const entityTypeChoices = [
  { name: 'Big Techs', value: 'BIG_TECH' },
  { name: 'Prefeituras', value: 'PREFEITURA' },
  { name: 'Empresas', value: 'EMPRESA' },
];

const commands = [
  new SlashCommandBuilder()
    .setName('licitacao')
    .setDescription('Consulta e administra as licitações do site.')
    .addSubcommand((subcommand) =>
      subcommand
        .setName('criar')
        .setDescription('Cria uma licitação no site. Administradores apenas.')
        .addStringOption((option) => option.setName('titulo').setDescription('Título.').setMaxLength(160).setRequired(true))
        .addNumberOption((option) => option.setName('valor').setDescription('Valor estimado em R$.').setMinValue(0).setRequired(true))
        .addStringOption((option) => option.setName('prazo').setDescription('Prazo no formato DD/MM/AAAA.').setMaxLength(10))
        .addStringOption((option) => option.setName('descricao').setDescription('Descrição.').setMaxLength(1000))
        .addStringOption((option) => option.setName('status').setDescription('Status inicial.').addChoices(...statusChoices)),
    )
    .addSubcommand((subcommand) => subcommand.setName('listar').setDescription('Lista as licitações do site.')
      .addStringOption((option) => option.setName('status').setDescription('Filtrar por status.').addChoices(...statusChoices))
      .addStringOption((option) => option.setName('categoria').setDescription('Tipo de entidade.').addChoices(...entityTypeChoices))
      .addStringOption((option) => option.setName('entidade').setDescription('Filtrar por entidade.').setAutocomplete(true)))
    .addSubcommand((subcommand) =>
      subcommand.setName('ver').setDescription('Mostra uma licitação.').addStringOption((option) => option.setName('id').setDescription('Número, ex.: 36809/2026.').setRequired(true)),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('editar')
        .setDescription('Edita uma licitação. Administradores apenas.')
        .addIntegerOption((option) => option.setName('id').setDescription('ID da licitação.').setRequired(true))
        .addStringOption((option) => option.setName('titulo').setDescription('Novo título.').setMaxLength(160))
        .addNumberOption((option) => option.setName('valor').setDescription('Novo valor em R$.').setMinValue(0))
        .addStringOption((option) => option.setName('prazo').setDescription('Novo prazo DD/MM/AAAA.').setMaxLength(10))
        .addStringOption((option) => option.setName('descricao').setDescription('Nova descrição.').setMaxLength(1000))
        .addStringOption((option) => option.setName('status').setDescription('Novo status.').addChoices(...statusChoices)),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('encerrar')
        .setDescription('Encerra uma licitação. Administradores apenas.')
        .addIntegerOption((option) => option.setName('id').setDescription('ID da licitação.').setRequired(true))
        .addStringOption((option) => option.setName('motivo').setDescription('Motivo do encerramento.').setMaxLength(1000).setRequired(true)),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('excluir')
        .setDescription('Exclui uma licitação. Administradores apenas.')
        .addIntegerOption((option) => option.setName('id').setDescription('ID da licitação.').setRequired(true)),
    ),
].map((command) => command.toJSON());

async function request(path, options = {}) {
  const response = await fetch(apiUrl + path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-Bot-Api-Key': apiKey,
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `A API do site retornou HTTP ${response.status}.`);
  return data;
}

function rulesEmbed() {
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('📜 REGRAS DA DOCS. COMPANY')
    .setDescription([
      'Bem-vindo à comunidade da Docs. Company! Este é um espaço para colaboração, oportunidades, parcerias e comunicação profissional. Para manter tudo organizado, siga estas diretrizes:',
      '',
      '**1. Mantenha o respeito e o profissionalismo**\nNão são tolerados ofensas, preconceito, assédio ou ataques pessoais.',
      '**2. Use os canais corretamente**\nCada canal tem uma finalidade. Organize suas mensagens para facilitar a comunicação de todos.',
      '**3. Evite spam e marcações desnecessárias**\nNão envie flood, mensagens repetidas ou menções em excesso.',
      '**4. Preserve informações e privacidade**\nNão compartilhe dados pessoais, informações internas ou conteúdos confidenciais sem autorização.',
      '**5. Divulgações precisam de autorização**\nNão divulgue servidores, produtos, redes sociais ou projetos externos sem aprovação da equipe.',
      '**6. Mantenha o conteúdo adequado**\nNão envie conteúdo ilegal, sexual, violento ou incompatível com o ambiente profissional.',
      '**7. Colabore com responsabilidade**\nDebates e ideias são bem-vindos quando feitos com bom senso, clareza e respeito às opiniões diferentes.',
      '**8. Respeite a equipe e as decisões da moderação**\nEm caso de dúvidas, conflitos ou problemas, procure a equipe da Docs. Company.',
    ].join('\n\n'))
    .addFields({
      name: '━━━━━━━━━━━━━━━━━━',
      value: '**O MAIS IMPORTANTE**\nAtue com respeito, responsabilidade e bom senso. O descumprimento das regras pode resultar em aviso, mute, expulsão ou banimento, dependendo da situação.\n\n**Obrigado por fazer parte da Docs. Company!**',
    })
    .setImage(rulesImageUrl);
}

function developmentEmbed() {
  return new EmbedBuilder()
    .setColor(0xf2c56d)
    .setTitle('🚧 DOCS. COMPANY EM DESENVOLVIMENTO')
    .setDescription([
      'A Docs. Company está em fase de construção e estamos formando uma equipe comprometida para desenvolver nossos projetos, serviços e oportunidades.',
      '',
      '**Estamos procurando sócios que queiram se dedicar de verdade à equipe.**',
      '',
      'A principal qualidade que buscamos é a vontade de atuar no ramo administrativo: organizar processos, acompanhar projetos, atender parceiros, ajudar na tomada de decisões e fazer a empresa crescer.',
      '',
      'Não é necessário ter experiência em tudo. Compromisso, responsabilidade, iniciativa e interesse em aprender fazem toda a diferença.',
    ].join('\n'))
    .addFields({
      name: '📩 Quer fazer parte?',
      value: 'Procure a equipe da Docs. Company para conversar sobre as oportunidades de sociedade e atuação administrativa.',
    })
    .setFooter({ text: 'Construindo a Docs. Company juntos.' });
}

const faqTopics = [
  {
    key: 'servicos',
    title: 'Quais serviços a Docs. Company oferece?',
    text: 'A Docs. Company atua no suporte administrativo e documental para empresas, parceiros e órgãos públicos. Nossos serviços podem envolver organização de documentos, orientação de processos, elaboração e acompanhamento de contratos, apoio em regularizações, gestão de demandas administrativas e intermediação de oportunidades.\n\nCada atendimento é analisado conforme a necessidade do cliente ou parceiro, buscando soluções claras, organizadas e adequadas ao projeto.',
  },
  {
    key: 'documentacao',
    title: 'Vocês cuidam da documentação de empresas?',
    text: 'Sim. A Docs. Company pode auxiliar empresas na organização, revisão e acompanhamento de documentos necessários para suas atividades. Isso inclui documentação corporativa, registros, certidões, contratos, formulários e processos administrativos.\n\nO objetivo é reduzir burocracias, manter as informações organizadas e ajudar a empresa a estar preparada para novas oportunidades, parcerias e demandas.',
  },
  {
    key: 'licitacoes',
    version: 2,
    title: 'Como funciona o sistema de licitações?',
    text: 'As licitações disponíveis são publicadas no sistema da Docs. Company com informações como entidade responsável, descrição, prazo, valor e status. Ao encontrar uma oportunidade, o interessado pode analisar os detalhes e enviar uma proposta.\n\nA proposta pode aceitar os termos apresentados ou sugerir novo valor e prazo. Também é possível incluir uma justificativa, que ajuda o contratante a entender a proposta e avaliar a participação. Depois, o contratante acompanha e decide o andamento da solicitação.',
  },
  {
    key: 'socio',
    title: 'Como posso me tornar um sócio?',
    text: 'A Docs. Company busca pessoas comprometidas que desejem contribuir ativamente com o crescimento da empresa. O principal requisito é ter interesse em atuar no ramo administrativo, colaborar com a organização, acompanhar projetos, atender parceiros e participar das decisões.\n\nExperiência é bem-vinda, mas responsabilidade, iniciativa, comunicação e disposição para aprender são essenciais. Para demonstrar interesse, procure a equipe da Docs. Company e converse sobre as oportunidades disponíveis.',
  },
];

function faqEmbed(topic) {
  return new EmbedBuilder()
    .setColor(0x5aa6ff)
    .setTitle(topic.title)
    .setDescription(topic.text)
    .setFooter({ text: 'Docs. Company • Central de dúvidas' });
}

async function publishRulesOnce(readyClient) {
  let savedState = {};
  try {
    savedState = JSON.parse(await fs.readFile(rulesStateFile, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn('Não foi possível ler o estado das regras:', error.message);
  }

  const channel = await readyClient.channels.fetch(rulesChannelId);
  if (!channel || !channel.isTextBased() || typeof channel.send !== 'function') {
    throw new Error('RULES_CHANNEL_ID não aponta para um canal de texto.');
  }
  if (savedState.messageId) {
    if (savedState.version === rulesVersion) return;
    try {
      const message = await channel.messages.fetch(savedState.messageId);
      await message.edit({ embeds: [rulesEmbed()] });
      await fs.writeFile(rulesStateFile, JSON.stringify({ ...savedState, version: rulesVersion, updatedAt: new Date().toISOString() }, null, 2), 'utf8');
      console.log('Mensagem de regras atualizada.');
      return;
    } catch (error) {
      console.warn('Não foi possível atualizar a mensagem anterior de regras:', error.message);
    }
  }
  const message = await channel.send({ embeds: [rulesEmbed()] });
  await fs.mkdir(path.dirname(rulesStateFile), { recursive: true });
  await fs.writeFile(rulesStateFile, JSON.stringify({ messageId: message.id, version: rulesVersion, publishedAt: new Date().toISOString() }, null, 2), 'utf8');
  console.log('Regras publicadas uma única vez no canal configurado.');
}

async function publishDevelopmentAnnouncementOnce(readyClient) {
  let savedState = {};
  try {
    savedState = JSON.parse(await fs.readFile(rulesStateFile, 'utf8'));
    if (savedState.developmentMessageId) return;
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn('Não foi possível ler o estado do aviso de desenvolvimento:', error.message);
  }

  const channel = await readyClient.channels.fetch(developmentChannelId);
  if (!channel || !channel.isTextBased() || typeof channel.send !== 'function') {
    throw new Error('DEVELOPMENT_CHANNEL_ID não aponta para um canal de texto.');
  }
  const message = await channel.send({ embeds: [developmentEmbed()] });
  await fs.mkdir(path.dirname(rulesStateFile), { recursive: true });
  await fs.writeFile(rulesStateFile, JSON.stringify({ ...savedState, developmentMessageId: message.id, developmentPublishedAt: new Date().toISOString() }, null, 2), 'utf8');
  console.log('Aviso de desenvolvimento publicado uma única vez no canal configurado.');
}

async function publishFaqThreadsOnce(readyClient) {
  let savedState = {};
  try {
    savedState = JSON.parse(await fs.readFile(rulesStateFile, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn('Não foi possível ler o estado dos tópicos:', error.message);
  }
  const channel = await readyClient.channels.fetch(faqChannelId);
  if (!channel) throw new Error('FAQ_CHANNEL_ID não aponta para um canal válido.');
  const faqThreads = savedState.faqThreads || {};

  for (const topic of faqTopics) {
    const currentVersion = topic.version || 1;
    const savedThread = faqThreads[topic.key];
    const savedVersion = typeof savedThread === 'object' ? savedThread.version : 1;
    if (savedThread && savedVersion === currentVersion) continue;
    let thread;
    if (channel.type === ChannelType.GuildForum) {
      thread = await channel.threads.create({ name: topic.title, message: { embeds: [faqEmbed(topic)] } });
    } else if (channel.isTextBased() && typeof channel.send === 'function') {
      const starterMessage = await channel.send({ content: `🧵 **${topic.title}**` });
      thread = await starterMessage.startThread({ name: topic.title, autoArchiveDuration: 1440 });
      await thread.send({ embeds: [faqEmbed(topic)] });
    } else {
      throw new Error('FAQ_CHANNEL_ID precisa ser um canal de fórum ou texto com suporte a threads.');
    }
    faqThreads[topic.key] = { id: thread.id, version: currentVersion };
    await fs.mkdir(path.dirname(rulesStateFile), { recursive: true });
    await fs.writeFile(rulesStateFile, JSON.stringify({ ...savedState, faqThreads }, null, 2), 'utf8');
  }
  console.log('Tópicos da central de dúvidas verificados.');
}

function formatMoney(value, valueToBeAgreed) {
  return valueToBeAgreed ? 'A combinar' : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value || 0);
}

function statusColor(status) {
  if (status === 'ENCERRADA') return 0xed4245;
  if (status === 'ANDAMENTO') return 0xfee75c;
  return 0x57f287;
}

function formatDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  return match ? `${match[3]}/${match[2]}/${match[1]}` : 'Não informado';
}

function contractEmbed(contract, proposals = []) {
  return new EmbedBuilder()
    .setColor(statusColor(contract.status))
    .setTitle(contract.title)
    .addFields(
      { name: 'Referência interna', value: String(contract.id), inline: true },
      { name: 'Número da licitação', value: contract.bidNumber || contract.code || '-', inline: true },
      { name: 'Status', value: contract.status || 'ABERTA', inline: true },
      { name: 'Valor', value: formatMoney(contract.value, contract.valueToBeAgreed), inline: true },
      { name: 'Prazo', value: formatDate(contract.deadline), inline: true },
      { name: 'Órgão', value: contract.orgao || 'Docs Company', inline: true },
      { name: 'Descrição', value: (contract.description || 'Sem descrição.').slice(0, 1000) },
      { name: 'Comentários', value: commentsForEmbed(proposals) },
    )
    .setFooter({ text: 'Dados sincronizados com o site.' });
}

function listingEmbed(contract, position) {
  return new EmbedBuilder()
    .setColor(0xFEE75C)
    .setAuthor({ name: contract.orgao || 'Docs Company' })
    .setTitle((position + 1) + 'ª LICITAÇÃO • #' + contract.id)
    .setDescription('**' + contract.title + '**' + (contract.description ? '\n\n' + contract.description.slice(0, 900) : ''))
    .addFields(
      { name: 'Status', value: contract.status || 'ABERTA', inline: true },
      { name: 'Valor', value: formatMoney(contract.value, contract.valueToBeAgreed), inline: true },
      { name: 'Prazo', value: formatDate(contract.deadline), inline: true },
    )
    .setFooter({ text: 'Licitação ' + (position + 1) + ' de ' + position.total + ' • Dados sincronizados com o site.' });
}
function commentsForEmbed(proposals) {
  const comments = proposals
    .filter((proposal) => proposal.message && proposal.message.trim())
    .map((proposal) => {
      const author = proposal.user && proposal.user.username ? proposal.user.username : 'Usuário';
      const message = proposal.message.trim().replace(/\s+/g, ' ').replace(/@/g, '@\u200b');
      return `**${author}:** ${message}`;
    });
  if (!comments.length) return 'Sem comentários.';
  const text = comments.join('\n');
  return text.length > 1_020 ? `${text.slice(0, 1_017)}…` : text;
}

function pageEmbed(contract, page, total, proposals = []) {
  const embed = new EmbedBuilder()
    .setColor(statusColor(contract.status))
    .setAuthor({ name: contract.orgao || 'Docs Company' })
    .setTitle((page + 1) + 'ª LICITAÇÃO • ' + (contract.bidNumber || ('#' + contract.id)))
    .setDescription('**' + contract.title + '**' + (contract.description ? '\n\n' + contract.description.slice(0, 900) : ''))
    .addFields(
      { name: 'Status', value: contract.status || 'ABERTA', inline: true },
      { name: 'Valor', value: formatMoney(contract.value, contract.valueToBeAgreed), inline: true },
      { name: 'Prazo', value: formatDate(contract.deadline), inline: true },
      { name: 'Comentários', value: commentsForEmbed(proposals) },
    )
    .setFooter({ text: 'Página ' + (page + 1) + ' de ' + total + ' • Dados sincronizados com o site.' });
  if (contract.companyLogo) embed.setThumbnail(contract.companyLogo);
  return embed;
}
async function pageEmbedWithComments(contract, page, total) {
  const proposalData = await request('/api/bot/contratos/' + encodeURIComponent(contract.id) + '/propostas');
  return pageEmbed(contract, page, total, proposalData.proposals || []);
}
function createListingFilter(entity, status, category) {
  const token = Math.random().toString(36).slice(2, 12);
  listingFilters.set(token, { entity, status, category });
  return token;
}

function normalizeEntity(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
}

function entityTypeForName(name) {
  const entity = entityCache.values.find((item) => normalizeEntity(item.name) === normalizeEntity(name));
  return entity ? entity.type : 'EMPRESA';
}

async function refreshEntityCache() {
  if (entityCache.refreshPromise) return entityCache.refreshPromise;
  entityCache.refreshPromise = Promise.allSettled([
    request('/api/bot/entidades'),
    request('/api/empresas/ranking'),
    request('/api/bot/contratos'),
  ]).then(([entitiesResult, companiesResult, contractsResult]) => {
    const entities = new Map();
    if (entitiesResult.status === 'fulfilled') {
      (entitiesResult.value.entities || []).forEach((entity) => {
        if (entity) entities.set(normalizeEntity(entity), { name: entity, type: 'EMPRESA' });
      });
    }
    if (companiesResult.status === 'fulfilled') {
      (companiesResult.value.companies || []).forEach((company) => {
        if (company.name) entities.set(normalizeEntity(company.name), { name: company.name, type: company.entityType || 'EMPRESA' });
      });
    }
    if (contractsResult.status === 'fulfilled') {
      (contractsResult.value.contracts || []).forEach((contract) => {
        if (contract.orgao && !entities.has(normalizeEntity(contract.orgao))) {
          entities.set(normalizeEntity(contract.orgao), { name: contract.orgao, type: 'EMPRESA' });
        }
      });
    }
    if (entities.size) {
      entityCache.values = [...entities.values()].sort((left, right) => left.name.localeCompare(right.name, 'pt-BR'));
      entityCache.refreshedAt = Date.now();
    }
  }).catch((error) => console.error('Erro ao atualizar entidades:', error)).finally(() => {
    entityCache.refreshPromise = null;
  });
  return entityCache.refreshPromise;
}

function pageButtons(page, total, contract, filterToken = '') {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('lic-prev:' + page + ':' + filterToken).setLabel('◀ Anterior').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
    new ButtonBuilder().setCustomId('lic-next:' + page + ':' + filterToken).setLabel('Próxima ▶').setStyle(ButtonStyle.Primary).setDisabled(page >= total - 1),
    new ButtonBuilder().setCustomId('lic-proposal:' + contract.id).setLabel('Fazer proposta').setStyle(ButtonStyle.Success).setDisabled(contract.status === 'ENCERRADA'),
  )];
}

function proposalButton(contract) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('lic-proposal:' + contract.id)
      .setLabel('Fazer proposta')
      .setStyle(ButtonStyle.Success)
      .setDisabled(contract.status === 'ENCERRADA'),
  );
}

function proposalModal(contractId) {
  const modal = new ModalBuilder().setCustomId('lic-proposal-modal:' + contractId).setTitle('Fazer proposta');
  const value = new TextInputBuilder().setCustomId('value').setLabel('Valor: Aceito ou novo valor (R$)').setValue('Aceito').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(30);
  const deadline = new TextInputBuilder().setCustomId('deadline').setLabel('Prazo: Aceito ou DD/MM/AAAA').setValue('Aceito').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(10);
  const comment = new TextInputBuilder().setCustomId('comment').setLabel('Comentário / justificativa (opcional)').setPlaceholder('Importante: explique sua proposta para aumentar as chances de seleção.').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(2000);
  return modal.addComponents(
    new ActionRowBuilder().addComponents(value),
    new ActionRowBuilder().addComponents(deadline),
    new ActionRowBuilder().addComponents(comment),
  );
}

function isAcceptedTerm(value) { return ['aceito', 'aceita', 'sim'].includes(String(value || '').trim().toLowerCase()); }
function parseBrazilianMoney(value) {
  const raw = String(value || '').trim().replace(/^r\$\s*/i, '');
  const normalized = raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw;
  const amount = Number(normalized);
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}
function toIsoDate(value) {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(value || '').trim());
  if (!match) return null;
  const [, dayText, monthText, yearText] = match;
  const year = Number(yearText), month = Number(monthText), day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? `${yearText}-${monthText}-${dayText}`
    : null;
}

function commentMessages(proposals) {
  const comments = proposals.filter((proposal) => proposal.message && proposal.message.trim());
  if (!comments.length) return ['💬 **Comentários desta licitação**\nNenhum comentário foi enviado ainda.'];

  const header = '💬 **Comentários desta licitação**\n';
  const messages = [];
  let current = header;
  for (const proposal of comments) {
    const author = proposal.user && proposal.user.username ? proposal.user.username : 'Usuário';
    const createdAt = proposal.createdAt ? new Date(proposal.createdAt).toLocaleString('pt-BR') : 'data não informada';
    const body = proposal.message.trim().replace(/\r?\n/g, '\n> ');
    const entry = `\n**${author}** · ${createdAt}\n> ${body}\n`;
    if (current.length + entry.length > 1_900 && current !== header) {
      messages.push(current.trim());
      current = header;
    }
    if (entry.length > 1_800) {
      const parts = entry.match(/.{1,1750}(?:\s|$)|.{1,1750}/gs) || [entry];
      for (const part of parts) {
        if (current !== header) messages.push(current.trim());
        messages.push((header + part).trim());
        current = header;
      }
    } else {
      current += entry;
    }
  }
  if (current !== header) messages.push(current.trim());
  return messages;
}
client.once(Events.ClientReady, async (readyClient) => {
  await readyClient.application.commands.set(commands);
  await refreshEntityCache();
  setInterval(() => { void refreshEntityCache(); }, 5 * 60 * 1000).unref();
  await publishRulesOnce(readyClient).catch((error) => console.error('Não foi possível publicar as regras:', error.message));
  await publishDevelopmentAnnouncementOnce(readyClient).catch((error) => console.error('Não foi possível publicar o aviso de desenvolvimento:', error.message));
  await publishFaqThreadsOnce(readyClient).catch((error) => console.error('Não foi possível criar os tópicos de dúvidas:', error.message));
  console.log(readyClient.user.tag + ' está online e sincronizado com o site. Entidades carregadas: ' + entityCache.values.length);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isButton()) {
    const proposalMatch = /^lic-proposal:(\d+)$/.exec(interaction.customId);
    if (proposalMatch) {
      await interaction.showModal(proposalModal(proposalMatch[1]));
      return;
    }
    const match = /^lic-(prev|next):(\d+):([a-z0-9]*)$/.exec(interaction.customId);
    if (!match) return;
    await interaction.deferUpdate();
    const data = await request('/api/bot/contratos');
    const filter = listingFilters.get(match[3]) || {};
    const contracts = (data.contracts || []).filter((contract) =>
      (!filter.status || contract.status === filter.status)
      && (!filter.category || entityTypeForName(contract.orgao) === filter.category)
      && (!filter.entity || normalizeEntity(contract.orgao) === normalizeEntity(filter.entity)),
    );
    const page = Math.max(0, Math.min(contracts.length - 1, Number(match[2]) + (match[1] === 'next' ? 1 : -1)));
    const embed = await pageEmbedWithComments(contracts[page], page, contracts.length);
    await interaction.editReply({ embeds: [embed], components: pageButtons(page, contracts.length, contracts[page], match[3]) });
    return;
  }
  if (interaction.isModalSubmit() && interaction.customId.startsWith('lic-proposal-modal:')) {
    try {
      const contractId = interaction.customId.slice('lic-proposal-modal:'.length);
      const valueInput = interaction.fields.getTextInputValue('value');
      const deadlineInput = interaction.fields.getTextInputValue('deadline');
      const acceptValue = isAcceptedTerm(valueInput);
      const acceptDeadline = isAcceptedTerm(deadlineInput);
      const newValue = acceptValue ? null : parseBrazilianMoney(valueInput);
      const newDeadline = acceptDeadline ? null : toIsoDate(deadlineInput);
      if (!acceptValue && newValue === null) throw new Error('Informe Aceito ou um novo valor válido em R$.');
      if (!acceptDeadline && !newDeadline) throw new Error('Informe Aceito ou um novo prazo no formato DD/MM/AAAA.');

      await interaction.deferReply();
      const result = await request('/api/bot/contratos/' + encodeURIComponent(contractId) + '/propostas', {
        method: 'POST',
        body: JSON.stringify({
          userId: interaction.user.id,
          username: interaction.user.username,
          avatar: interaction.user.avatar || null,
          acceptValue,
          acceptDeadline,
          newValue,
          newDeadline,
          message: interaction.fields.getTextInputValue('comment'),
        }),
      });
      const commentText = result.proposal.message || '';
      const comment = commentText ? `\n💬 Comentário: ${commentText.slice(0, 1_600)}${commentText.length > 1_600 ? '…' : ''}` : '';
      await interaction.editReply(`✅ **${interaction.user.username}** enviou uma proposta para esta licitação.${comment}`);
    } catch (error) {
      console.error('Erro ao enviar proposta:', error);
      const message = 'Não foi possível enviar a proposta: ' + error.message;
      if (interaction.replied || interaction.deferred) await interaction.editReply(message);
      else await interaction.reply({ content: message, ephemeral: true });
    }
    return;
  }
  if (interaction.isAutocomplete()) {
    if (interaction.commandName !== 'licitacao' || interaction.options.getSubcommand() !== 'listar') return;
    try {
      const focused = interaction.options.getFocused();
      if (focused.name !== 'entidade') return;
      if (Date.now() - entityCache.refreshedAt > 5 * 60 * 1000) void refreshEntityCache();
      const selectedCategory = interaction.options.getString('categoria');
      const query = normalizeEntity(focused.value);
      const choices = entityCache.values
        .filter((entity) => (!selectedCategory || entity.type === selectedCategory) && (!query || normalizeEntity(entity.name).includes(query)))
        .slice(0, 25)
        .map((entity) => ({ name: entity.name.slice(0, 100), value: entity.name.slice(0, 100) }));
      await interaction.respond(choices);
    } catch (error) {
      console.error('Erro ao carregar entidades:', error);
      await interaction.respond([]);
    }
    return;
  }
  if (!interaction.isChatInputCommand() || interaction.commandName !== 'licitacao') return;

  try {
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'listar') {
      const data = await request('/api/bot/contratos');
      if (!entityCache.values.length) await refreshEntityCache();
      const selectedStatus = interaction.options.getString('status');
      const selectedCategory = interaction.options.getString('categoria');
      const selectedEntity = interaction.options.getString('entidade');
      const contracts = (data.contracts || []).filter((contract) =>
        (!selectedStatus || contract.status === selectedStatus)
        && (!selectedCategory || entityTypeForName(contract.orgao) === selectedCategory)
        && (!selectedEntity || normalizeEntity(contract.orgao) === normalizeEntity(selectedEntity)),
      );
      if (!contracts.length) { await interaction.reply({ content: 'Nenhuma licitação cadastrada.' }); return; }
      const embed = await pageEmbedWithComments(contracts[0], 0, contracts.length);
      const filterToken = createListingFilter(selectedEntity, selectedStatus, selectedCategory);
      const categoryName = entityTypeChoices.find((choice) => choice.value === selectedCategory)?.name;
      const heading = selectedEntity ? `📋 **Licitações de ${selectedEntity}**` : categoryName ? `📋 **Licitações — ${categoryName}**` : '📋 **Licitações da Docs Company**';
      await interaction.reply({ content: heading, embeds: [embed], components: pageButtons(0, contracts.length, contracts[0], filterToken) });
      return;
    }
    if (subcommand === 'ver') {
      const id = interaction.options.getString('id', true);
      const list = await request('/api/bot/contratos');
      const contractMatch = (list.contracts || []).find((contract) => contract.bidNumber === id || String(contract.id) === id);
      if (!contractMatch) throw new Error('Licitação não encontrada.');
      const data = await request('/api/bot/contratos/' + contractMatch.id);
      const proposalData = await request('/api/bot/contratos/' + contractMatch.id + '/propostas');
      await interaction.reply({ embeds: [contractEmbed(data.contract, proposalData.proposals || [])], components: [proposalButton(data.contract)] });
      return;
    }

    const id = interaction.options.getInteger('id');
    const payload = { actorId: interaction.user.id };

    if (subcommand === 'criar') {
      payload.title = interaction.options.getString('titulo', true);
      payload.value = interaction.options.getNumber('valor', true);
      const deadlineInput = interaction.options.getString('prazo');
      payload.deadline = deadlineInput ? toIsoDate(deadlineInput) : '';
      if (deadlineInput && !payload.deadline) throw new Error('Informe o prazo no formato DD/MM/AAAA.');
      payload.description = interaction.options.getString('descricao') || '';
      payload.status = interaction.options.getString('status') || 'ABERTA';
      const data = await request('/api/bot/contratos', { method: 'POST', body: JSON.stringify(payload) });
      await interaction.reply({ content: 'Licitação criada e publicada no site.', embeds: [contractEmbed(data.contract)] });
      return;
    }

    if (subcommand === 'editar') {
      payload.title = interaction.options.getString('titulo') || undefined;
      payload.value = interaction.options.getNumber('valor') ?? undefined;
      const deadlineInput = interaction.options.getString('prazo');
      if (deadlineInput && !toIsoDate(deadlineInput)) throw new Error('Informe o prazo no formato DD/MM/AAAA.');
      payload.deadline = deadlineInput ? toIsoDate(deadlineInput) : undefined;
      payload.description = interaction.options.getString('descricao') || undefined;
      payload.status = interaction.options.getString('status') || undefined;
      if (Object.keys(payload).length === 1) {
        await interaction.reply({ content: 'Informe ao menos um campo para editar.', ephemeral: true });
        return;
      }
      const data = await request('/api/bot/contratos/' + id, { method: 'PATCH', body: JSON.stringify(payload) });
      await interaction.reply({ content: 'Licitação atualizada no site.', embeds: [contractEmbed(data.contract)] });
      return;
    }

    if (subcommand === 'encerrar') {
      payload.reason = interaction.options.getString('motivo', true);
      const data = await request('/api/bot/contratos/' + id + '/encerrar', { method: 'PATCH', body: JSON.stringify(payload) });
      await interaction.reply({ content: 'Licitação encerrada no site.', embeds: [contractEmbed(data.contract)] });
      return;
    }

    const data = await request('/api/bot/contratos/' + id, { method: 'DELETE', body: JSON.stringify(payload) });
    await interaction.reply({ content: 'Licitação excluída do site: **' + data.deletedContract.title + '**.' });
  } catch (error) {
    console.error('Erro de sincronização:', error);
    const message = error.message === 'Administrator permission required'
      ? 'Apenas administradores podem executar essa ação.'
      : 'Não foi possível concluir a ação: ' + error.message;
    if (interaction.replied || interaction.deferred) await interaction.followUp({ content: message, ephemeral: true });
    else await interaction.reply({ content: message, ephemeral: true });
  }
});

client.login(token);
