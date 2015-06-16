var test        = require('tape'),
    levelup     = require('levelup'),
    sublevel    = require('level-sublevel'),
    memdown     = require('memdown'),
    _           = require('underscore'),
    transaction = require('../');

function newDB(){
  return sublevel( levelup({}, { db: memdown, valueEncoding: 'json' }) );
}

test('CRUD, isolation and defer',function(t){
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
test('Parallelism',function(t){
  t.plan(1);

  var n = 100;

  var db = newDB();
  transaction(db);

  function inc(){
    var tx = db.transaction();
    tx.defer(function(cb){
      tx.get('k', function(err, val){
        tx.put('k', (val || 0) + 1);
        setTimeout(cb, 10);
      });
    });
    tx.commit(function(){
      db.get('k', function(err, val){
        if(val === n)
          t.pass('Parallel increment');
      });
    });
  }
  _.range(n).forEach(inc);
});

test('Liveness',function(t){
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

test('SubLevel',function(t){
  t.plan(8);

  var db = newDB();
  transaction(db);

  function inc(sub, n){
    var tx = db.transaction({ prefix: sub });
    var tx2 = db.transaction({ prefix: sub });

    tx.put('k', n);
    sub.get('k', function(err, data){
      t.ok(err.notFound, 'notFound error');
      t.notOk(data, 'value not exists');
      tx.commit(function(){
        tx2.get('k', function(err, value){
          tx2.put('k', value + 1);
        });
        sub.get('k', function(err, data){
          t.equal(data, n, 'tx commit, value equals tx put');
          tx2.commit(function(err){
            sub.get('k', function(err, data){
              t.equal(data, n + 1, 'tx2 commit, value equals tx2 increment');
            });
          });
        });
      });
    });
  }

  inc(db.sublevel('sub'), 167);
  inc(db.sublevel('sub2'), 199);
});

test('Defer error', function(t){
  t.plan(3);

  var db = newDB();
  transaction(db);

  var tx = db.transaction();
  tx.put('foo', 'bar', function(err){
    t.notOk(err, 'no error before booom');
  });
  tx.defer(function(cb){
    setTimeout(cb.bind(null, 'booom'), 10);
  });
  tx.put('167', 199, function(err){
    t.error('should not continue after booom');
  });
  tx.commit(function(err){
    t.equal(err, 'booom', 'defer error');
    db.get('foo', function(err){
      t.ok(err.notFound, 'value not committed');
    });
  });
});
