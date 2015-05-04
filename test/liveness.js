var tape         = require('tape'),
    levelup      = require('levelup'),
    down         = require('memdown'),
    transactions = require('../');

tape('Liveness',function(t){
  t.plan(4);

  var db = levelup('test', {
    db: down,
    valueEncoding: 'json'
  });
  transactions(db, {ttl: 500});

  var tx = db.transaction();
  var tx2 = db.transaction();

  tx.get('a', function(err, val){
    tx.put('b', val + 1);
  });

  tx2.get('b', function(err, val){
    tx2.put('a', val+1);
  });

  tx.commit(function(err){
    t.ok(err, 'error timeout');
    db.get('b', function(err, value){
      t.notOk(value, 'no put');
    });
  });
  tx2.commit(function(err){
    t.ok(err, 'error timeout');
    db.get('a', function(err, value){
      t.notOk(value, 'no put');
    });
  });
});
