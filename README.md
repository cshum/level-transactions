# level-transactions

Transaction layer for Node.js [LevelDB](https://github.com/rvagg/node-levelup).

[![Build Status](https://travis-ci.org/cshum/level-transactions.svg?branch=master)](https://travis-ci.org/cshum/level-transactions)

```bash
npm install level-transactions
```

level-transactions provides a in-memory locking mechanism for key based operations, isolation and atomic commits.
Also works across sublevels using [SublevelUP](https://github.com/cshum/sublevelup/).

level-transaction@2 rewrite introduces full compatibility with all common methods of [LevelUP](https://github.com/Level/levelup).

## API

#### `tx = transaction(db, [options])`

Creates a transaction object. 
Accepts `options` of [LevelUP](https://github.com/Level/levelup#options) plus following:
* `ttl`: Time to live (milliseconds) of transaction object for liveness. Default to 20 seconds.

```js
var db = level('./db', { valueEncoding: 'json' })
var transaction = require('level-transactions')

var tx = transaction(db)
```

Transaction instance inherits LevelUP,
so one can expect all common methods of [LevelUP](https://github.com/Level/levelup#api) can be used with same behaviour.
The difference comes where key based operations are linearizable. Also result set are isolated within transaction, only persists atomically upon `.commit()` or discarded on `.rollback()`.

### Key Based Operations

* [**`tx.put(key, value, [options], [callback])`**](https://github.com/Level/levelup#put)
* [**`tx.get(key, [options], [callback])`**](https://github.com/Level/levelup#get)
* [**`tx.del(key, [options], [callback])`**](https://github.com/Level/levelup#del)
* [**`tx.batch(array, [options], [callback])`**](https://github.com/Level/levelup#batch)

Key based operations perform exclusive lock on keys applied.
Under the hood, it maintains an internal queue such that operations within transaction executed sequentially.

Keys acquired during lock phase of transaction ensure mutually exclusive access.
This makes `.get()` followed by a `.put()` a safe update operation.

All errors except `NotFoundError` will cause a rollback, as non-exist item is not considered an error in transaction.

```js
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

### Range Based Operations

* [**`tx.createReadStream([options])`**](https://github.com/Level/levelup#createReadStream)
* [**`tx.createKeyStream([options])`**](https://github.com/Level/levelup#createKeyStream)
* [**`tx.createValueStream([options])`**](https://github.com/Level/levelup#createValueStream)

Range based operations in level-transactions do NOT perform any locking.
Instead it adopts LevelDOWN's behaviour, [implicit snapshot](https://github.com/level/leveldown/#snapshots) at the time a read stream created.

This returns merged result set from database with write operations applied within transaction.

```js
db.batch([
  {type: 'put', key: 'a', value: 'a'},
  {type: 'put', key: 'b', value: 'b'},
  {type: 'put', key: 'c', value: 'c'}
], function (err) {
  db.createKeyStream().on('data', ...) // 'a', 'b', 'c'
  ...

  var tx = transaction(db)
  tx.batch([
    {type: 'del', key: 'a'}
    {type: 'put', key: 'd', value: 'd'}
  ], function (err) {
    tx.createKeyStream().on('data', ...) // 'b', 'c', 'd'
    ...
  })

  var tx2 = transaction(db)
  tx2.batch([
    {type: 'put', key: '0', value: '0'}
    {type: 'del', key: 'b'}
  ], function (err) {
    tx2.createKeyStream().on('data', ...) // '0', 'a', 'c'
    ...
  })
})
```

### Transaction Specific

#### `tx.commit([callback])`

Commit writes, release locks acquired and close transaction.

Uses levelup's `batch()` under the hood.
Changes are written to store atomically upon successful commit, or discarded upon error.

#### `tx.rollback([error], [callback])`

Release locks acquired and close transaction. Can optionally specify `error`.
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

#### `tx.defer(fn)`

Utility method for deferring execution order,
which adds an asynchronous function `fn(cb)` to the internal queue. 
Callback `cb(err)` with error argument will result in rollback of transaction.

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

...
```

## License

MIT
