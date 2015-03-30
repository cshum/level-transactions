var _      = require('underscore'),
    ginga  = require('ginga'),
    queue  = require('queue-async'),
    params = ginga.params;

function Wait(parent){
  this._parent = parent;
  this._stack = [];
}
var W = Wait.prototype;
W.parent = function(){
  return this._parent;
};
W.add = function(fn){
  this._stack.push(fn);
  return this;
};
W.invoke = function(){
  _.invoke(this._stack, 'apply', null, arguments);
  this._stack = [];
  return this;
};
W.ended = function(){
  return this._stack.length === 0;
};

module.exports = function( db ){
  var count    = 0,
      queued   = {};

  function Transaction(options){
    this.db = db;
    this.options = options;
    this._id = count;
    count++;

    this._q = queue();
    this.defer = this._q.defer.bind(this._q);

    this._wait = {};
    this._map = {};
    this._deps = {};
    this._batch = [];
  }

  //lock during get, put, del
  function lock(ctx, next){
    //options object
    ctx.options = _.defaults({}, ctx.params.opts, this.options);

    //check sublevel
    if(ctx.options && ctx.options.prefix && 
      typeof ctx.options.prefix.sublevel === 'function')
      ctx.prefix = ctx.options.prefix;

    ctx.hash = JSON.stringify(ctx.params.key);
    //key + sublevel prefix hash
    if(ctx.prefix)
      ctx.hash = JSON.stringify([ctx.prefix.prefix(), ctx.params.key]);

    var wait = this._wait[ctx.hash];
    if(wait){
      if(wait.ended()){
        //skip if lock acquired
        next();
      }else{
        //not done waiting -> add to wait list
        wait.add(next);
      }
    }else{
      wait = new Wait(this).add(next);
      var i, j, l;

      if(queued[ctx.hash]){
        //check deadlock and push queue
        for(i = 0, l = queued[ctx.hash].length; i < l; i++){
          var tx = queued[ctx.hash][i].parent();
          if(tx._deps[this._id]){
            wait.invoke(new Error('Deadlock'));
            return;
          }
          this._deps[tx._id] = true;
          for(j in tx._deps)
            this._deps[j] = true;
        }
        queued[ctx.hash].push(wait);
      }else{
        //no queue in hash; lock immediately
        queued[ctx.hash] = [];
        wait.invoke();
      }
      this._wait[ctx.hash] = wait;
    }
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

  function commit(ctx, next){
    var self = this;

    //defer waiting locks
    for(var hash in this._wait){
      var wait = this._wait[hash];
      var add = wait.add.bind(wait);
      if(!wait.ended())
        this._q.defer(add);
    }
    this._q.awaitAll(function(err){
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
    var hash, wait;
    for(hash in this._wait){
      wait = this._wait[hash];
      if(wait.ended()){
        if(queued[hash].length > 0){
          queued[hash].shift().invoke();
        }else{
          delete queued[hash];
        }
      }else{
        //clean up waiting jobs
        var idx = queued[hash].indexOf(this._wait[hash]);
        if(idx > -1)
          queued[hash].splice(idx, 1);
      }
      delete this._wait[hash];
    }

    done(null);
  }

  ginga(Transaction.prototype)
    .define('get', params('key','opts?'), lock, get)
    .define('put', params('key','value','opts?'), lock, put)
    .define('del', params('key','opts?'), lock, del)
    .define('rollback', release)
    .define('commit', commit, release);

  db.transaction = db.transaction || function(options){
    return new Transaction(options);
  };
  return db;
};
