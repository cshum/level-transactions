# level-async-transaction

Transaction layer for [LevelDB](https://github.com/rvagg/node-levelup) and [level-sublevel](https://github.com/dominictarr/level-sublevel). 
Uses Two-Phase Commit approach, applies locks on per key basis, atomic commits and rollbacks for levelup. Compatible with level-sublevel prefix.

**This module is still under active development. Use with caution.**

[![Build Status](https://travis-ci.org/cshum/level-async-transaction.svg?branch=master)](https://travis-ci.org/cshum/level-async-transaction)

```bash
npm install level-async-transaction
```

```js
var levelup = require('levelup');
var db = levelup('./db',{ valueEncoding: 'json' });

var transaction = require('level-async-transaction');
transaction(db);

var tx = db.transaction();

tx.put('k', 167);
setTimeout(function(){
  tx.commit();
},100);

var tx2 = db.transaction();

tx2.get('k', function(err, value){
  tx2.put('k', value + 1);
  tx2.commit(function(){
    db.get('k', function(err, data){
      //data now equals to 168
    });
  });
});
```

##Why LevelDB

Despite being a simple key-value store, LevelDB supports atomic batched operations. This is an important primitive for building solid database functionality with inherent consistency.
MongoDB, for example, does not hold such property for bulk operations, hence a wrapper like this would not be possible.

`level-async-transaction` gives a foundation for building an asynchronous, transactional data store with LevelDB on Node.js.

##How it works?
Levelup API methods are asynchronous.
level-async-transaction maintains a two-level async mutexes to ensure sequential ordering of operations:

* 1st level: transaction mutex ensures mutually exclusive access of key + sublevel prefix during lock phase of transaction.
* 2nd level: operation mutex ensures sequential operations of `get`, `put`, `del` within the transaction.

Upon acquiring two-level mutex, operations are isolated within each transaction object. Results will only persist upon successful commit, built on `batch()` of LevelDB.


##Limitations
* This assumes typical usage of LevelDB, which runs on a single node.js process. Usage in a distributed environment is currently not supported.
* Only `get`, `put`, `del` methods available for transaction. "Range locks" for createReadStream is not currently supported.

##API

###db.transaction([options])

Create a transaction object. Takes an optional `options` argument, accepts properties from [levelup options](https://github.com/rvagg/node-levelup#options) and [level-sublevel prefix](https://github.com/dominictarr/level-sublevel#hooks-example).

###tx.get(key[, options][, callback])

`get()` fetches data from store or transaction object if lock acquired. 

It acquires a lock for `key`, and callback with value or `NotFoundError` only when lock successfully acquired. 

###tx.put(key, value[, options][, callback])

`put()` inserts data into transaction object, 
and will only be inserted into store upon successful commit. 

It acquires lock for the `key`, callback only when lock acquired. `callback` function is optional as `commit()` handles all the asynchronous logic.

###tx.del(key[, options][, callback])

`del()` removes data from transaction object, 
and will only be removed from store upon successful commit. 

It acquires lock for the `key`, callback only when lock acquired. `callback` function is optional as `commit()` handles all the asynchronous logic.

###tx.commit([callback])

`commit()` wait for all locks to be acquired, then batches data from transaction object into the store.

Upon successful commit, operations will be written to store atomically. 
Rollback on error.
Uses levelup's `batch()` under the hood.

Locks acquired during transaction will be released on both success or error.

###tx.rollback([callback])

`rollback()` releases locks acquired during transaction.

This method is optional as locks are automatically released in case of `commit()` error.

###tx.defer(task)

Utility function for deferring commit,
which adds an asynchronous `task` function to the transaction queue. 

This is useful when achieving "nested transaction" kind of control flow.

`task` will be called with a callback argument, should be invoked when the task has finished.

Callback with error argument will result in error on commit, hence rollback of transaction.

```js
var levelup = require('levelup');
var db = levelup('./db',{ valueEncoding: 'json' });
transactions(db);

var tx = db.transaction();

tx.put('k', 167);
setTimeout(function(){
  tx.commit();
}, 100);

var tx2 = db.transaction();

//defer additional tasks
tx2.defer(function(cb){
  tx2.get('k', function(err, value){
    tx2.put('k', value+1);
    cb();
  });
});
tx2.commit(function(err){
  db.get('k', function(err, value){
    //data now equals to 168
  });
});
```

## License

MIT
