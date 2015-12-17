var test = require('tape')
var levelup = require('levelup')
var sublevel = require('sublevelup')
var leveldown = require('leveldown')
var transaction = require('../')
var lock = require('2pl')

require('rimraf').sync('test/db')

var db = sublevel(levelup('test/db', {
  db: leveldown,
  keyEncoding: 'utf8',
  valueEncoding: 'json'
}))
var count = 0
function newDB (opts) {
  return db.sublevel(String(count++), opts)
}

function crud (t, db) {
  var tx = transaction(db)
  var tx2 = transaction(db)
  tx.on('end', function (err) {
    t.notOk(err, 'tx end no error')
  })
  tx2.on('end', function (err) {
    t.notOk(err, 'tx2 end error')
  })

  tx.del('k', function () {
    tx2.get('k', function (err, value) {
      t.notOk(err)
      t.equal(value, 167, 'get value after tx commits')
      tx2.put('k', 'bla')
      tx2.get('k', function (err, val) {
        t.notOk(err)
        t.equal(val, 'bla', 'after tx2 put')
      })
      tx2.defer(function (cb) {
        setTimeout(function () {
          tx2.del('k')
          cb()
        }, 100)
      })
      // tx queue follows order defer > del > get
      tx2.get('k', function (err, val) {
        t.ok(err.notFound, 'tx2 notFound error')
        t.notOk(val, 'after tx2 defer del')
      })
      tx2.put('k', value + 1)
    })
  })
  tx.put('k', 167)

  db.get('k', function (err, data) {
    t.ok(err.notFound, 'notFound error')
    t.notOk(data, 'value not exists')
    tx.commit(function (err) {
      t.notOk(err)
      db.get('k', function (err, data) {
        t.notOk(err)
        t.equal(data, 167, 'tx commit, value equals tx put')
        tx2.commit(function (err) {
          t.notOk(err)
          db.get('k', function (err, data) {
            t.notOk(err)
            t.equal(data, 168, 'tx2 commit, value equals tx2 increment')
            t.end()
          })
        })
      })
    })
  })
}

test('CRUD', function (t) {
  crud(t, newDB())
})

test('CRUD custom 2PL', function (t) {
  var createLock = lock.creator()
  crud(t, newDB({ createLock: createLock }))

  var l = createLock()
  setTimeout(function () {
    t.ok(Object.keys(l._shared).length, 'Lock exists')
    l.release()
  }, 50)
})

test('Prefix and Codec', function (t) {
  t.plan(11)

  var db = newDB()

  var tx = transaction(db, {
    prefix: db.sublevel('a'),
    keyEncoding: 'json',
    valueEncoding: 'json'
  })

  var val = [456, '789']
  tx.put(123, val, function () {
    val.push('on9') // should not change put
  })

  tx.get('123', function (err, val) {
    t.ok(err.notFound, 'non exist key notFound')
  })
  tx.get('123', {
    keyEncoding: 'utf8', valueEncoding: 'utf8'
  }, function (err, val) {
    t.notOk(err)
    t.equal(val, JSON.stringify([456, '789']), 'valueEncoding')
  })
  tx.put(123, [167, '199'], { prefix: db.sublevel('b') })
  tx.get(123, { prefix: db.sublevel('b') }, function (err, val) {
    t.notOk(err)
    t.deepEqual(val, [167, '199'], 'sublevel')
  })
  tx.commit(function () {
    db.sublevel('a').get('123', function (err, val) {
      t.notOk(err)
      t.deepEqual(val, [456, '789'], 'sublevel a committed')
      var tx = transaction(db, { prefix: db.sublevel('a') })
      tx.get('123', function (err, val) {
        t.notOk(err)
        t.deepEqual(val, [456, '789'], 'sublevel a get')
      })
      tx.commit()
    })
    db.sublevel('b').get('123', function (err, val) {
      t.notOk(err)
      t.deepEqual(val, [167, '199'], 'sublevel b committed')
    })
  })
})

test('Parallelism', function (t) {
  t.plan(2)

  var i
  var n = 100

  var db = newDB()
  var sub = db.sublevel('sub')

  function inc () {
    var tx
    if (i < 50) {
      // wrapping sublevel
      tx = transaction(sub)
      tx.defer(function (cb) {
        tx.get('foo', function (err, val) {
          tx.put('foo', (err ? 0 : val) + 1)
          setTimeout(cb, 10)
        })
      })
    } else {
      // wrapping base db, sublevel prefix
      tx = transaction(db)
      tx.get('foo', { prefix: sub }, function (err, val) {
        tx.put('foo', (err ? 0 : val) + 1, { prefix: sub })
      })
    }
    tx.commit(function () {
      sub.get('foo', function (err, val) {
        if (val === n) {
          t.notOk(err)
          t.pass('Parallel increment')
        }
      })
    })
  }
  for (i = 0; i < n; i++) inc()
})

test('TTL', function (t) {
  t.plan(10)

  var db = newDB()

  var tx = transaction(db, {ttl: 500})
  var tx2 = transaction(db, {ttl: 500})

  tx.get('a', function () {
    tx.defer(function (cb) {
      setTimeout(cb, 100)
    })
    tx.put('b', 167)
  })

  tx2.get('b', function () {
    tx.defer(function (cb) {
      setTimeout(cb, 100)
    })
    tx2.put('a', 167)
  })

  tx.commit(function (err) {
    t.ok(err.TIMEOUT, 'error timeout')
    db.get('b', function (err, value) {
      t.ok(err.notFound)
      t.notOk(value, 'tx no put')
    })
  })
  tx2.commit(function (err) {
    t.ok(err.TIMEOUT, 'error timeout')
    db.get('a', function (err, value) {
      t.ok(err.notFound)
      t.notOk(value, 'tx2 no put')
    })
  })
  setTimeout(function () {
    var tx3 = transaction(db)
    tx3.put('a', 'foo')
    tx3.put('b', 'bar')
    tx3.commit(function () {
      db.get('a', function (err, value) {
        t.notOk(err)
        t.equal(value, 'foo', 'tx3 put success')
      })
      db.get('b', function (err, value) {
        t.notOk(err)
        t.equal(value, 'bar', 'tx3 put success')
      })
    })
  }, 100)
})

test('Lock()', function (t) {
  t.plan(6)

  var db = newDB()

  var tx = transaction(db)
  var tx2 = transaction(db)

  // both must get foo access before anything else,
  // will not deadlock at a b
  tx.lock('foo')
  tx2.lock('foo')

  tx.get('a', function () {
    tx.defer(function (cb) {
      setTimeout(cb, 100)
    })
    tx.put('b', 167)
  })

  tx2.get('b', function () {
    tx.defer(function (cb) {
      setTimeout(cb, 100)
    })
    tx2.put('a', 167)
  })

  tx.commit(function (err) {
    t.notOk(err, 'tx commit success')
    db.get('b', function (err, value) {
      t.notOk(err)
      t.equal(value, 167, 'tx put')
    })
  })
  tx2.commit(function (err) {
    t.notOk(err, 'tx2 commit success')
    db.get('a', function (err, value) {
      t.notOk(err)
      t.equal(value, 167, 'tx2 put')
    })
  })
})

test('Unsafe', function (t) {
  t.plan(6)

  var db = newDB()

  var tx = transaction(db)
  var tx2 = transaction(db)

  // both must get foo access before anything else,
  tx.lock('foo')
  tx2.lock('foo')

  tx.get('a', function () {
    tx.put('b', 167, {unsafe: true})
  })

  tx2.get('b', function () {
    tx2.put('a', 167, {unsafe: true})
  })

  tx.commit(function (err) {
    t.notOk(err, 'tx commit success')
    db.get('b', function (err, value) {
      t.notOk(err)
      t.equal(value, 167, 'tx put')
    })
  })
  tx2.commit(function (err) {
    t.notOk(err, 'tx2 commit success')
    db.get('a', function (err, value) {
      t.notOk(err)
      t.equal(value, 167, 'tx2 put')
    })
  })
})

test('Defer error', function (t) {
  t.plan(6)

  var db = newDB()

  var tx = transaction(db)
  var tx2 = transaction(db)
  tx.put('foo', 'bar', function (err) {
    t.notOk(err, 'no error before booom')
    tx2.put('foo', 'boo')
  })
  tx.defer(function (cb) {
    setTimeout(cb.bind(null, 'booom'), 10)
  })
  tx.on('end', function (err) {
    t.equal(err, 'booom', 'end error')
  })
  tx.put('167', 199, function (err) {
    t.error(err, 'should not continue after booom')
  })
  tx.commit(function (err) {
    t.equal(err, 'booom', 'defer error')
    db.get('foo', function (err) {
      t.ok(err.notFound, 'tx not committed')
      tx2.commit(function () {
        db.get('foo', function (err, val) {
          t.notOk(err)
          t.equal(val, 'boo', 'tx2 committed')
        })
      })
    })
  })
})

test('Rollback', function (t) {
  t.plan(6)

  var db = newDB()

  var tx = transaction(db)
  var tx2 = transaction(db)
  tx.on('end', function (err) {
    t.equal(err, 'booom', 'end error')
  })
  tx.put('foo', 'bar', function (err) {
    tx2.put('foo', 'boo')
    t.notOk(err, 'no error before booom')
    tx.rollback('booom')
  })
  tx.put('167', 199, function (err) {
    t.error(err, 'should not continue after booom')
  })
  tx.commit(function (err) {
    t.equal(err, 'booom', 'defer error')
    db.get('foo', function (err) {
      t.ok(err.notFound, 'tx not committed')
      tx2.commit(function () {
        db.get('foo', function (err, val) {
          t.notOk(err)
          t.equal(val, 'boo', 'tx2 committed')
        })
      })
    })
  })
})
