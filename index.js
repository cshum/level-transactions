var _      = require('underscore'),
    anchor = require('anchorjs'),
    params = anchor.params;

function hash(key, opts){
  var prefix = 0;
  if(opts && opts.prefix && _.isFunction(opts.prefix.prefix))
    prefix = opts.prefix.prefix();
  return JSON.stringify([prefix, key]);
}

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
    ctx.hash = hash(ctx.params.key, ctx.params.opts);

    var _locked = this._locked;
    if(_locked[ctx.hash]){
      process.nextTick(job);
      return;
    }

    function job(err){
      if(!err)
        _locked[ctx.hash] = true;
      next(err);
    }
    job.tx = this;

    if(this._map.hasOwnProperty(ctx.hash)){
      ctx.current = this._map[ctx.hash];
    }else{
      var i, j, l;

      if(queued[ctx.hash]){
        for(i = 0, l = queued[ctx.hash].length; i < l; i++){
          var tx = queued[ctx.hash][i].tx;
          // if(tx === this){
          //   this._job();
          //   return;
          // }
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
        process.nextTick(job);
        // job();
      }
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
        key: key,
        value: value
      }, opts));

      this._map[ ctx.hash ] = value;

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
        key: key
      }, opts));

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
