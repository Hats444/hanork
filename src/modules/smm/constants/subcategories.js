'use strict';

const SUBCATEGORY_RULES = [
    { subcategory: 'Seguidores', patterns: [/seguidor/i, /followers?/i, /\bfollow\b/i] },
    { subcategory: 'Curtidas', patterns: [/curtida/i, /\blikes?\b/i] },
    { subcategory: 'Visualizações', patterns: [/visualiza/i, /\bviews?\b/i, /reprodu/i] },
    { subcategory: 'Comentários', patterns: [/coment/i, /comments?/i] },
    { subcategory: 'Compartilhamentos', patterns: [/compartilh/i, /shares?/i] },
    { subcategory: 'Stories', patterns: [/stor/i] },
    { subcategory: 'Membros', patterns: [/membro/i, /members?/i] },
    { subcategory: 'Reações', patterns: [/reaç/i, /reactions?/i] },
    { subcategory: 'Lives', patterns: [/\blive/i, /ao\s*vivo/i] },
    { subcategory: 'Inscritos', patterns: [/inscrit/i, /subscriber/i] },
];

const SUBCATEGORIES_DISPLAY_ORDER = [
    'Seguidores', 'Curtidas', 'Visualizações', 'Comentários', 'Compartilhamentos',
    'Stories', 'Membros', 'Inscritos', 'Reações', 'Lives', 'Outros',
];

module.exports = { SUBCATEGORY_RULES, SUBCATEGORIES_DISPLAY_ORDER };
