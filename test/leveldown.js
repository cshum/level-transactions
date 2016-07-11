/*
var test = require('tape')
var leveldown = require('leveldown')
var levelup = require('levelup')
var txdown = require('../')
var testCommon = require('abstract-leveldown/testCommon')
var testBuffer = require('./testdata_b64')
var lockCreator = require('../lock').creator

require('rimraf').sync('test/db')

var db = levelup('test/db', { db: leveldown, createLock: lockCreator() })

// compatibility with basic LevelDOWN API
var down = txdown(db)
require('abstract-leveldown/abstract/leveldown-test').args(down, test, testCommon)
require('abstract-leveldown/abstract/open-test').args(down, test, testCommon)
require('abstract-leveldown/abstract/del-test').all(down, test, testCommon)
require('abstract-leveldown/abstract/get-test').all(down, test, testCommon)
require('abstract-leveldown/abstract/put-test').all(down, test, testCommon)
require('abstract-leveldown/abstract/put-get-del-test').all(down, test, testCommon, testBuffer)
require('abstract-leveldown/abstract/batch-test').all(down, test, testCommon)
require('abstract-leveldown/abstract/chained-batch-test').all(down, test, testCommon)
require('abstract-leveldown/abstract/close-test').close(down, test, testCommon)
// require('abstract-leveldown/abstract/iterator-test').all(down, test, testCommon)
// require('abstract-leveldown/abstract/ranges-test').all(down, test, testCommon)
*/
