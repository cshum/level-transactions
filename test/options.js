var tape         = require('tape'),
    levelup      = require('levelup'),
    down         = require('memdown'),
    transactions = require('../');

tape('Options',function(t){
  t.plan(12);

  var db = levelup('test', {
    db: down,
    valueEncoding: 'utf8'
  });
  transactions(db);

  var tx = db.transaction({
    valueEncoding: 'json'
  });
  tx.get('k', function(err, value){
    t.notOk(value, 'no value for tx get');

    setTimeout(function(){
      tx.put('k', 167, function(err){
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

  var tx2 = db.transaction({
    valueEncoding: 'json'
  });
  tx2.get('k', function(err, value){
    t.notOk(err, 'no error for tx2 get');
    t.equal(value, 167, 'tx2 get equals 167');

    tx2.put('k', value+1, function(err){
      t.notOk(err, 'no error for tx2 put +1');

      db.get('k', function(err, value){
        t.notOk(err, 'no error for db get');
        t.equal(value, '167', 'db get equals string 167');

        tx2.commit(function(err){
          t.notOk(err, 'no error for tx2 commit');

          db.get('k', function(err, value){
            t.notOk(err, 'no error for db get');
            t.equal(value, '168', 'db get equals string 168');
          });
        });
      });
    });
  });

});
