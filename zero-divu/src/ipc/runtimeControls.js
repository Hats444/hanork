'use strict';

/** Controles runtime acionados pelo admin via IPC (Telegram/Hanork). */

let postsPausedByAdmin = false;

exports.isPostsPaused = () => postsPausedByAdmin;

exports.setPostsPaused = (paused) => {
  postsPausedByAdmin = Boolean(paused);
  return postsPausedByAdmin;
};

exports.togglePostsPaused = () => {
  postsPausedByAdmin = !postsPausedByAdmin;
  return postsPausedByAdmin;
};
