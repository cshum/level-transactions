var _ = require('underscore');

module.exports = function( db ){
  var id       = 0;
  var locked   = {};

  function Transaction(){
    this.jobs = {};
    this.id = id.toString(36);
    id++;

    this.deps = {};
    this.batch = [];

  }
  var T = Transaction.prototype;

  T.put = function(key, value, opts){
    this.batch.push(_.extend({
      type: 'put',
      key: key,
      value: value
    }, opts));
    return this;
  };
  T.del = function(key, opts){
    this.batch.push(_.extend({
      type: 'del',
      key: key
    }, opts));
    return this;
  };
  T.lock = function(hash, job){
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
        if(t.deps[this.id]){
          job(new Error('Potential Deadlock detected.'));
          return this;
        }
        this.deps[t.id] = true;
        for(j in t.deps){
          this.deps[j] = true;
        }
      }
    }else{
      locked[hash] = [];
      process.nextTick( job );
    }
    this.jobs[hash] = job;
    locked[hash].push(job);

    return this;
  };

  T.release = function(){
    var hash, i;
    for(hash in this.jobs){
      i = locked[hash].indexOf(this.jobs[hash]);
      if(i > -1)
        locked[hash].splice( i, 1 );
      if(locked[hash].length > 0){
        if(i === 0)
          process.nextTick( locked[hash][0] );
      }else{
        delete locked[hash];
      }
      delete this.jobs[hash];
    }
    this.deps = {};
    return this;
  };

  T.rollback = function(){
    this.release();
    this.batch = [];
    return this;
  };
  T.commit = function(cb){
    var self = this;
    db.batch(this.batch, function(){
      self.release();
      if(typeof cb === 'function')
        cb.apply(self, arguments);
    });
    return this;
  };

  db.transaction = db.transaction || function(){
    return new Transaction();
  };
  return db;
};
