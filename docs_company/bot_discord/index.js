const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  ModalBuilder,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');

const apiUrl = (process.env.SITE_API_URL || 'http://localhost:3000').replace(/\/$/, '');
const apiKey = process.env.BOT_API_KEY;
const token = process.env.DISCORD_TOKEN;

if (!token || !apiKey) {
  console.error('Defina DISCORD_TOKEN e BOT_API_KEY antes de iniciar o bot.');
  process.exit(1);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const statusChoices = [
  { name: 'Aberta', value: 'ABERTA' },
  { name: 'Em andamento', value: 'ANDAMENTO' },
  { name: 'Encerrada', value: 'ENCERRADA' },
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
        .addStringOption((option) => option.setName('prazo').setDescription('Prazo no formato AAAA-MM-DD.').setMaxLength(10))
        .addStringOption((option) => option.setName('descricao').setDescription('Descrição.').setMaxLength(1000))
        .addStringOption((option) => option.setName('status').setDescription('Status inicial.').addChoices(...statusChoices)),
    )
    .addSubcommand((subcommand) => subcommand.setName('listar').setDescription('Lista as licitações do site.').addStringOption((option) => option.setName('status').setDescription('Filtrar por status.').addChoices(...statusChoices)))
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
        .addStringOption((option) => option.setName('prazo').setDescription('Novo prazo AAAA-MM-DD.').setMaxLength(10))
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

function formatMoney(value, valueToBeAgreed) {
  return valueToBeAgreed ? 'A combinar' : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value || 0);
}

function contractEmbed(contract) {
  return new EmbedBuilder()
    .setColor(contract.status === 'ENCERRADA' ? 0xed4245 : contract.status === 'ANDAMENTO' ? 0xfee75c : 0x57f287)
    .setTitle(contract.title)
    .addFields(
      { name: 'Referência interna', value: String(contract.id), inline: true },
      { name: 'Número da licitação', value: contract.bidNumber || contract.code || '-', inline: true },
      { name: 'Status', value: contract.status || 'ABERTA', inline: true },
      { name: 'Valor', value: formatMoney(contract.value, contract.valueToBeAgreed), inline: true },
      { name: 'Prazo', value: contract.deadline || 'Não informado', inline: true },
      { name: 'Órgão', value: contract.orgao || 'Docs Company', inline: true },
      { name: 'Descrição', value: (contract.description || 'Sem descrição.').slice(0, 1000) },
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
      { name: 'Prazo', value: contract.deadline || 'Não informado', inline: true },
    )
    .setFooter({ text: 'Licitação ' + (position + 1) + ' de ' + position.total + ' • Dados sincronizados com o site.' });
}
function pageEmbed(contract, page, total) {
  const embed = new EmbedBuilder()
    .setColor(0xFEE75C)
    .setAuthor({ name: contract.orgao || 'Docs Company' })
    .setTitle((page + 1) + 'ª LICITAÇÃO • ' + (contract.bidNumber || ('#' + contract.id)))
    .setDescription('**' + contract.title + '**' + (contract.description ? '\n\n' + contract.description.slice(0, 900) : ''))
    .addFields(
      { name: 'Status', value: contract.status || 'ABERTA', inline: true },
      { name: 'Valor', value: formatMoney(contract.value, contract.valueToBeAgreed), inline: true },
      { name: 'Prazo', value: contract.deadline || 'Não informado', inline: true },
    )
    .setFooter({ text: 'Página ' + (page + 1) + ' de ' + total + ' • Dados sincronizados com o site.' });
  if (contract.companyLogo) embed.setThumbnail(contract.companyLogo);
  return embed;
}
function pageButtons(page, total) {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('lic-prev:' + page).setLabel('◀ Anterior').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
    new ButtonBuilder().setCustomId('lic-next:' + page).setLabel('Próxima ▶').setStyle(ButtonStyle.Primary).setDisabled(page >= total - 1),
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
  const deadline = new TextInputBuilder().setCustomId('deadline').setLabel('Prazo: Aceito ou AAAA-MM-DD').setValue('Aceito').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(10);
  const comment = new TextInputBuilder().setCustomId('comment').setLabel('Comentários / justificativa (opcional)').setPlaceholder('Explique brevemente sua proposta.').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(2000);
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
function isIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}
client.once(Events.ClientReady, async (readyClient) => {
  await readyClient.application.commands.set(commands);
  console.log(readyClient.user.tag + ' está online e sincronizado com o site.');
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isButton()) {
    const proposalMatch = /^lic-proposal:(\d+)$/.exec(interaction.customId);
    if (proposalMatch) {
      await interaction.showModal(proposalModal(proposalMatch[1]));
      return;
    }
    const match = /^lic-(prev|next):(\d+)$/.exec(interaction.customId);
    if (!match) return;
    await interaction.deferUpdate();
    const data = await request('/api/bot/contratos');
    const contracts = data.contracts || [];
    const page = Math.max(0, Math.min(contracts.length - 1, Number(match[2]) + (match[1] === 'next' ? 1 : -1)));
    await interaction.editReply({ embeds: [pageEmbed(contracts[page], page, contracts.length)], components: pageButtons(page, contracts.length) });
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
      const newDeadline = acceptDeadline ? null : deadlineInput.trim();
      if (!acceptValue && newValue === null) throw new Error('Informe Aceito ou um novo valor válido em R$.');
      if (!acceptDeadline && !isIsoDate(newDeadline)) throw new Error('Informe Aceito ou um novo prazo no formato AAAA-MM-DD.');

      await interaction.deferReply({ ephemeral: true });
      await request('/api/bot/contratos/' + encodeURIComponent(contractId) + '/propostas', {
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
      await interaction.editReply('Proposta enviada com sucesso. Seu comentário foi vinculado a esta licitação.');
    } catch (error) {
      console.error('Erro ao enviar proposta:', error);
      const message = 'Não foi possível enviar a proposta: ' + error.message;
      if (interaction.replied || interaction.deferred) await interaction.editReply(message);
      else await interaction.reply({ content: message, ephemeral: true });
    }
    return;
  }
  if (!interaction.isChatInputCommand() || interaction.commandName !== 'licitacao') return;

  try {
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'listar') {
      const data = await request('/api/bot/contratos');
      const selectedStatus = interaction.options.getString('status');
      const contracts = (data.contracts || []).filter((contract) => !selectedStatus || contract.status === selectedStatus);
      if (!contracts.length) { await interaction.reply({ content: 'Nenhuma licitação cadastrada.' }); return; }
      await interaction.reply({ content: '📋 **Licitações da Docs Company**', embeds: [pageEmbed(contracts[0], 0, contracts.length)], components: pageButtons(0, contracts.length) });
      return;
    }
    if (subcommand === 'ver') {
      const id = interaction.options.getString('id', true);
      const list = await request('/api/bot/contratos');
      const contractMatch = (list.contracts || []).find((contract) => contract.bidNumber === id || String(contract.id) === id);
      if (!contractMatch) throw new Error('Licitação não encontrada.');
      const data = await request('/api/bot/contratos/' + contractMatch.id);
      await interaction.reply({ embeds: [contractEmbed(data.contract)], components: [proposalButton(data.contract)] });
      return;
    }

    const id = interaction.options.getInteger('id');
    const payload = { actorId: interaction.user.id };

    if (subcommand === 'criar') {
      payload.title = interaction.options.getString('titulo', true);
      payload.value = interaction.options.getNumber('valor', true);
      payload.deadline = interaction.options.getString('prazo') || '';
      payload.description = interaction.options.getString('descricao') || '';
      payload.status = interaction.options.getString('status') || 'ABERTA';
      const data = await request('/api/bot/contratos', { method: 'POST', body: JSON.stringify(payload) });
      await interaction.reply({ content: 'Licitação criada e publicada no site.', embeds: [contractEmbed(data.contract)] });
      return;
    }

    if (subcommand === 'editar') {
      payload.title = interaction.options.getString('titulo') || undefined;
      payload.value = interaction.options.getNumber('valor') ?? undefined;
      payload.deadline = interaction.options.getString('prazo') ?? undefined;
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
