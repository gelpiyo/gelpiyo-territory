// Event map data for ゲルぴよ陣取りゲーム
// This file is loaded before script.js and does not require fetch().
//
// 1マップ = 1オブジェクト。配列に足すだけで「ゲーム設定」のイベントのプルダウンに増えます。
//   name       … プルダウンに表示される名前
//   background … 盤面に敷く背景画像のパス。省略すると白い盤面になります
//   cells      … マスの並び。行の長さはすべて同じにしてください
//
// cells で使える記号:
//   W = 空きマス   X = 設置禁止マス
//   R = 先攻（赤）の駒   B = 後攻（青）の駒   G = 中立（灰色）の駒

// 「シンプル」（9 × 9 / 11 × 11 / 13 × 13）で使う背景画像。
// 空文字 '' にすると背景なしの白い盤面になります。
window.SIMPLE_BOARD_BACKGROUND = 'images/board_bg.png';

window.EVENT_MAPS = Object.freeze([
  Object.freeze({
    "name": "公園①",
    "background": "images/park_1.png",
    "columns": 11,
    "rows": 9,
    "cells": [
      [ "W", "W", "W", "W", "W", "W", "W", "W", "W", "W", "W" ],
      [ "W", "G", "G", "W", "W", "W", "W", "W", "G", "G", "W" ],
      [ "W", "W", "W", "W", "W", "W", "W", "W", "W", "W", "W" ],
      [ "W", "W", "W", "R", "W", "W", "W", "B", "W", "W", "W" ],
      [ "W", "W", "W", "W", "W", "X", "W", "W", "W", "W", "W" ],
      [ "W", "W", "W", "B", "W", "W", "W", "R", "W", "W", "W" ],
      [ "W", "W", "W", "X", "X", "X", "X", "X", "W", "W", "W" ],
      [ "W", "W", "W", "W", "W", "W", "W", "W", "W", "W", "W" ],
      [ "W", "W", "W", "W", "W", "W", "W", "W", "W", "W", "W" ]
    ]
  }),
  Object.freeze({
    "name": "公園②",
    "background": "images/park_2.png",
    "columns": 13,
    "rows": 11,
    "cells": [
      ["W", "W", "X", "W", "W", "W", "W", "W", "W", "W", "W", "W", "W" ],
      [ "W", "X", "X", "X", "W", "W", "G", "W", "W", "G", "W", "G", "W" ],
      [ "W", "W", "X", "X", "W", "W", "W", "W", "W", "W", "G", "W", "W" ],
      [ "W", "W", "W", "W", "W", "B", "W", "R", "W", "W", "W", "W", "W" ],
      [ "W", "W", "W", "W", "R", "W", "W", "W", "B", "W", "W", "W", "W" ],
      [ "W", "W", "G", "W", "W", "W", "X", "W", "W", "W", "G", "W", "W" ],
      [ "W", "W", "W", "W", "B", "W", "W", "W", "R", "W", "W", "W", "W" ],
      [ "W", "W", "W", "W", "W", "R", "W", "B", "W", "W", "W", "W", "W" ],
      [ "W", "W", "G", "W", "W", "W", "W", "W", "W", "W", "G", "W", "W" ],
      [ "W", "W", "W", "W", "W", "W", "G", "W", "W", "W", "W", "W", "W" ],
      [ "W", "W", "W", "W", "W", "W", "W", "W", "W", "W", "W", "W", "W" ]
    ]
  }),
  Object.freeze({
    "name": "湖①",
    "background": "images/lake_1.png",
    "columns": 16,
    "rows": 11,
    "cells": [
      [ "W", "W", "W", "W", "W", "B", "W", "W", "W", "W", "W", "W", "W", "W", "W", "W" ],
      [ "W", "W", "R", "X", "X", "X", "X", "X", "W", "B", "W", "W", "W", "B", "W", "W" ],
      [ "W", "W", "W", "W", "X", "X", "X", "X", "X", "W", "G", "W", "W", "W", "R", "W" ],
      [ "W", "X", "X", "X", "X", "X", "W", "X", "X", "X", "W", "W", "G", "W", "W", "W" ],
      [ "W", "X", "X", "X", "W", "R", "W", "W", "X", "X", "W", "W", "W", "W", "G", "W" ],
      [ "W", "X", "X", "X", "W", "W", "W", "W", "W", "W", "W", "W", "W", "G", "W", "W" ],
      [ "W", "X", "X", "X", "W", "B", "W", "W", "X", "X", "W", "W", "W", "W", "G", "W" ],
      [ "W", "X", "X", "X", "X", "X", "W", "X", "X", "X", "W", "W", "G", "W", "W", "W" ],
      [ "W", "W", "W", "W", "X", "X", "X", "X", "X", "W", "G", "W", "W", "W", "B", "W" ],
      [ "W", "W", "B", "X", "X", "X", "X", "X", "W", "R", "W", "W", "W", "R", "W", "W" ],
      [ "W", "W", "W", "W", "W", "R", "W", "W", "W", "W", "W", "W", "W", "W", "W", "W" ]
    ]
  })
]);
