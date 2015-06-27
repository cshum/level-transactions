var test        = require('tape'),
    levelup     = require('levelup'),
    sublevel    = require('level-sublevel'),
    memdown     = require('memdown'),
    _           = require('underscore'),
    transaction = require('../');

function newDB(){
  return sublevel( levelup({}, {
    db: memdown, 
    keyEncoding: 'utf8',
    valueEncoding: 'json' 
  }) );
}

test('CRUD, isolation and defer',function(t){
  t.plan(8);

  var db = newDB();

  var tx = transaction(db);
  var tx2 = transaction(db);

  tx.del('k', function(){
    tx2.get('k', function(err, value){
      t.equal(value, 167, 'get value after tx commits');
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
        t.notOk(val, 'after tx2 defer del');
      });
      tx2.put('k', value + 1);
    });
  });
  tx.put('k', 167);

  db.get('k', function(err, data){
    t.ok(err.notFound, 'notFound error');
    t.notOk(data, 'value not exists');
    tx.commit(function(){
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

test('SubLevel and Codec',function(t){
  t.plan(6);

  var db = newDB();

  var tx = transaction(db, {
    prefix: db.sublevel('a'),
    keyEncoding: 'json',
    valueEncoding: 'json'
  });

  var val = [456, '789'];
  tx.put(123, val, function(){
    val.push('on9'); //should not change put
  });

  tx.get('123', function(err, val){
    t.ok(err.notFound, 'non exist key notFound');
  });
  tx.get('123', { keyEncoding: 'utf8', valueEncoding: 'utf8' }, function(err, val){
    t.equal(val, JSON.stringify([456,'789']), 'valueEncoding');
  });
  tx.put(123, [167,'199'], { prefix: db.sublevel('b')});
  tx.get(123, { prefix: db.sublevel('b') }, function(err, val){
    t.deepEqual(val, [167,'199'], 'sublevel');
  });
  tx.commit(function(){
    db.sublevel('a').get('123', function(err, val){
      t.deepEqual(val, [456,'789'], 'sublevel a committed');
      var tx = transaction(db, { prefix: db.sublevel('a') });
      tx.get('123', function(err, val){
        t.deepEqual(val, [456,'789'], 'sublevel a get');
      });
      tx.commit();
    });
    db.sublevel('b').get('123', function(err, val){
      t.deepEqual(val, [167,'199'], 'sublevel b committed');
    });
  });
});

test('Parallelism',function(t){
  t.plan(1);

  var n = 100;

  var db = newDB();

  function inc(){
    var tx = transaction(db);
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
  t.plan(6);

  var db = newDB();

  var tx = transaction(db, {ttl: 500});
  var tx2 = transaction(db, {ttl: 500});

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
  setTimeout(function(){
    var tx3 = transaction(db);
    tx3.put('a', 'foo');
    tx3.put('b', 'bar');
    tx3.commit(function(err){
      db.get('a', function(err, value){
        t.equal(value, 'foo', 'tx3 put success');
      });
      db.get('b', function(err, value){
        t.equal(value, 'bar', 'tx3 put success');
      });
    });
  }, 100);
});

test('Defer error', function(t){
  t.plan(4);

  var db = newDB();

  var tx = transaction(db);
  var tx2 = transaction(db);
  tx.put('foo', 'bar', function(err){
    t.notOk(err, 'no error before booom');
    tx2.put('foo', 'boo');
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
      t.ok(err.notFound, 'tx not committed');
      tx2.commit(function(){
        db.get('foo', function(err, val){
          t.equal(val, 'boo', 'tx2 committed');
        });
      });
    });
  });
});

test('Rollback', function(t){
  t.plan(4);

  var db = newDB();

  var tx = transaction(db);
  var tx2 = transaction(db);
  tx.put('foo', 'bar', function(err){
    tx2.put('foo','boo');
    t.notOk(err, 'no error before booom');
    tx.rollback('booom');
  });
  tx.put('167', 199, function(err){
    t.error('should not continue after booom');
  });
  tx.commit(function(err){
    t.equal(err, 'booom', 'defer error');
    db.get('foo', function(err){
      t.ok(err.notFound, 'tx not committed');
      tx2.commit(function(){
        db.get('foo', function(err, val){
          t.equal(val, 'boo', 'tx2 committed');
        });
      });
    });
  });
});
