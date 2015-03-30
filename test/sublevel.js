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

  transactions(db);
  var sub = db.sublevel('sub');
  var sub2 = db.sublevel('sub2');

  var tx = db.transaction({prefix: sub});
  var tx2 = db.transaction({prefix: sub});
  var tx3 = db.transaction({prefix: sub2});
  var tx4 = db.transaction({prefix: sub2});

  tx.put('k',167);
  tx3.put('k',199);

  setTimeout(tx.commit.bind(tx), 100);
  setTimeout(tx3.commit.bind(tx3), 100);

  tx2.get('k',function(err, value){
    t.notOk(err, 'no error for tx2 get');
    t.equal(value, 167, 'tx2 get equals 167');

    tx2.put('k', value+1);
    tx2.commit(function(err){
      t.notOk(err, 'no error for tx2 commit');

      sub.get('k', function(err, value){
        t.notOk(err, 'no error for sub get');
        t.equal(value, 168, 'sub get equals 168');
      });
    });
  });

  tx4.get('k',function(err, value){
    t.notOk(err, 'no error for tx4 get');
    t.equal(value, 199, 'tx4 get equals 199');

    tx4.put('k', value+1);
    tx4.commit(function(err){
      t.notOk(err, 'no error for tx4 commit');

      sub2.get('k', function(err, value){
        t.notOk(err, 'no error for sub2 get');
        t.equal(value, 200, 'sub2 get equals ');
      });
    });
  });

});

