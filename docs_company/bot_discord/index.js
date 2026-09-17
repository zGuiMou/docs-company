const {
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  SlashCommandBuilder,
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
    .addSubcommand((subcommand) => subcommand.setName('listar').setDescription('Lista as licitações do site.'))
    .addSubcommand((subcommand) =>
      subcommand.setName('ver').setDescription('Mostra uma licitação.').addIntegerOption((option) => option.setName('id').setDescription('ID da licitação.').setRequired(true)),
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
  if (!response.ok) throw new Error(data.error || 'A API do site não respondeu.');
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
      { name: 'ID', value: String(contract.id), inline: true },
      { name: 'Código', value: contract.code || '-', inline: true },
      { name: 'Status', value: contract.status || 'ABERTA', inline: true },
      { name: 'Valor', value: formatMoney(contract.value, contract.valueToBeAgreed), inline: true },
      { name: 'Prazo', value: contract.deadline || 'Não informado', inline: true },
      { name: 'Órgão', value: contract.orgao || 'Docs Company', inline: true },
      { name: 'Descrição', value: (contract.description || 'Sem descrição.').slice(0, 1000) },
    )
    .setFooter({ text: 'Dados sincronizados com o site.' });
}

client.once(Events.ClientReady, async (readyClient) => {
  await readyClient.application.commands.set(commands);
  console.log(readyClient.user.tag + ' está online e sincronizado com o site.');
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand() || interaction.commandName !== 'licitacao') return;

  try {
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'listar') {
      const data = await request('/api/bot/contratos');
      const contracts = data.contracts || [];
      const lines = contracts.slice(0, 15).map((contract) => '• #' + contract.id + ' — **' + contract.title + '** (' + contract.status + ')').join('\n');
      await interaction.reply({ content: lines || 'Nenhuma licitação cadastrada.', ephemeral: true });
      return;
    }

    if (subcommand === 'ver') {
      const id = interaction.options.getInteger('id', true);
      const data = await request('/api/bot/contratos/' + id);
      await interaction.reply({ embeds: [contractEmbed(data.contract)], ephemeral: true });
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