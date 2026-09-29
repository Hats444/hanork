require('./app/bootstrap').runPreBoot();

const { createBotContext } = require('./bot/createBotContext');
const { bootstrapHanorkBot, buildFinalizeDeps } = require('./bot/bootstrapHanorkBot');
const { createExpressApp } = require('./app/createServer');
const { finalizeBotBootstrap } = require('./bot/bootstrap/finalizeBot');

const ctx = createBotContext();
const runtime = bootstrapHanorkBot(ctx);

const HTTP_PORT = parseInt(process.env.PORT || '3000', 10);
const expressApp = createExpressApp({
    bot: runtime.bot,
    prisma: ctx.prisma,
    logger: ctx.logger,
    deferBackground: ctx.deferBackground,
    webhookPaymentDedup: ctx.webhookPaymentDedup,
});

finalizeBotBootstrap(buildFinalizeDeps(ctx, runtime, expressApp, HTTP_PORT));
