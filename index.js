var _      = require('underscore'),
    anchor = require('anchorjs'),
    params = anchor.params;

module.exports = function( db ){
  var id       = 0;
  var queued   = {};

  function Wait(tx, hash){
    this._tx = tx;
    this._hash = hash;
    this._stack = [];

    tx._waiting[hash] = this;
  }
  Wait.prototype.add = function(fn){
    this._stack.push(fn);
    return this;
  }
  Wait.prototype.done = function(){
    this._tx._locked[this._hash] = true;
    delete this._tx._waiting[this._hash];
    _.invoke(this._stack, 'call');
    return this;
  }


  function Transaction(){
    this._id = id;
    id++;

    this._locked = {};
    this._waiting = {};
    this._map = {};
    this._deps = {};
    this._batch = [];
  }

  var T = anchor(Transaction.prototype);

  //lock middleware during get, put, del
  function lock(ctx, next){
    var self = this;

    //prefix + key hash
    ctx.hash = 
      ctx.params.opts &&
      typeof ctx.params.opts.prefix === 'function' ? 
        [ ctx.params.opts.prefix(), ctx.params.key ].toString():
        ctx.hash = ctx.params.key.toString();

    //skip if lock acquired
    if(this._locked[ctx.hash]){
      next();
      return;
    }
    //already waiting -> add to wait list
    if(this._waiting[ctx.hash]){
      this._waiting[ctx.hash].add(next);
      return;
    }
    
    var wait = new Wait(this, ctx.hash).add(next);

    var i, j, l;

    if(queued[ctx.hash]){
      //hash queued; check deadlock and push queue
      for(i = 0, l = queued[ctx.hash].length; i < l; i++){
        var tx = queued[ctx.hash][i]._tx;
        if(tx._deps[this._id]){
          next(new Error('Deadlock'));
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
      wait.done();
    }
  }

  T.define(
    'get', 
    params('key', 'opts?'),
    lock,
    function(ctx, done){
      var self = this;

      var _db = 
        ctx.params.opts && 
        ctx.params.opts.prefix && 
        typeof opts.prefix.get === 'function' ? 
          opts.prefix : db;

      _db.get(
        ctx.params.key, 
        ctx.params.opts, 
        function(err, value){
          self._map[ ctx.hash ] = value;
          done.apply(this, arguments);
        }
      );
    }
  );

  T.define(
    'put',
    params('key', 'value', 'opts?'),
    lock,
    function(ctx, done){
      this._batch.push(_.extend({
        type: 'put',
        key: ctx.params.key,
        value: ctx.params.value
      }, ctx.params.opts));

      this._map[ ctx.hash ] = ctx.params.value;

      done(null);
    }
  );


  T.define(
    'del',
    params('key', 'opts?'),
    lock,
    function(ctx, done){
      this._batch.push(_.extend({
        type: 'del',
        key: ctx.params.key
      }, ctx.params.opts));

      delete this._map[ ctx.hash ];

      done(null);
    }
  );

  //release middleware during rollback, commit
  function release(ctx, done){
    var hash;
    for(hash in this._locked){
      if(queued[hash].length > 0){
        queued[hash].shift().done();
      }else{
        delete queued[hash];
      }
    }
    //clean up waiting jobs
    for(hash in this._waiting){
      var idx = queued[hash].indexOf(this._waiting[hash]);
      if(idx > -1)
        queued[hash].splice(idx, 1);
    }

    this._locked = {};
    this._waiting = {};
    this._map = {};
    this._deps = {};
    this._batch = [];

    done(null);
  }

  T.define(
    'rollback',
    release
  );

  T.define(
    'commit',
    function(ctx, next){
      db.batch(this._batch, function(err){
        if(err) next(err); 
        else next();
      });
    },
    release
  );

  db.transaction = db.transaction || function(){
    return new Transaction();
  };
  return db;
};
