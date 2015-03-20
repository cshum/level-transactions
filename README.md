# level-async-transaction

Transaction layer for [levelup](https://github.com/rvagg/node-levelup) and [level-sublevel](https://github.com/dominictarr/level-sublevel). 
Uses Two-Phase Commit approach, applies locks on per key basis, atomic commits and rollbacks for levelup database. Compatible with level-sublevel prefix.

[![Build Status](https://travis-ci.org/cshum/level-async-transaction.svg?branch=master)](https://travis-ci.org/cshum/level-async-transaction)

```bash
npm install level-async-transaction
```

```Javascript
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

###db.transaction()

Create a transaction object.

###tx.get(key[, options][, callback])

`get()` fetches data from store, or transaction object if lock acquired. 

It acquires a lock for `key`, and callback with value or `NotFoundError` only when lock successfully acquired. 
Otherwise if read lock failed due to potential deadlock, callback with error Deadlock.

###tx.put(key, value[, options][, callback])

`put()` inserts data into transaction object, 
and will only be inserted into store upon successful commit. 

It acquires a lock for the `key`, and callback only when lock acquired.
Otherwise if write lock failed due to potential deadlock, callback with error Deadlock.

###tx.del(key[, options][, callback])

`del()` removes data from transaction object, 
and will only be removed from store upon successful commit. 

It acquires a lock for the `key`, and callback only when lock acquired.
Otherwise if lock failed due to potential deadlock, callback with error Deadlock.

###tx.commit([callback])

`commit()` wait for all locks to be acquired, then batches data from transaction object into the store.
Uses levelup's `batch()` under the hood, 
all operations will be written to the database atomically, that is, they will either all succeed or fail with no partial commits.

Upon successful or failed commit, locks acquired during transaction will be released.
Otherwise if lock failed due to potential deadlock, callback with error Deadlock.

###tx.rollback([callback])

`rollback()` releases locks acquired during transaction.

###tx.defer(task)

Utility function for deferring commit,
which adds an asynchronous `task` function to the transaction queue. 
The `task` will be called with a callback argument, which should be invoked when the task has finished.
```Javascript

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
