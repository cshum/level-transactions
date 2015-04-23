var tape         = require('tape'),
    levelup      = require('levelup'),
    down         = require('memdown'),
    transactions = require('../');

tape('Defer Error',function(t){
  t.plan(6);

  var db = levelup('test', {
    db: down,
    valueEncoding: 'json'
  });
  transactions(db);

  var txE = db.transaction();
  var tx = db.transaction();
  var tx2 = db.transaction();

  tx.put('k', 167);
  tx.commit();

  txE.put('k', 0);
  txE.defer(function(cb){
    setTimeout(function(){
      cb(new Error('booom'));
    }, 100);
  });
  txE.commit(function(err){
    t.ok(err, 'error on txE commit');
  });

  tx2.get('k', function(err, value){
    t.notOk(err, 'no error for tx2 get');
    t.equal(value, 167, 'tx2 get equals 167');

    tx2.put('k', value+1);
  });

  tx2.commit(function(err){
    t.notOk(err, 'no error for tx2 commit');

    db.get('k', function(err, value){
      t.notOk(err, 'no error for db get');
      t.equal(value, 168, 'db get equals 168');
    });
  });
});

tape('tx Error',function(t){
  t.plan(4);

  var db = levelup('test', {
    db: down,
    valueEncoding: 'json'
  });
  transactions(db);

  var txE = db.transaction();
  var tx = db.transaction();
  var tx2 = db.transaction();

  tx.put('k', 167);
  tx.commit();

  txE.put('k', 0);
  txE.get('k', function(err, val){
    txE.rollback('booom');
    txE.put('k', 0);
  });
  txE.commit(function(err){
    t.equal(err, 'booom', 'error on txE commit');
  });

  tx2.get('k', function(err, value){
    tx2.put('k', value+1);
  });

  tx2.commit(function(err){
    t.notOk(err, 'no error for tx2 commit');

    db.get('k', function(err, value){
      t.notOk(err, 'no error for db get');
      t.equal(value, 168, 'db get equals 168');
    });
  });
});

