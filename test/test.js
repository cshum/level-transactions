var tape         = require('tape'),
    levelup      = require('levelup'),
    down         = require('memdown'),
    transactions = require('../');

tape('Read Lock',function(t){
  t.plan(12);

  var db = levelup('test', {
    db: down,
    valueEncoding: 'json'
  });
  transactions(db);

  var tx = db.transaction();
  tx.get('a', function(err, value){
    t.notOk(value, 'no value for tx get');

    setTimeout(function(){
      tx.put('a',167, function(err){
        t.notOk(err, 'no error for tx put 167');
        db.get('a', function(err, value){
          t.notOk(value, 'no value for db get');
          tx.commit(function(err){
            t.notOk(err, 'no error for commit');
          });
        });
      });
    },100);
  });

  var tx2 = db.transaction();
  tx2.get('a', function(err, value){
    t.notOk(err, 'no error for tx2 get');
    t.equal(value, 167, 'tx2 get equals 167');

    tx2.put('a', value+1, function(err){
      t.notOk(err, 'no error for put +1');

      db.get('a', function(err, value){
        t.notOk(err, 'no error for db get');
        t.equal(value, 167, 'db get equals 167');

        tx2.commit(function(err){
          t.notOk(err, 'no error for commit');

          db.get('a', function(err, value){
            t.notOk(err, 'no error for db get');
            t.equal(value, 168, 'db get equals 168');
          });
        });
      });
    });
  });

});

