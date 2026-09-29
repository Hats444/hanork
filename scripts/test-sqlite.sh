#!/usr/bin/env bash
export PATH="${HOME}/.nvm/versions/node/v20.20.2/bin:${PATH}"
cd /home/vendetta/hanork
node -e 'require("better-sqlite3")(":memory:")' && echo HANORK_OK
cd /home/vendetta/hanork/zero-divu
node -e 'require("better-sqlite3")(":memory:")' && echo ZERO_OK
