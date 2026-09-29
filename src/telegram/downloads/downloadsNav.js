'use strict';

const { Markup } = require('telegraf');

/** Seções da central de downloads (callbacks downloads:*) */
const SECTION = {
    HUB: 'hub',
    PLAY: 'play',
    TIKTOK: 'tiktok',
    YOUTUBE: 'youtube',
    INSTAGRAM: 'instagram',
    IG_STORIES: 'ig_stories',
    IG_HIGHLIGHTS: 'ig_highlights',
};

const SECTION_META = {
    [SECTION.PLAY]: { label: '🎧 Música', callback: 'downloads:play' },
    [SECTION.TIKTOK]: { label: '🎬 TikTok', callback: 'downloads:tiktok' },
    [SECTION.YOUTUBE]: { label: '📺 YouTube', callback: 'downloads:youtube' },
    [SECTION.INSTAGRAM]: { label: '📸 Instagram', callback: 'downloads:instagram' },
    [SECTION.IG_STORIES]: { label: '📖 Stories', callback: 'downloads:ig_stories' },
    [SECTION.IG_HIGHLIGHTS]: { label: '⭐ Destaques', callback: 'downloads:ig_highlights' },
    [SECTION.HUB]: { label: '⬇️ Central Downloads', callback: 'downloads:open' },
};

function btnHub() {
    return Markup.button.callback('⬇️ Central Downloads', 'downloads:open');
}

function btnMenu() {
    return Markup.button.callback('🏠 Menu', 'menu:home');
}

function sectionBackButton(section) {
    const meta = SECTION_META[section];
    if (!meta || section === SECTION.HUB) return btnHub();
    return Markup.button.callback(`↩️ ${meta.label}`, meta.callback);
}

function navFooterRows(section = SECTION.HUB) {
    const rows = [];
    if (section && section !== SECTION.HUB && SECTION_META[section]) {
        rows.push([sectionBackButton(section), btnHub()]);
    } else {
        rows.push([btnHub()]);
    }
    rows.push([btnMenu()]);
    return rows;
}

/** Após download, erro ou ajuda — volta à seção anterior + central + menu */
function doneKeyboard(section = SECTION.HUB) {
    return Markup.inlineKeyboard(navFooterRows(section));
}

/** Anexa navegação ao final de teclados de busca (lista / cancelar) */
function appendNav(keyboard, section = SECTION.HUB, ...extraRows) {
    const rows = keyboard?.reply_markup?.inline_keyboard
        ? [...keyboard.reply_markup.inline_keyboard]
        : [];
    for (const row of extraRows) {
        if (row?.length) rows.push(row);
    }
    rows.push(...navFooterRows(section));
    return Markup.inlineKeyboard(rows);
}

function sectionKeyboard() {
    return Markup.inlineKeyboard([
        [Markup.button.callback('↩️ Central Downloads', 'downloads:hub')],
        [btnMenu()],
    ]);
}

function instagramSectionKeyboard() {
    return Markup.inlineKeyboard([
        [
            Markup.button.callback('📖 Stories', 'downloads:ig_stories'),
            Markup.button.callback('⭐ Destaques', 'downloads:ig_highlights'),
        ],
        [Markup.button.callback('↩️ Central Downloads', 'downloads:hub')],
        [btnMenu()],
    ]);
}

function instagramSectionFor(itemOrParsed) {
    const mode = itemOrParsed?.mode || itemOrParsed?.type;
    if (mode === 'stories') return SECTION.IG_STORIES;
    if (mode === 'highlights') return SECTION.IG_HIGHLIGHTS;
    return SECTION.INSTAGRAM;
}

const NAV_HINT = '<i>↩️ Use os botões abaixo para baixar outro ou voltar.</i>';

/** Painéis de menu (hub, sucesso, erro) — sempre capa infos/menu*.jpg */
const MENU_PANEL_OPTS = { useMenuPhoto: true, forceMenuPhoto: true };

module.exports = {
    SECTION,
    NAV_HINT,
    MENU_PANEL_OPTS,
    doneKeyboard,
    appendNav,
    sectionKeyboard,
    instagramSectionKeyboard,
    instagramSectionFor,
    btnHub,
    btnMenu,
};
