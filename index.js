var _      = require('underscore'),
    anchor = require('anchorjs'),
    params = anchor.params;

module.exports = function( db ){
  var id       = 0;
  var queued   = {};

  function Wait(parent){
    this._parent = parent;
    this._stack = [];
  }
  Wait.prototype.parent = function(){
    return this._parent;
  }
  Wait.prototype.add = function(fn){
    this._stack.push(fn);
    return this;
  }
  Wait.prototype.invoke = function(){
    _.invoke(this._stack, 'call');
    this._stack = [];
    return this;
  }
  Wait.prototype.ended = function(){
    return this._stack.length === 0;
  }


  function Transaction(){
    this._id = id;
    id++;

    this._wait = {};
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

    var wait = this._wait[ctx.hash];
    if(wait){
      if(wait.ended()){
        //skip if lock acquired
        next();
      }else{
        //not done waiting -> add to wait list
        wait.add(next);
      }
      return;
    }
    
    wait = new Wait(this).add(next);

    var i, j, l;

    if(queued[ctx.hash]){
      //hash queued; check deadlock and push queue
      for(i = 0, l = queued[ctx.hash].length; i < l; i++){
        var tx = queued[ctx.hash][i].parent();
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
      wait.invoke();
    }
    this._wait[ctx.hash] = wait;
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
    }

    this._wait = {};
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
