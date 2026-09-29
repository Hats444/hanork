/**
 * State Module - Persistência de estado temporário
 */

module.exports = {
    RedisState: require('./RedisState'),
    StateManager: require('./StateManager').StateManager,
    getRedisState: () => require('./RedisState').getInstance(),
    getStateManager: () => require('./StateManager').StateManager.getInstance()
};
