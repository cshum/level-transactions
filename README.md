# level-transactions

Transaction manager for [LevelDB](https://github.com/rvagg/node-levelup): 
two-phase locking, snapshot isolation, atomic commits.
Works with [SublevelUP](https://github.com/cshum/sublevelup/).

[![Build Status](https://travis-ci.org/cshum/level-transactions.svg?branch=master)](https://travis-ci.org/cshum/level-transactions)

```bash
npm install level-transactions
```

```js
var level = require('level')
var db = level('./db', { valueEncoding: 'json' })

var transaction = require('level-transactions')

var tx = transaction(db)
var tx2 = transaction(db)

tx.del('k', function () {
  //k is locked by tx, tx2 gets k after tx commits
  tx2.get('k', function (err, value) {
    //tx2 increments k
    tx2.put('k', value + 1)
  })
})
tx.get('k', function (err) {
  //NotFoundError after tx del
})
tx.put('k', 167) //tx put value 167

tx.commit(function () {
  db.get('k', function (err, val) {
    //tx commit: val === 167
    tx2.commit(function () {
      db.get('k', function (err, val) {
        //tx2 commit: val === 168
      })
    })
  })
})

```

### Why LevelDB

LevelDB supports atomic batched operations. This is an important primitive for building solid database functionality with inherent consistency.
MongoDB, for example, does not hold such property for bulk operations, hence a wrapper like this would not be achievable.

### How it works
LevelDB methods are asynchronous.
level-transactions maintain stack + mutexes control to ensure linearizability:

1. Operation stack for sequential `get`, `put`, `del`, `defer` within a transaction.
2. Sublevel prefix + key hashed mutex for mutually exclusive operation during lock phase of transactions.
3. Upon acquiring locks, each transaction object holds a snapshot isolation. Results only persist upon successful commit, using `batch()` of LevelDB.

### Limitations
* Mutexes are held in-memory. This assumes typical usage of LevelDB, which runs on a single Node.js process. Usage on a distributed environment is not yet supported.
* "Range locks" with `createReadStream` is not yet supported.

## API

### transaction(db, [options])

Creates a transaction object. 
Accepts `options` of [LevelUP](https://github.com/Level/levelup#options) plus following:
* `ttl`: Time to live (milliseconds) of transaction object for liveness. Defaults to 20 seconds.

```js
var db = level('./db', { valueEncoding: 'json' })
var transaction = require('level-transactions')

var tx = transaction(db)
```

### tx.put(key, value, [options], [callback])

### tx.del(key, [options], [callback])

put/delete data into transaction object when lock acquired, 
will only be applied upon successful commit.
Accepts `options` of [LevelUP](https://github.com/Level/levelup#options).

### tx.get(key, [options], [callback])

`get()` fetches data from store when lock acquired, 
and callback with value or error.

All errors except `NotFoundError` will cause a rollback, as non-exist item is not considered an error in transaction.

### tx.defer(task)

Deferring execution order,
which adds an asynchronous `task` function to the transaction stack. 

`task` is provided with a `callback` function, should be invoked when the task has finished.

Callback with error argument will result in rollback of transaction.

```js
tx.put('foo', 'bar')
tx.get('foo', function (err, val) {
  //val === 'bar'
})
tx.defer(function (callback) {
  setTimeout(function () {
    tx.del('foo')
    callback() //execute next operation after callback
  }, 1000)
})
tx.get('foo', function (err, val) {
  //NotFoundError after del
})
```

### tx.commit([callback])

`commit()` commit operations and release locks acquired during transaction.

Uses levelup's `batch()` under the hood.
Changes are written to store atomically upon successful commit, or discarded upon error.


### tx.rollback([error], [callback])

`rollback()` release locks acquired during transaction. Can optionally specify `error`.
Changes are discarded and `commit()` callback with the specified error.

```js
tx.get('foo', function (err, val) {
  if(val) return tx.rollback(new Error('existed.'))
  tx.put('foo', 'bar')
})
tx.commit(function (err) {
  //if 'foo' exists, err [Error: existed.]
})

```

### Sublevel

Transaction works across [SublevelUP](https://github.com/cshum/sublevelup/) sections,
by initiating transaction with sublevel `transaction(sub)`, or by adding the `prefix: sub` property.

```js
var sublevel = require('sublevelup')
var db = sublevel(level('db'))
var sub = db.sublevel('sub')

var tx = transaction(db) // initiate with db
tx.put('foo', 'bar') // put db
tx.put('foo', 'foo', { prefix: sub }) // put sub
tx.get('foo', cb) // get db
tx.get('foo', { prefix: sub }, cb) // get sub

var tx2 = transaction(sub) // initiate with sublevel
tx.put('foo', 'hello') // put sub
tx.put('foo', 'world', { prefix: db }) // put db
tx.get('foo', cb) // get sub
tx.get('foo', { prefix: db }, cb) // get db

```

## License

MIT
