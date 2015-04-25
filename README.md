# level-async-transaction

Transaction layer for [LevelDB](https://github.com/rvagg/node-levelup) . 
Uses Two-Phase Commit approach, applies locks on per key basis, atomic commits and rollbacks for LevelDB. Compatible with [level-sublevel](https://github.com/dominictarr/level-sublevel) prefix.

**This module is still under active development. Use with caution.**

[![Build Status](https://travis-ci.org/cshum/level-async-transaction.svg?branch=master)](https://travis-ci.org/cshum/level-async-transaction)

```bash
npm install level-async-transaction
```

```js
var levelup = require('levelup');
var db = levelup('./db',{ valueEncoding: 'json' });

require('level-async-transaction')(db);

var tx = db.transaction();
var tx2 = db.transaction();

tx.put('k', 167);

tx.commit(function(){
  tx2.get('k', function(err, value){
    tx2.put('k', value + 1);
  });
  db.get('k', function(err, data){
    //tx commit: data equals to 167

    tx2.commit(function(){
      db.get('k', function(err, data){
        //tx2 commit: data equals to 168
      });
    });
  });
});

```

##Why LevelDB

LevelDB supports atomic batched operations. This is an important primitive for building solid database functionality with inherent consistency.
MongoDB, for example, does not hold such property for bulk operations, hence a wrapper like this would not be possible.

##How it works
Levelup API methods are asynchronous.
level-async-transaction maintains a queue + mutex control to ensure sequential ordering, mutually exclusive access of operations:

* 1st level: operation queue ensures sequential operations of `get`, `put`, `del`, `defer` within the transaction.
* 2nd level: transaction mutex ensures mutually exclusive access of key + sublevel prefix during lock phase of transaction.

Upon acquiring two-level mutex, operations are isolated within each transaction object. Results will only persist upon successful commit, using `batch()` of LevelDB.

##Limitations
* Mutex are handled in-memory. This assumes typical usage of LevelDB, which runs on a single Node.js process. Usage in a distributed environment is not yet supported.
* Only `get`, `put`, `del` methods available for transaction. "Range locks" for `createReadStream` is not yet implemented.

##API

###db.transaction([options])

Create a transaction object. Takes an optional `options` argument, accepts properties from [levelup options](https://github.com/rvagg/node-levelup#options) and [level-sublevel prefix](https://github.com/dominictarr/level-sublevel#hooks-example).

###tx.get(key, [options], [callback])

`get()` fetches data from store when lock acquired, 
and callback with value or error.

All errors except `NotFoundError` will cause a rollback, as non-exist item is not considered an error in transaction.

###tx.put(key, value, [options], [callback])

`put()` inserts/updates data into transaction object when lock acquired, 
will only be applied into store upon successful commit. 
Any errors will cause a rollback.

###tx.del(key, [options], [callback])

`del()` removes data from transaction object, 
will only be applied upon successful commit. 
Any errors will cause a rollback.

###tx.defer(fn)

Utility function for deferring commit,
which adds an asynchronous `fn` function to the transaction queue. 

`fn` is provided with a `callback` function, should be invoked when the task has finished.

Callback with error argument will result in rollback of transaction.

```js
tx.get('k', function(err, value){
  tx.defer(function(callback){
    asyncTask(value, function(err, result){
      if(err)
        return callback(err);
      tx.put('k', result);
      callback();
    });
  });
});
```

###tx.commit([callback])

`commit()` commits operations and releases locks acquired during transaction.

Uses levelup's `batch()` under the hood.
Changes are written to store atomically upon successful commit, or discarded upon error.


###tx.rollback([error], [callback])

`rollback()` releases locks acquired during transaction. Can optionally specify `error`.

```js
tx.get('foo', function(err, val){
  if(val) 
    return tx.rollback(new Error('foo existed'));
  tx.put('foo','bar');
});
```


## License

MIT
