# level-transactions

Transaction manager for [LevelDB](https://github.com/rvagg/node-levelup): 
two-phase locking, snapshot isolation, atomic commits. Supports [level-sublevel](https://github.com/dominictarr/level-sublevel) prefix.

[![Build Status](https://travis-ci.org/cshum/level-transactions.svg?branch=master)](https://travis-ci.org/cshum/level-transactions)

```bash
npm install level-transactions
```

```js
var levelup = require('levelup');
var db = levelup('./db',{ valueEncoding: 'json' });

require('level-transactions')(db);

var tx = db.transaction();
var tx2 = db.transaction();

tx.del('k', function(){
  //k is locked; tx2 can access after tx commits
  tx2.get('k', function(err, value){
    //tx2 increments k
    tx2.put('k', value + 1);
  });
});
tx.get('k', function(err){
  //NotFoundError after tx del
});
tx.put('k', 167); //tx put value 167

tx.commit(function(){
  db.get('k', function(err, val){
    //tx commit: val equals to 167
    tx2.commit(function(){
      db.get('k', function(err, val){
        //tx2 commit: val equals to 168
      });
    });
  });
});

```

###Why LevelDB

LevelDB supports atomic batched operations. This is an important primitive for building solid database functionality with inherent consistency.
MongoDB, for example, does not hold such property for bulk operations, hence a wrapper like this would not be possible.

###How it works
LevelDB methods are asynchronous.
level-transactions maintain queue + mutex to ensure sequential ordering, mutually exclusive access of operations on a per key basis:

1. Operation queue for sequential `get`, `put`, `del`, `defer` within a transaction.
2. Sublevel prefix + key hashed mutex for mutually exclusive operation during lock phase of transactions.

Upon acquiring queue + mutex, each transaction object holds a snapshot isolation. Results will only persist upon successful commit, using `batch()` of LevelDB.

###Limitations
* Mutexes are held in-memory. This assumes typical usage of LevelDB, which runs on a single Node.js process. Usage in a distributed environment is not yet supported.
* Only `get`, `put`, `del` methods are available for transaction. "Range locks" with `createReadStream` is not yet implemented.

##API

###db.transaction([options])

Create a transaction object. Takes an optional `options` argument, accepts properties from [levelup options](https://github.com/rvagg/node-levelup#options) plus following:
* `prefix`: [level-sublevel prefix](https://github.com/dominictarr/level-sublevel#hooks-example).
* `ttl`: TTL (milliseconds) of each transaction object for liveness. Default to 20 seconds.

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

Deferring execution order,
which adds an asynchronous `fn` function to the transaction queue. 

`fn` is provided with a `callback` function, should be invoked when the task has finished.

Callback with error argument will result in rollback of transaction.

```js
tx.put('foo', 'bar');
tx.get('foo', function(err, val){
  //val === 'bar'
});
tx.defer(function(callback){
  setTimeout(function(){
    tx.del('foo');
    callback(); //execute next operation after callback
  }, 1000);
});
tx.get('foo', function(err, val){
  //NotFoundError after del
});
```

###tx.commit([callback])

`commit()` commit operations and release locks acquired during transaction.

Uses levelup's `batch()` under the hood.
Changes are written to store atomically upon successful commit, or discarded upon error.


###tx.rollback([error], [callback])

`rollback()` release locks acquired during transaction. Can optionally specify `error`.

###Sublevel Prefix
Transaction works across [level-sublevel](https://github.com/dominictarr/level-sublevel) sections under the same database by adding the `prefix` property.
```js
var tx = db.transaction();
var sub = db.sublevel('sub');

tx.put('foo', 'bar');
tx.put('foo', 'boo', { prefix: sub });
tx.get('foo', function(err, val){
  //val === 'bar'
});
tx.get('foo', { prefix: sub }, function(err, val){
  //val === 'boo'
});
tx.commit(function(){
  db.get('foo', function(err, val){
    //val === 'bar'
  });
  sub.get('foo', function(err, val){
    //val === 'boo'
  });
});
```


## License

MIT
