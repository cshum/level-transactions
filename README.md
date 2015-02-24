# level-async-transaction

Async transactional layer for [levelup](https://github.com/rvagg/node-levelup) and [level-sublevel](https://github.com/dominictarr/level-sublevel). 
Uses Two-Phase Commit approach that applies read-lock and write-lock for `get`, `del`, `put` methods.

[![Build Status](https://travis-ci.org/cshum/level-async-transaction.svg?branch=master)](https://travis-ci.org/cshum/level-async-transaction)

