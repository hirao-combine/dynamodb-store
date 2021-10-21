"use strict";
exports.__esModule = true;
var _extends =
  Object.assign ||
  function (target) {
    for (var i = 1; i < arguments.length; i++) {
      var source = arguments[i];
      for (var key in source) {
        if (Object.prototype.hasOwnProperty.call(source, key)) {
          target[key] = source[key];
        }
      }
    }
    return target;
  };
var _expressSession = require("express-session");
var _dynamodb = require("aws-sdk/clients/dynamodb");
var _dynamodb2 = _interopRequireDefault(_dynamodb);
var _constants = require("./constants");
var _util = require("./util");
function _interopRequireDefault(obj) {
  return obj && obj.__esModule ? obj : { default: obj };
}
function _asyncToGenerator(fn) {
  return function () {
    var gen = fn.apply(this, arguments);
    return new Promise(function (resolve, reject) {
      function step(key, arg) {
        try {
          var info = gen[key](arg);
          var value = info.value;
        } catch (error) {
          reject(error);
          return;
        }
        if (info.done) {
          resolve(value);
        } else {
          return Promise.resolve(value).then(
            function (value) {
              step("next", value);
            },
            function (err) {
              step("throw", err);
            }
          );
        }
      }
      return step("next");
    });
  };
}
class DynamoDBStore extends _expressSession.Store {
  constructor(options = {}, callback = _constants.DEFAULT_CALLBACK) {
    super();
    (0, _util.debug)("Initializing store", options);
    this.setOptionsAsInstanceAttributes(options);
    const dynamoConfig = options.dynamoConfig || {};
    this.dynamoService = new _dynamodb2.default(
      _extends({}, dynamoConfig, { apiVersion: _constants.API_VERSION })
    );
    this.documentClient = new _dynamodb2.default.DocumentClient({
      service: this.dynamoService,
    });
    this.createTableIfDontExists(callback);
  }
  setOptionsAsInstanceAttributes(options) {
    const {
      table = {},
      touchInterval = _constants.DEFAULT_TOUCH_INTERVAL,
      ttl,
      keepExpired = _constants.DEFAULT_KEEP_EXPIRED_POLICY,
    } = options;
    const {
      name = _constants.DEFAULT_TABLE_NAME,
      hashPrefix = _constants.DEFAULT_HASH_PREFIX,
      hashKey = _constants.DEFAULT_HASH_KEY,
      readCapacityUnits = _constants.DEFAULT_RCU,
      writeCapacityUnits = _constants.DEFAULT_WCU,
    } = table;
    this.tableName = name;
    this.hashPrefix = hashPrefix;
    this.hashKey = hashKey;
    this.readCapacityUnits = Number(readCapacityUnits);
    this.writeCapacityUnits = Number(writeCapacityUnits);
    this.touchInterval = touchInterval;
    this.ttl = ttl;
    this.keepExpired = keepExpired;
  }
  isTableCreated() {
    var _this = this;
    return _asyncToGenerator(function* () {
      try {
        yield _this.dynamoService
          .describeTable({ TableName: _this.tableName })
          .promise();
        return true;
      } catch (tableNotFoundError) {
        return false;
      }
    })();
  }
  createTable() {
    const params = {
      TableName: this.tableName,
      KeySchema: [{ AttributeName: this.hashKey, KeyType: "HASH" }],
      AttributeDefinitions: [
        { AttributeName: this.hashKey, AttributeType: "S" },
      ],
      ProvisionedThroughput: {
        ReadCapacityUnits: this.readCapacityUnits,
        WriteCapacityUnits: this.writeCapacityUnits,
      },
    };
    return this.dynamoService.createTable(params).promise();
  }
  createTableIfDontExists(callback) {
    var _this2 = this;
    return _asyncToGenerator(function* () {
      try {
        const exists = yield _this2.isTableCreated();
        if (exists) {
          (0, _util.debug)(`Table ${_this2.tableName} already exists`);
        } else {
          (0, _util.debug)(`Creating table ${_this2.tableName}...`);
          yield _this2.createTable();
        }
        callback();
      } catch (createTableError) {
        (0,
        _util.debug)(`Error creating table ${_this2.tableName}`, createTableError);
        callback(createTableError);
      }
    })();
  }
  set(sid, sess, callback) {
    try {
      const sessionId = this.getSessionId(sid);
      const expires = this.getExpirationDate(sess);
      const params = {
        TableName: this.tableName,
        Item: {
          [this.hashKey]: sessionId,
          expires: (0, _util.toSecondsEpoch)(expires),
          sess: _extends({}, sess, { updated: Date.now() }),
        },
      };
      (0, _util.debug)(`Saving session '${sid}'`, sess);
      this.documentClient.put(params, callback);
    } catch (err) {
      (0, _util.debug)("Error saving session", { sid, sess, err });
      callback(err);
    }
  }
  get(sid, callback) {
    var _this3 = this;
    return _asyncToGenerator(function* () {
      try {
        const sessionId = _this3.getSessionId(sid);
        const params = {
          TableName: _this3.tableName,
          Key: { [_this3.hashKey]: sessionId },
          ConsistentRead: true,
        };
        const { Item: record } = yield _this3.documentClient
          .get(params)
          .promise();
        if (!record) {
          (0, _util.debug)(`Session '${sid}' not found`);
          callback(null, null);
        } else if ((0, _util.isExpired)(record.expires)) {
          _this3.handleExpiredSession(sid, callback);
        } else {
          (0, _util.debug)(`Session '${sid}' found`, record.sess);
          callback(null, record.sess);
        }
      } catch (err) {
        (0, _util.debug)(`Error getting session '${sid}'`, err);
        callback(err);
      }
    })();
  }
  destroy(sid, callback) {
    var _this4 = this;
    return _asyncToGenerator(function* () {
      try {
        const sessionId = _this4.getSessionId(sid);
        const params = {
          TableName: _this4.tableName,
          Key: { [_this4.hashKey]: sessionId },
        };
        yield _this4.documentClient.delete(params).promise();
        (0, _util.debug)(`Destroyed session '${sid}'`);
        callback(null, null);
      } catch (err) {
        (0, _util.debug)(`Error destroying session '${sid}'`, err);
        callback(err);
      }
    })();
  }
  touch(sid, sess, callback) {
    try {
      if (
        !sess.updated ||
        Number(sess.updated) + this.touchInterval <= Date.now()
      ) {
        const sessionId = this.getSessionId(sid);
        const expires = this.getExpirationDate(sess);
        const params = {
          TableName: this.tableName,
          Key: { [this.hashKey]: sessionId },
          UpdateExpression: "set expires = :e, sess.#up = :n",
          ExpressionAttributeNames: { "#up": "updated" },
          ExpressionAttributeValues: {
            ":e": (0, _util.toSecondsEpoch)(expires),
            ":n": Date.now(),
          },
          ReturnValues: "UPDATED_NEW",
        };
        (0, _util.debug)(`Touching session '${sid}'`);
        this.documentClient.update(params, callback);
      } else {
        (0, _util.debug)(`Skipping touch of session '${sid}'`);
        callback();
      }
    } catch (err) {
      (0, _util.debug)(`Error touching session '${sid}'`, err);
      callback(err);
    }
  }
  handleExpiredSession(sid, callback) {
    var _this5 = this;
    return _asyncToGenerator(function* () {
      (0, _util.debug)(`Found session '${sid}' but it is expired`);
      if (_this5.keepExpired) {
        callback(null, null);
      } else {
        _this5.destroy(sid, callback);
      }
    })();
  }
  getSessionId(sid) {
    return `${this.hashPrefix}${sid}`;
  }
  getExpirationDate(sess) {
    let expirationDate = Date.now();
    if (this.ttl !== undefined) {
      expirationDate += this.ttl;
    } else if (sess.cookie && Number.isInteger(sess.cookie.maxAge)) {
      expirationDate += sess.cookie.maxAge;
    } else {
      expirationDate += _constants.DEFAULT_TTL;
    }
    return new Date(expirationDate);
  }
}
exports.default = DynamoDBStore;
