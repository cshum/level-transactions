var _ = require('underscore');

function hash(key, opts){
  var prefix = 0;
  if(opts && opts.prefix && _.isFunction(opts.prefix.prefix))
    prefix = opts.prefix.prefix();
  return JSON.stringify([prefix, key]);
}

module.exports = function( db ){
  var id       = 0;
  var locked   = {};

  function Transaction(){
    this._jobs = {};
    this._id = id.toString(36);
    id++;

    this._deps = {};
    this._map = {};
    this._batch = [];

  }
  var T = Transaction.prototype;

  T.get = function(key, opts, cb){
    cb = cb || opts || function(){};
    opts = _.isFunction(opts) ? undefined: opts;

    var self = this;
    var _db = opts && opts.prefix && _.isFunction(opts.prefix.get) ? opts.prefix : db;
    var hashed = hash(key, opts);

    if(this._map.hasOwnProperty(hashed))
      cb(null, this._map[hashed]);
    else
      this._lock(hashed, function(err){
        if(err) return cb(err);
        _db.get(key, opts, function(err, value){
          self._map[hashed] = value;
          cb(err, value);
        });
      });
    return this;
  };

  T.put = function(key, value, opts, cb){
    cb = cb || opts || function(){};
    opts = _.isFunction(opts) ? undefined: opts;

    this._batch.push(_.extend({
      type: 'put',
      key: key,
      value: value
    }, opts));

    this._map[ hash(key, opts) ] = value;

    cb(null);
    return this;
  };

  T.del = function(key, opts, cb){
    cb = cb || opts || function(){};
    opts = _.isFunction(opts) ? undefined: opts;

    this._batch.push(_.extend({
      type: 'del',
      key: key
    }, opts));

    delete this._map[ hash(key, opts) ];

    cb(null);
    return this;
  };

  T.rollback = function(cb){
    cb = cb || function(){};

    this._release();
    
    cb(null);
    return this;
  };

  T.commit = function(cb){
    cb = cb || function(){};

    var self = this;
    db.batch(this._batch, function(){
      self._release();
      cb.apply(self, arguments);
    });
    return this;
  };

  T._lock = function(hash, job){
    job = job.bind(this);
    job.t = this;
    
    var i, j, l;

    if(locked[hash]){
      for(i = 0, l = locked[hash].length; i < l; i++){
        var t = locked[hash][i].t;
        if(t === this){
          //dont lock itself
          process.nextTick( job );
          return;
        }
        if(t._deps[this._id]){
          job(new Error('Deadlock')); //should be a very rare case
          return this;
        }
        this._deps[t.id] = true;
        for(j in t._deps){
          this._deps[j] = true;
        }
      }
    }else{
      locked[hash] = [];
      process.nextTick( job );
    }
    this._jobs[hash] = job;
    locked[hash].push(job);

    return this;
  };

  T._release = function(){
    var hash, i;
    for(hash in this._jobs){
      i = locked[hash].indexOf(this._jobs[hash]);
      if(i > -1)
        locked[hash].splice( i, 1 );
      if(locked[hash].length > 0){
        if(i === 0)
          process.nextTick( locked[hash][0] );
      }else{
        delete locked[hash];
      }
      delete this._jobs[hash];
    }
    this._deps = {};
    this._batch = [];
    this._map = {};

    return this;
  };

  db.transaction = db.transaction || function(){
    return new Transaction();
  };
  return db;
};
