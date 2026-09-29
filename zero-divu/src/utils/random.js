'use strict';

exports.randomInt = (min, max) =>
  Math.floor(Math.random() * (max - min + 1)) + min;

exports.pick = (arr) => (arr.length ? arr[Math.floor(Math.random() * arr.length)] : null);

exports.shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
