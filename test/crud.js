var tape         = require('tape'),
    levelup      = require('levelup'),
    down         = require('memdown'),
    transactions = require('../');

tape('Locking',function(t){
  t.plan(10 * 2);

  var db = levelup('test.json', {
    db: down,
    valueEncoding: 'json'
  });
  transactions(db);

  var tx = db.transaction();
  tx.get('a', function(err, value){
    setTimeout(function(){
      tx.put('a',167, function(err){
        db.get('a', function(err, value){
          tx.commit(function(err){
            db.get('a', function(err, value){
            });
          });
        });
      });
    },100);
  });

  var tx2 = db.transaction();
  tx2.get('a', function(err, value){
    tx2.put('a', value+1, function(err){
      db.get('a', function(err, value){
        tx2.commit(function(err){
          db.get('a', function(err, value){
          });
        });
      });
    });
  });

});

