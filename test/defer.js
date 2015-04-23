var tape         = require('tape'),
    levelup      = require('levelup'),
    down         = require('memdown'),
    transactions = require('../');

tape('Defer lock',function(t){
  t.plan(5);

  var db = levelup('test', {
    db: down,
    valueEncoding: 'json'
  });
  transactions(db);

  var tx = db.transaction();
  var tx2 = db.transaction();

  tx.put('k', 167);

  tx2.get('k', function(err, value){
    tx2.defer(function(cb){
      setTimeout(function(){
        t.notOk(err, 'no error for tx2 get');
        t.equal(value, 167, 'tx2 get equals 167');

        tx2.put('k', value+1);
        cb();
      },100);
    });
  });
  tx.commit();
  tx2.commit(function(err){
    t.notOk(err, 'no error for tx2 commit');

    db.get('k', function(err, value){
      t.notOk(err, 'no error for db get');
      t.equal(value, 168, 'db get equals 168');
    });
  });
});


