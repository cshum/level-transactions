var _      = require('underscore'),
    anchor = require('anchorjs'),
    params = anchor.params;

module.exports = function( db ){
  var id       = 0;
  var queued   = {};

  function Transaction(){
    this._id = id.toString(36);
    id++;

    this._locked = {};
    this._map = {};
    this._deps = {};
    this._batch = [];
  }

  var T = anchor(Transaction.prototype);

  function lock(ctx, next){
    var self = this;

    //get prefix + key hash
    ctx.hash = ctx.params.key.toString();
    if(ctx.params.opts &&
      typeof ctx.params.opts.prefix === 'function')
      ctx.hash = [ ctx.params.opts.prefix(), ctx.params.key ].toString();

    //skip if lock acquired
    if(this._locked[ctx.hash]){
      // process.nextTick(job);
      next();
      return;
    }

    //queue job
    function job(err){
      if(err) return next(err);
      self._locked[ctx.hash] = true;
      next();
    }
    job.tx = this;

    var i, j, l;

    if(queued[ctx.hash]){
      for(i = 0, l = queued[ctx.hash].length; i < l; i++){
        var tx = queued[ctx.hash][i].tx;
        if(tx._deps[this._id]){
          job(new Error('Deadlock'));
          return this;
        }
        this._deps[tx._id] = true;
        for(j in tx._deps)
          this._deps[j] = true;
      }
      queued[ctx.hash].push(job);
    }else{
      queued[ctx.hash] = [];
      // process.nextTick(job);
      job();
    }
  }

  // var T = Transaction.prototype;
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

  function release(ctx, done){
    for(var hash in this._locked){
      if(queued[hash].length > 0){
        var job = queued[hash].shift();
        process.nextTick(job);
        // job();
      }else{
        delete queued[hash];
      }
    }

    this._locked = {};
    this._deps = {};
    this._map = {};
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
