var _         = require('underscore'),
    ginga     = require('ginga'),
    params    = ginga.params,
    queue     = require('queue-async');

function semaphore(n){
  if(!(this instanceof semaphore))
    return new semaphore(n);
  this._q = [];
  this._taken = 0;
  this._n = n || 1;
}
var s = semaphore.prototype;
s.take = function(fn){
  if(this._taken < this._n){
    this._taken++;
    process.nextTick(fn);
  }else
    this._q.push(fn);
  return this;
};
s.leave = function(){
  if(this._q.length > 0){
    process.nextTick(this._q.shift());
  }else{
    if(this._taken === 0)
      throw new Error('leave called too many times.');
    this._taken--;
  }
  return this;
};

module.exports = function( db ){

  var count = 0, map = {};

  function mutual(hash){
    map[hash] = map[hash] || semaphore(1);
    return map[hash];
  }

  function Transaction(options){
    this.db = db;
    this.options = options;
    this._id = count;
    count++;

    this._released = false;

    this._wait = {};
    this._taken = {};
    this._map = {};
    this._batch = [];

    this._q = queue(1);
    this.defer = this._q.defer.bind(this._q);

    // this._deps = {};
  }

  function pre(ctx, next){
    //options object
    ctx.options = _.defaults({}, ctx.params.opts, this.options);

    //check sublevel
    if(ctx.options && ctx.options.prefix && 
      typeof ctx.options.prefix.sublevel === 'function')
      ctx.prefix = ctx.options.prefix;

    //key + sublevel prefix hash
    ctx.hash = JSON.stringify(
      ctx.prefix ? [ctx.prefix.prefix(), ctx.params.key] : ctx.params.key
    );

    next();
  }
  function lock(ctx, next, end){
    var self = this;

    if(this._released)
      return next(new Error('Transaction has already been committed/rollback.'));

    var plan = 0;
    function invoke(){
      plan--; if(plan === 0) next();
    }
    var q = queue();

    if(!this._wait[ctx.hash]){
      //gain mutually exclusive access for transaction
      
      var mu = mutual(ctx.hash);
      plan++;
      mu.take(function(){
        if(self._released){
          mu.leave();
          return;
        }
        self._taken[ctx.hash] = true;
        invoke();
      });
      this._wait[ctx.hash] = semaphore(1);
    }
    var wait = this._wait[ctx.hash];

    plan++;
    wait.take(invoke);

    end(function(err){
      if(err && !err.notFound){ 
        //Error that abort transaction
        self.rollback();
        return;
      }
      wait.leave(); //relase wait
    });
  }

  function get(ctx, done){
    if(ctx.hash in this._map){
      done(null, this._map[ctx.hash]);
      return;
    }
    var self = this;

    (ctx.prefix || db).get(ctx.params.key, _.defaults(
      {}, ctx.params.opts, this.options
    ), function(err, val){
      self._map[ctx.hash] = val;
      done(err, val);
    });
  }

  function put(ctx, done){
    this._batch.push(_.defaults({
      type: 'put',
      key: ctx.params.key,
      value: ctx.params.value
    }, ctx.options));

    this._map[ctx.hash] = ctx.params.value;

    done(null);
  }

  function del(ctx, done){
    this._batch.push(_.defaults({
      type: 'del',
      key: ctx.params.key
    }, ctx.options));

    this._map[ctx.hash] = undefined;

    done(null);
  }

  function commit(ctx, next, end){
    var self = this;

    var plan = 0;
    function invoke(){
      plan--;
      if(plan === 0)
        db.batch(self._batch, function(err, res){
          if(err) next(err); 
          else next();
        });
    }

    this._q.awaitAll(function(err){
      if(err)
        return next(err);
      plan = _.size(self._wait);
      _.invoke(self._wait, 'take', invoke);
    });

    end(function(err){
      //rollback on commit error
      if(err)
        self.rollback();
    });
  }

  //release after rollback, commit
  function release(ctx, done){
    this._released = true;

    _.each(this._taken, function(t, hash){
      mutual(hash).leave();
    });

    delete this._wait;
    delete this._taken;
    delete this._map;
    delete this._batch;
    done(null);
  }

  ginga(Transaction.prototype)
    .define('get', params('key','opts?'), pre, lock, get)
    .define('put', params('key','value','opts?'), pre, lock, put)
    .define('del', params('key','opts?'), pre, lock, del)
    .define('rollback', release)
    .define('commit', commit, release);

  db.transaction = db.transaction || function(options){
    return new Transaction(options);
  };
  return db;
};
