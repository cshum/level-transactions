var tape         = require('tape'),
    levelup      = require('levelup'),
    down         = require('memdown'),
    _            = require('underscore'),
    transactions = require('../');

tape('Lock 100',function(t){
  t.plan(1);

  var db = levelup('test', {
    db: down,
    valueEncoding: 'json'
  });
  transactions(db);

  var tx = db.transaction();
  var tx2 = db.transaction();

  tx.put('k', 0);

  var n = 100;

  _.range(n).forEach(function(i){
    tx2.get('k', function(err, val){
      tx2.put('k', val + 1);
    });
  });

  tx.commit();

  tx2.commit(function(err){
    db.get('k', function(err, val){
      t.equal(val, n, n);
    });
  });
});
