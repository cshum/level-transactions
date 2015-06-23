var extend       = require('extend'),
    EventEmitter = require('events').EventEmitter,
    ginga        = require('ginga'),
    semaphore    = require('./semaphore'),
    levelErrors  = require('level-errors'),
    Codec        = require('level-codec'),
    Queue        = require('./queue'),
    error        = require('./error'),
    params       = ginga.params;

module.exports = function(db, _opts){
  var mutex = {};

  function Transaction(opts){
    this.db = db;
    this.options = extend({
      ttl: 20 * 1000
    }, db.options, _opts, opts);

    this._released = false;

    this._codec = new Codec(this.options);
    this._taken = {};
    this._map = {};
    this._notFound = {};
    this._batch = [];
    
    Queue.call(this);
    EventEmitter.call(this);

    this._timeout = setTimeout(
      this.release.bind(this, error.TX_TIMEOUT),
      this.options.ttl
    );
  }

  extend(
    Transaction.prototype, 
    Queue.prototype, 
    EventEmitter.prototype
  );

  function pre(ctx, next, end){
    if(this._released)
      return next(this._error || error.TX_RELEASED);

    next();
  }

  function lock(ctx, next, end){
    var self = this;

    //options object
    ctx.options = extend({}, this.options, ctx.params.opts);

    //check sublevel
    if(ctx.options && ctx.options.prefix && 
      typeof ctx.options.prefix.sublevel === 'function')
      ctx.prefix = ctx.options.prefix;

    //key + sublevel prefix hash
    ctx.hash = (ctx.prefix ? JSON.stringify(ctx.prefix.prefix()) : '') + '!' +
      String(this._codec.encodeKey(ctx.params.key, ctx.options));

    this.defer(function(cb){
      if(self._taken[ctx.hash]){
        next();
      }else{
        //gain mutually exclusive access to transaction
        var mu = mutex[ctx.hash] = mutex[ctx.hash] || semaphore(1);
        mu.take(function(){
          if(self._released){
            mu.leave();
            return;
          }
          self._taken[ctx.hash] = true;
          next();
        });
      }

      end(cb);
    });

  }

  function get(ctx, done){
    if(this._notFound[ctx.hash])
      return done(new levelErrors.NotFoundError(
        'Key not found in transaction [' + ctx.params.key + ']'
      ));
    if(ctx.hash in this._map)
      return done(null, this._codec.decodeValue(
        this._map[ctx.hash], ctx.options));

    var self = this;
    (ctx.prefix || db).get(ctx.params.key, ctx.options, function(err, val){
      if(self._released) 
        return;
      if(err && err.notFound){
        self._notFound[ctx.hash] = true;
        delete self._map[ctx.hash];
      }else{
        self._map[ctx.hash] = self._codec.encodeValue(val, ctx.options);
      }
      done(err, val);
    });
  }

  function put(ctx, done){
    var enKey = this._codec.encodeKey(ctx.params.key, ctx.options);
    var enVal = this._codec.encodeValue(ctx.params.value, ctx.options);
    this._batch.push(extend(ctx.options, {
      type: 'put',
      key: enKey,
      value: enVal,
      keyEncoding: 'utf8',
      valueEncoding: 'utf8'
    }));

    this._map[ctx.hash] = enVal;
    delete this._notFound[ctx.hash];

    this.emit('put', ctx.params.key, ctx.params.value);

    done(null);
  }

  function del(ctx, done){
    var enKey = this._codec.encodeKey(ctx.params.key, ctx.options);
    this._batch.push(extend(ctx.options, {
      type: 'del',
      key: enKey,
      keyEncoding: 'utf8'
    }));

    delete this._map[ctx.hash];
    this._notFound[ctx.hash] = true;

    this.emit('del', ctx.params.key);

    done(null);
  }

  function commit(ctx, next, end){
    var self = this;
    var done = false;

    end(function(err){
      //rollback on commit error
      if(err)
        self.rollback();
    });
    this.on('release', function(err){
      if(!done) next(err);
    });
    this.done(function(err){
      done = true;
      if(err)
        return next(err);
      db.batch(self._batch, function(err, res){
        if(err) next(err); 
        else next();
      });
    });
  }

  //release after rollback, commit
  function release(ctx, done){
    clearTimeout(this._timeout);

    if(ctx.params && ctx.params.error)
      this._error = ctx.params.error;

    for(var hash in this._taken){
      mutex[hash].leave();
      if(mutex[hash].empty())
        delete mutex[hash];
    }

    delete this.options;
    delete this._codec;
    delete this._taken;
    delete this._map;
    delete this._batch;
    delete this._notFound;

    this._released = true;
    this.emit('release', this._error);
    done(this._error);
  }

  ginga(Transaction.prototype)
    .define('get', params('key','opts?'), pre, lock, get)
    .define('put', params('key','value','opts?'), pre, lock, put)
    .define('del', params('key','opts?'), pre, lock, del)
    .define('rollback', params('error?'), pre, release)
    .define('release', params('error?'), pre, release)
    .define('commit', pre, commit, release);

  db.transaction = db.transaction || function(options){
    return new Transaction(options);
  };
  return db;
};
