'use strict';

/**
 * Hanork AI Core — B4 (V4.1 prompt registry · V4.3 provider hub · V4.4 tools).
 */
const promptRegistry = require('./promptRegistry');
const toolRegistry = require('./toolRegistry');
const providerHub = require('./providerHub');

function isAiCoreEnabled() {
    const v = String(process.env.HANORK_AI_CORE ?? '1').trim().toLowerCase();
    return v !== '0' && v !== 'false';
}

function buildPlannerPrompt(text, ctx = {}) {
    const actionsList = require('../hanorkGateway/ActionRegistry').formatForPlanner();
    const toolsList = toolRegistry.formatForPlanner({ adminOnly: !!ctx.isAdmin });
    const rulesBlock =
        promptRegistry.getPrompt('planner.rules', {}, promptRegistry.promptVersion()) || '';
    const contextBlock = ctx.contextBlock || '';

    const fromRegistry = promptRegistry.getPrompt(
        'planner.system',
        {
            isAdmin: !!ctx.isAdmin,
            inPrivate: !!ctx.inPrivate,
            message: String(text || '').slice(0, 500),
            contextBlock,
            toolsList,
            actionsList,
            rulesBlock,
        },
        promptRegistry.promptVersion()
    );

    if (fromRegistry) return fromRegistry;

    return (
        `[PAPEL] Planejador Hanork\n[MENSAGEM] ${text}\n[AÇÕES]\n- ${actionsList}\n` +
        `[FORMATO] {"action":"nome","params":{},"confidence":0-100}`
    );
}

module.exports = {
    isAiCoreEnabled,
    ...promptRegistry,
    ...toolRegistry,
    ...providerHub,
    buildPlannerPrompt,
    promptRegistry,
    toolRegistry,
    providerHub,
};
