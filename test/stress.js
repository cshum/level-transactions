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
  tx.put('k', 0);
  tx.commit();

  var n = 100;

  _.range(n).forEach(function(i){
    var tx = db.transaction();
    tx.get('k', function(err, val){
      tx.put('k', val + 1);
      setTimeout(function(){
        tx.commit(function(err){
          if(i === n - 1)
            db.get('k', function(err, val){
              t.equal(val, n, n);
            });
        });
      },0);
    });
  });
});
