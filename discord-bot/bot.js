require('dotenv').config();
const {
  Client, GatewayIntentBits, PermissionFlagsBits,
  ChannelType, EmbedBuilder, ActionRowBuilder,
  ButtonBuilder, ButtonStyle, ModalBuilder,
  TextInputBuilder, TextInputStyle,
  PermissionsBitField, Colors
} = require('discord.js');

const GAME_API = process.env.GAME_API_URL || 'http://localhost:3000';
const API_SECRET = process.env.API_SECRET || 'changeme';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers
  ]
});

// ============================================
// HELPERS
// ============================================

async function callGameAPI(endpoint, method = 'GET', body = null) {
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Bot-Secret': API_SECRET
    }
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${GAME_API}${endpoint}`, opts);
  return res.json();
}

// ============================================
// /init COMMAND
// ============================================

async function handleInit(interaction) {
  if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({ content: '❌ Réservé aux administrateurs.', ephemeral: true });
  }

  await interaction.reply({
    content: '⚠️ **ATTENTION** — Cette commande va **supprimer TOUS les salons** et recréer le serveur.\nClique sur **Confirmer** pour continuer.',
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('init_confirm').setLabel('Confirmer').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('init_cancel').setLabel('Annuler').setStyle(ButtonStyle.Secondary)
      )
    ],
    ephemeral: true
  });
}

async function executeInit(interaction) {
  const guild = interaction.guild;

  await interaction.update({ content: '🔄 Initialisation en cours...', components: [] });

  try {
    // 1. Delete all channels
    const channels = await guild.channels.fetch();
    const deletePromises = channels.map(ch => {
      if (ch && ch.deletable) return ch.delete().catch(() => {});
      return Promise.resolve();
    });
    await Promise.all(deletePromises);

    // 2. Delete old roles (except @everyone and bot's own role)
    const roles = await guild.roles.fetch();
    const botHighestRole = guild.members.me.roles.highest;
    for (const [, role] of roles) {
      if (role.id === guild.id) continue; // @everyone
      if (role.managed) continue; // bot roles
      if (role.position >= botHighestRole.position) continue;
      try { await role.delete(); } catch {}
    }

    // 3. Create the "Invocateur" role
    const invocateurRole = await guild.roles.create({
      name: '🃏 Invocateur',
      color: Colors.Green,
      reason: 'Rôle donné aux joueurs qui ont lié leur compte'
    });

    // 4. Create categories and channels
    const everyone = guild.roles.everyone;

    // --- Category: ACCUEIL ---
    const catAccueil = await guild.channels.create({
      name: '🏠 ACCUEIL',
      type: ChannelType.GuildCategory,
      permissionOverwrites: [
        { id: everyone.id, allow: [PermissionFlagsBits.ViewChannel] }
      ]
    });

    // Link channel — visible by all, but ONLY channel accessible without role
    const linkChannel = await guild.channels.create({
      name: '🔗・lier-compte',
      type: ChannelType.GuildText,
      parent: catAccueil.id,
      topic: 'Lie ton compte GACHA CARDS pour accéder au serveur !',
      permissionOverwrites: [
        { id: everyone.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory], deny: [PermissionFlagsBits.SendMessages] },
        { id: client.user.id, allow: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.ViewChannel] }
      ]
    });

    // Rules channel — visible by all
    await guild.channels.create({
      name: '📜・regles',
      type: ChannelType.GuildText,
      parent: catAccueil.id,
      permissionOverwrites: [
        { id: everyone.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory], deny: [PermissionFlagsBits.SendMessages] },
        { id: client.user.id, allow: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.ViewChannel] }
      ]
    });

    // --- Category: COMMUNAUTE (role-locked) ---
    const catComm = await guild.channels.create({
      name: '💬 COMMUNAUTÉ',
      type: ChannelType.GuildCategory,
      permissionOverwrites: [
        { id: everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
        { id: invocateurRole.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }
      ]
    });

    await guild.channels.create({ name: '💬・général', type: ChannelType.GuildText, parent: catComm.id });
    await guild.channels.create({ name: '📢・annonces', type: ChannelType.GuildText, parent: catComm.id,
      permissionOverwrites: [
        { id: everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
        { id: invocateurRole.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory], deny: [PermissionFlagsBits.SendMessages] },
        { id: client.user.id, allow: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.ViewChannel] }
      ]
    });
    await guild.channels.create({ name: '🖼️・showcase', type: ChannelType.GuildText, parent: catComm.id });
    await guild.channels.create({ name: '🏪・marché', type: ChannelType.GuildText, parent: catComm.id });

    // 5. Send link embed in the link channel
    await sendLinkEmbed(linkChannel);

    // 6. Send a confirmation somewhere — DM the admin
    try {
      await interaction.user.send(`✅ Le serveur **${guild.name}** a été initialisé avec succès !\n\n🔗 Le salon **#lier-compte** est prêt.\n🃏 Le rôle **Invocateur** a été créé.\n\nLes joueurs doivent lier leur compte pour accéder aux salons.`);
    } catch {}

  } catch (err) {
    console.error('Erreur init:', err);
    try {
      await interaction.user.send('❌ Erreur pendant l\'initialisation: ' + err.message);
    } catch {}
  }
}

// ============================================
// LINK EMBED
// ============================================

async function sendLinkEmbed(channel) {
  const embed = new EmbedBuilder()
    .setTitle('🔗 Lier ton compte GACHA CARDS')
    .setDescription(
      '**Bienvenue, Invocateur !**\n\n' +
      'Pour accéder au serveur, tu dois lier ton compte de jeu.\n\n' +
      '**Comment faire :**\n' +
      '1️⃣ Clique sur le bouton ci-dessous\n' +
      '2️⃣ Entre ton **nom d\'utilisateur** en jeu\n' +
      '3️⃣ Tu recevras un **code de vérification à 6 chiffres**\n' +
      '4️⃣ Va dans le jeu → ⚙️ **Paramètres** → **Lier Discord**\n' +
      '5️⃣ Entre le code pour confirmer la liaison\n\n' +
      '*Le code expire après 5 minutes.*'
    )
    .setColor(0x00ff41)
    .setFooter({ text: 'GACHA CARDS — Système de liaison sécurisé' })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('link_start')
      .setLabel('🔗 Lier mon compte')
      .setStyle(ButtonStyle.Success)
  );

  await channel.send({ embeds: [embed], components: [row] });
}

// ============================================
// LINK FLOW — BUTTON → MODAL → CODE → VERIFY
// ============================================

async function handleLinkButton(interaction) {
  // Check if user already has the role
  const invocateurRole = interaction.guild.roles.cache.find(r => r.name === '🃏 Invocateur');
  if (invocateurRole && interaction.member.roles.cache.has(invocateurRole.id)) {
    return interaction.reply({
      content: '✅ Ton compte est déjà lié ! Tu as accès à tous les salons.',
      ephemeral: true
    });
  }

  const modal = new ModalBuilder()
    .setCustomId('link_modal')
    .setTitle('Lier ton compte GACHA CARDS');

  const usernameInput = new TextInputBuilder()
    .setCustomId('link_username')
    .setLabel('Ton nom d\'utilisateur en jeu')
    .setPlaceholder('Ex: ShadowPlayer42')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(2)
    .setMaxLength(30);

  modal.addComponents(new ActionRowBuilder().addComponents(usernameInput));
  await interaction.showModal(modal);
}

async function handleLinkModal(interaction) {
  const username = interaction.fields.getTextInputValue('link_username').trim();

  await interaction.deferReply({ ephemeral: true });

  try {
    // Call game API to request a link code
    const result = await callGameAPI('/api/discord/request-link', 'POST', {
      username: username,
      discordId: interaction.user.id,
      discordTag: interaction.user.tag
    });

    if (result.error) {
      return interaction.editReply({
        content: `❌ **Erreur :** ${result.error}`
      });
    }

    const code = result.code;

    const embed = new EmbedBuilder()
      .setTitle('🔐 Code de vérification')
      .setDescription(
        `Ton code : **\`${code}\`**\n\n` +
        '**Étapes :**\n' +
        '1. Va sur le jeu\n' +
        '2. Clique sur ⚙️ **Paramètres**\n' +
        '3. Clique sur **Lier Discord**\n' +
        '4. Entre le code ci-dessus\n\n' +
        '⏱️ *Ce code expire dans 5 minutes.*\n\n' +
        'Une fois le code entré en jeu, clique sur **Vérifier** ci-dessous.'
      )
      .setColor(0x00e5ff);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`link_verify_${interaction.user.id}`)
        .setLabel('✅ Vérifier')
        .setStyle(ButtonStyle.Primary)
    );

    await interaction.editReply({ embeds: [embed], components: [row] });

  } catch (err) {
    console.error('Link error:', err);
    await interaction.editReply({
      content: '❌ Impossible de contacter le serveur de jeu. Réessaie plus tard.'
    });
  }
}

async function handleLinkVerify(interaction) {
  await interaction.deferReply({ ephemeral: true });

  try {
    const result = await callGameAPI('/api/discord/check-link', 'POST', {
      discordId: interaction.user.id
    });

    if (result.error) {
      return interaction.editReply({
        content: `❌ ${result.error}\n\nAssure-toi d'avoir entré le code dans le jeu avant de cliquer ici.`
      });
    }

    if (result.linked) {
      // Give the role
      const invocateurRole = interaction.guild.roles.cache.find(r => r.name === '🃏 Invocateur');
      if (invocateurRole) {
        await interaction.member.roles.add(invocateurRole);
      }

      const embed = new EmbedBuilder()
        .setTitle('✅ Compte lié avec succès !')
        .setDescription(
          `**${result.username}** est maintenant lié à ton Discord.\n\n` +
          '🃏 Tu as reçu le rôle **Invocateur**.\n' +
          '📺 Tu as maintenant accès à tous les salons !\n\n' +
          '*Bonne chance dans l\'arène, Invocateur.*'
        )
        .setColor(0x00ff41);

      await interaction.editReply({ embeds: [embed], components: [] });
    } else {
      await interaction.editReply({
        content: '⏳ Liaison pas encore confirmée. Entre le code dans le jeu puis clique à nouveau sur **Vérifier**.'
      });
    }

  } catch (err) {
    console.error('Verify error:', err);
    await interaction.editReply({
      content: '❌ Impossible de contacter le serveur de jeu. Réessaie plus tard.'
    });
  }
}

// ============================================
// EVENT HANDLERS
// ============================================

client.once('ready', () => {
  console.log(`✅ Bot connecté en tant que ${client.user.tag}`);
  console.log(`📡 Serveurs: ${client.guilds.cache.size}`);
});

client.on('interactionCreate', async (interaction) => {
  try {
    // Slash commands
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === 'init') {
        await handleInit(interaction);
      }
    }

    // Buttons
    if (interaction.isButton()) {
      if (interaction.customId === 'init_confirm') {
        if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
          return interaction.reply({ content: '❌ Réservé aux administrateurs.', ephemeral: true });
        }
        await executeInit(interaction);
      }
      if (interaction.customId === 'init_cancel') {
        await interaction.update({ content: '❌ Initialisation annulée.', components: [] });
      }
      if (interaction.customId === 'link_start') {
        await handleLinkButton(interaction);
      }
      if (interaction.customId.startsWith('link_verify_')) {
        // Only the user who requested can verify
        const targetId = interaction.customId.split('_')[2];
        if (interaction.user.id !== targetId) {
          return interaction.reply({ content: '❌ Ce bouton n\'est pas pour toi.', ephemeral: true });
        }
        await handleLinkVerify(interaction);
      }
    }

    // Modals
    if (interaction.isModalSubmit()) {
      if (interaction.customId === 'link_modal') {
        await handleLinkModal(interaction);
      }
    }

  } catch (err) {
    console.error('Interaction error:', err);
    try {
      const reply = { content: '❌ Une erreur est survenue.', ephemeral: true };
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(reply);
      } else {
        await interaction.reply(reply);
      }
    } catch {}
  }
});

client.login(process.env.DISCORD_TOKEN);
