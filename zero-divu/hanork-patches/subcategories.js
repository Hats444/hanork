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
    { subcategory: 'Assinatura', patterns: [/\biptv\b/i, /\bcanva\b/i, /assinatura/i, /mensal/i, /anual/i, /xc\s*iptv/i, /painel/i] },
    { subcategory: 'Pacote', patterns: [/pacote/i, /package/i, /combo/i, /plano/i, /free\s*fire/i, /garena/i] },
    { subcategory: 'Diamantes', patterns: [/diamant/i, /diamond/i, /\bgems?\b/i] },
    { subcategory: 'Recarga', patterns: [/recarga/i, /top[\s-]?up/i, /cr[eé]dito/i] },
];

const SUBCATEGORIES_DISPLAY_ORDER = [
    'Seguidores', 'Curtidas', 'Visualizações', 'Comentários', 'Compartilhamentos',
    'Stories', 'Membros', 'Inscritos', 'Reações', 'Lives',
    'Assinatura', 'Pacote', 'Diamantes', 'Recarga', 'Outros',
];

module.exports = { SUBCATEGORY_RULES, SUBCATEGORIES_DISPLAY_ORDER };
