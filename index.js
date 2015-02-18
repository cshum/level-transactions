var _      = require('underscore'),
    anchor = require('anchorjs'),
    params = anchor.params;

module.exports = function( db ){
  var id       = 0;
  var queued   = {};

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
      // process.nextTick(job);
      next();
      return;
    }
    if(this._waiting[ctx.hash]){
      //todo: add callback to job queue
      return;
    }

    var job = function(err){
      if(err) 
        return next(err);
      self._locked[ctx.hash] = true;
      delete self._waiting[ctx.hash];
      next();
    }
    job.tx = this;
    this._waiting[ctx.hash] = job;

    var i, j, l;

    if(queued[ctx.hash]){
      //hash queued; check deadlock and push queue
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
      //no queue in hash; run immediately
      queued[ctx.hash] = [];
      job();
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
        var job = queued[hash].shift();
        // process.nextTick(job);
        job();
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
