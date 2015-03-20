var tape         = require('tape'),
    levelup      = require('levelup'),
    down         = require('memdown'),
    transactions = require('../');

tape('1 Lock',function(t){
  t.plan(12);

  var db = levelup('test', {
    db: down,
    valueEncoding: 'json'
  });
  transactions(db);

  var tx = db.transaction();
  tx.get('k', function(err, value){
    t.notOk(value, 'no value for tx get');

    setTimeout(function(){
      tx.put('k',167, function(err){
        t.notOk(err, 'no error for tx put 167');
        db.get('k', function(err, value){
          t.notOk(value, 'no value for db get');
          tx.commit(function(err){
            t.notOk(err, 'no error for tx commit');
          });
        });
      });
    },100);
  });

  var tx2 = db.transaction();
  tx2.get('k', function(err, value){
    t.notOk(err, 'no error for tx2 get');
    t.equal(value, 167, 'tx2 get equals 167');

    tx2.put('k', value+1, function(err){
      t.notOk(err, 'no error for tx2 put +1');

      db.get('k', function(err, value){
        t.notOk(err, 'no error for db get');
        t.equal(value, 167, 'db get equals 167');

        tx2.commit(function(err){
          t.notOk(err, 'no error for tx2 commit');

          db.get('k', function(err, value){
            t.notOk(err, 'no error for db get');
            t.equal(value, 168, 'db get equals 168');
          });
        });
      });
    });
  });

});

tape('Async Lock',function(t){
  t.plan(5);

  var db = levelup('test2', {
    db: down,
    valueEncoding: 'json'
  });
  transactions(db);

  var tx = db.transaction();
  var tx2 = db.transaction();

  tx.put('k', 167);
  setTimeout(function(){
    tx.commit();
  }, 100);

  tx2.get('k', function(err, value){
    t.notOk(err, 'no error for tx2 get');
    t.equal(value, 167, 'tx2 get equals 167');

    tx2.put('k', value+1);
    tx2.commit(function(err){
      t.notOk(err, 'no error for tx2 commit');

      db.get('k', function(err, value){
        t.notOk(err, 'no error for db get');
        t.equal(value, 168, 'db get equals 168');
      });
    });
  });

});

tape('Defer lock',function(t){
  t.plan(5);

  var db = levelup('test3', {
    db: down,
    valueEncoding: 'json'
  });
  transactions(db);

  var tx = db.transaction();
  var tx2 = db.transaction();

  tx.put('k', 167);
  setTimeout(function(){
    tx.commit();
  }, 100);

  tx2.defer(function(cb){
    tx2.get('k', function(err, value){
      t.notOk(err, 'no error for tx2 get');
      t.equal(value, 167, 'tx2 get equals 167');

      tx2.put('k', value+1);
      cb();
    });
  });
  tx2.commit(function(err){
    t.notOk(err, 'no error for tx2 commit');

    db.get('k', function(err, value){
      t.notOk(err, 'no error for db get');
      t.equal(value, 168, 'db get equals 168');
    });
  });
});

