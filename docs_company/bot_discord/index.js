const {
  ChannelType,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
} = require('discord.js');
const fs = require('node:fs/promises');
const path = require('node:path');

const token = process.env.DISCORD_TOKEN;
const rulesChannelId = process.env.RULES_CHANNEL_ID || '1549529444987834509';
const rulesImageUrl = process.env.RULES_IMAGE_URL || 'https://i.imgur.com/raDRCcV.png';
const developmentChannelId = process.env.DEVELOPMENT_CHANNEL_ID || '1550243018122989678';
const developmentVersion = 6;
const faqChannelId = process.env.FAQ_CHANNEL_ID || '1550243118287159346';
const rulesStateFile = path.join(__dirname, 'data', 'rules-state.json');
const rulesVersion = 5;

if (!token) {
  console.error('Defina DISCORD_TOKEN antes de iniciar o bot.');
  process.exit(1);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const faqTopics = [
  {
    key: 'transacoes',
    version: 3,
    title: 'Como consultar as transações do servidor?',
    text: 'A página Transações audita movimentações que envolvem prefeituras e governo, não transferências entre jogadores. Os registros e valores atuais são fictícios; a coleta real dependerá da integração futura com o mod de Minecraft.',
  },
  {
    key: 'coletor',
    version: 1,
    title: 'Como os dados reais serão coletados?',
    text: 'O plano é desenvolver um mod Minecraft que leia eventos do console, identifique transações com participação de prefeituras ou governo e envie os registros para auditoria. A integração ainda não está ativa.',
  },
  {
    key: 'codigo',
    version: 1,
    title: 'Onde acompanhar o código da Docs Company?',
    text: 'O projeto está no GitHub como [repositório da Docs Company](https://github.com/zGuiMou/fisco). O Portal Transparência explica o fluxo previsto entre coleta, cálculos e consulta pública.',
  },
];

async function readSavedState() {
  try {
    return JSON.parse(await fs.readFile(rulesStateFile, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn('Não foi possível ler o estado do bot:', error.message);
    return {};
  }
}

async function saveState(state) {
  await fs.mkdir(path.dirname(rulesStateFile), { recursive: true });
  await fs.writeFile(rulesStateFile, JSON.stringify(state, null, 2), 'utf8');
}

function rulesEmbed() {
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('REGRAS DA DOCS. COMPANY')
    .setDescription([
      '**1. Respeito e profissionalismo**\nSem ofensas, preconceito, assédio ou ataques pessoais.',
      '**2. Canais corretos**\nUse cada canal conforme sua finalidade.',
      '**3. Sem spam**\nEvite flood, mensagens repetidas e marcações desnecessárias.',
      '**4. Privacidade**\nNão compartilhe dados pessoais ou informações internas sem autorização.',
      '**5. Divulgação com autorização**\nNão divulgue projetos, servidores ou redes sociais sem aprovação.',
      '**6. Conteúdo adequado**\nNão envie conteúdo ilegal, sexual ou violento.',
      '**7. Respeite a moderação**\nEm caso de dúvida ou problema, procure a equipe.',
    ].join('\n\n'))
    .setImage(rulesImageUrl);
}

function developmentEmbed() {
  return new EmbedBuilder()
    .setColor(0xc9f36a)
    .setTitle('DOCS COMPANY — EM DESENVOLVIMENTO')
    .setDescription([
      'O painel público está em protótipo. Os valores exibidos são demonstrativos.',
      'A próxima etapa planejada é um mod Minecraft para coletar transações que envolvam prefeituras ou governo e enviar os eventos para auditoria por cidade.',
      '[Acompanhe o código da Docs Company no GitHub](https://github.com/zGuiMou/fisco).',
    ].join('\n\n'));
}

function faqEmbed(topic) {
  return new EmbedBuilder()
    .setColor(0xc9f36a)
    .setTitle(topic.title)
    .setDescription(topic.text)
    .setFooter({ text: 'Docs. Company · Expresso Continental' });
}

async function updateSavedThread(readyClient, threadId, name, embed) {
  try {
    const thread = await readyClient.channels.fetch(threadId);
    if (!thread) return false;
    const starterMessage = await thread.messages.fetch(thread.id);
    await starterMessage.edit({ embeds: [embed] });
    if (thread.name !== name) await thread.setName(name);
    return true;
  } catch (error) {
    console.warn('Não foi possível atualizar o tópico salvo:', error.message);
    return false;
  }
}

async function publishRulesOnce(readyClient) {
  const savedState = await readSavedState();
  const channel = await readyClient.channels.fetch(rulesChannelId);
  if (!channel) throw new Error('RULES_CHANNEL_ID não aponta para um canal válido.');
  if (savedState.rulesThreadId && savedState.version === rulesVersion) return;

  if (channel.type === ChannelType.GuildForum) {
    const thread = await channel.threads.create({ name: 'Regras da Docs. Company', message: { embeds: [rulesEmbed()] } });
    await saveState({ ...savedState, rulesThreadId: thread.id, version: rulesVersion, publishedAt: new Date().toISOString() });
    return;
  }
  if (!channel.isTextBased() || typeof channel.send !== 'function') throw new Error('RULES_CHANNEL_ID precisa ser um canal de fórum ou texto.');

  let message;
  if (savedState.messageId) {
    try {
      message = await channel.messages.fetch(savedState.messageId);
      await message.edit({ embeds: [rulesEmbed()] });
    } catch (error) {
      console.warn('Não foi possível reutilizar a mensagem de regras:', error.message);
    }
  }
  if (!message) message = await channel.send({ embeds: [rulesEmbed()] });
  const thread = await message.startThread({ name: 'Regras da Docs. Company', autoArchiveDuration: 1440 });
  await saveState({ ...savedState, messageId: message.id, rulesThreadId: thread.id, version: rulesVersion, publishedAt: new Date().toISOString() });
}

async function publishDevelopmentAnnouncementOnce(readyClient) {
  const savedState = await readSavedState();
  const channel = await readyClient.channels.fetch(developmentChannelId);
  if (!channel) throw new Error('DEVELOPMENT_CHANNEL_ID não aponta para um canal válido.');
  if (savedState.developmentThreadId && savedState.developmentVersion === developmentVersion) return;
  if (savedState.developmentThreadId && await updateSavedThread(readyClient, savedState.developmentThreadId, 'Docs Company em Desenvolvimento', developmentEmbed())) {
    await saveState({ ...savedState, developmentVersion, developmentPublishedAt: new Date().toISOString() });
    return;
  }

  if (channel.type === ChannelType.GuildForum) {
    const thread = await channel.threads.create({ name: 'Docs Company em Desenvolvimento', message: { embeds: [developmentEmbed()] } });
    await saveState({ ...savedState, developmentThreadId: thread.id, developmentVersion, developmentPublishedAt: new Date().toISOString() });
    return;
  }
  if (!channel.isTextBased() || typeof channel.send !== 'function') throw new Error('DEVELOPMENT_CHANNEL_ID precisa ser um canal de fórum ou texto.');

  let message;
  if (savedState.developmentMessageId) {
    try {
      message = await channel.messages.fetch(savedState.developmentMessageId);
      await message.edit({ embeds: [developmentEmbed()] });
    } catch (error) {
      console.warn('Não foi possível reutilizar o aviso de desenvolvimento:', error.message);
    }
  }
  if (!message) message = await channel.send({ embeds: [developmentEmbed()] });
  let threadId = savedState.developmentThreadId;
  if (!threadId) {
    const thread = await message.startThread({ name: 'Docs Company em Desenvolvimento', autoArchiveDuration: 1440 });
    threadId = thread.id;
  }
  await saveState({ ...savedState, developmentMessageId: message.id, developmentThreadId: threadId, developmentVersion, developmentPublishedAt: new Date().toISOString() });
}

async function publishFaqThreadsOnce(readyClient) {
  const savedState = await readSavedState();
  const channel = await readyClient.channels.fetch(faqChannelId);
  if (!channel) throw new Error('FAQ_CHANNEL_ID não aponta para um canal válido.');
  const faqThreads = savedState.faqThreads || {};

  for (const topic of faqTopics) {
    const savedThread = faqThreads[topic.key];
    if (savedThread && savedThread.version === topic.version) continue;
    if (savedThread && await updateSavedThread(readyClient, savedThread.id, topic.title, faqEmbed(topic))) {
      faqThreads[topic.key] = { id: savedThread.id, version: topic.version };
      await saveState({ ...savedState, faqThreads });
      continue;
    }
    let thread;
    if (channel.type === ChannelType.GuildForum) {
      thread = await channel.threads.create({ name: topic.title, message: { embeds: [faqEmbed(topic)] } });
    } else if (channel.isTextBased() && typeof channel.send === 'function') {
      const starterMessage = await channel.send({ embeds: [faqEmbed(topic)] });
      thread = await starterMessage.startThread({ name: topic.title, autoArchiveDuration: 1440 });
    } else {
      throw new Error('FAQ_CHANNEL_ID precisa ser um canal de fórum ou texto.');
    }
    faqThreads[topic.key] = { id: thread.id, version: topic.version };
    await saveState({ ...savedState, faqThreads });
  }
}

client.once(Events.ClientReady, async (readyClient) => {
  await readyClient.application.commands.set([]);
  await publishRulesOnce(readyClient).catch((error) => console.error('Não foi possível publicar as regras:', error.message));
  await publishDevelopmentAnnouncementOnce(readyClient).catch((error) => console.error('Não foi possível publicar o aviso da Docs Company:', error.message));
  await publishFaqThreadsOnce(readyClient).catch((error) => console.error('Não foi possível atualizar a FAQ:', error.message));
  console.log(readyClient.user.tag + ' está online. Nenhum comando de licitação ou entidade está registrado.');
});

client.login(token);