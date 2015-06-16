var tape        = require('tape'),
    levelup     = require('levelup'),
    down        = require('memdown'),
    transaction = require('../');

function newDB(){
  return levelup({}, { db: down, valueEncoding: 'json' });
}

tape('CRUD, isolation and defer',function(t){
  t.plan(7);

  var db = newDB();
  transaction(db);

  var tx = db.transaction();
  var tx2 = db.transaction();

  tx.put('k', 167);

  db.get('k', function(err, data){
    t.ok(err.notFound, 'notFound error');
    t.notOk(data, 'value not exists');
    tx.commit(function(){
      tx2.get('k', function(err, value){
        tx2.put('k', 'bla');
        tx2.get('k', function(err, val){
          t.equal(val, 'bla', 'after tx2 put');
        });
        tx2.defer(function(cb){
          setTimeout(function(){
            tx2.del('k');
            cb();
          }, 100);
        });
        //tx queue follows order defer > del > get
        tx2.get('k', function(err, val){
          t.ok(err.notFound, 'tx2 notFound error');
          t.notOk(data, 'after tx2 defer del');
        });
        tx2.put('k', value + 1);
      });
      db.get('k', function(err, data){
        t.equal(data, 167, 'tx commit, value equals tx put');
        tx2.commit(function(err){
          db.get('k', function(err, data){
            t.equal(data, 168, 'tx2 commit, value equals tx2 increment');
          });
        });
      });
    });
  });
});

tape('Liveness',function(t){
  t.plan(4);

  var db = newDB();
  transaction(db, {ttl: 500});

  var tx = db.transaction();
  var tx2 = db.transaction();

  tx.get('a', function(err, val){
    tx.defer(function(cb){
      setTimeout(cb, 100);
    });
    tx.put('b', 167);
  });

  tx2.get('b', function(err, val){
    tx.defer(function(cb){
      setTimeout(cb, 100);
    });
    tx2.put('a', 167);
  });

  tx.commit(function(err){
    t.ok(err.txTimeout, 'error timeout');
    db.get('b', function(err, value){
      t.notOk(value, 'tx no put');
    });
  });
  tx2.commit(function(err){
    t.ok(err.txTimeout, 'error timeout');
    db.get('a', function(err, value){
      t.notOk(value, 'tx2 no put');
    });
  });
});
