'use strict';

let aborted = false;

exports.abort = () => {
  aborted = true;
};

exports.reset = () => {
  aborted = false;
};

exports.isAborted = () => aborted;

module.exports = exports;
