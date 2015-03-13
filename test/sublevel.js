var tape         = require('tape'),
    levelup      = require('levelup'),
    sublevel     = require('level-sublevel'),
    down         = require('memdown'),
    transactions = require('../');


tape('Sublevel Lock',function(t){
  t.plan(10);

  var db = sublevel(levelup('test', {
    db: down,
    valueEncoding: 'json'
  }));
  var sub = db.sublevel('sub');
  var sub2 = db.sublevel('sub2');

  transactions(db);

  var tx = db.transaction();
  var tx2 = db.transaction();

  tx.put('k',167, {prefix: sub});
  setTimeout(function(){
    tx.commit();
  }, 100);

  tx2.get('k',{prefix: sub}, function(err, value){
    t.notOk(err, 'no error for tx2 get');
    t.equal(value, 167, 'tx2 get equals 167');

    tx2.put('k', value+1, {prefix: sub});
    tx2.commit(function(err){
      t.notOk(err, 'no error for tx2 commit');

      sub.get('k', function(err, value){
        t.notOk(err, 'no error for sub get');
        t.equal(value, 168, 'sub get equals 168');
      });
    });
  });

  var tx3 = db.transaction();
  var tx4 = db.transaction();

  tx3.put('k',199, {prefix: sub2});
  setTimeout(function(){
    tx3.commit();
  }, 100);

  tx4.get('k',{prefix: sub2}, function(err, value){
    t.notOk(err, 'no error for tx4 get');
    t.equal(value, 199, 'tx4 get equals 199');

    tx4.put('k', value+1, {prefix: sub2});
    tx4.commit(function(err){
      t.notOk(err, 'no error for tx4 commit');

      sub2.get('k', function(err, value){
        t.notOk(err, 'no error for sub2 get');
        t.equal(value, 200, 'sub2 get equals ');
      });
    });
  });

});

