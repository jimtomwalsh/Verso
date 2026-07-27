// src/line-diff.js -- dependency-free line-level diff (classic LCS), DOM-free (string in,
// data out), same shape as markdown-lite.js / markdown-import.js. Built for the "Source
// updated" reconcile-conflict review (product-rail-review-diff), but general-purpose --
// anywhere two versions of text need a line-by-line compare.
//
// window.LineDiff.diff(oldText, newText) -> [{ type: "same"|"removed"|"added", text }]
(function () {
  "use strict";

  function diff(oldText, newText) {
    var a = String(oldText == null ? "" : oldText).replace(/\r\n/g, "\n").split("\n");
    var b = String(newText == null ? "" : newText).replace(/\r\n/g, "\n").split("\n");
    var m = a.length, n = b.length;
    // Standard bottom-up LCS length table -- dp[i][j] = LCS length of a[i:] and b[j:].
    var dp = [];
    for (var i = 0; i <= m; i++) dp.push(new Array(n + 1).fill(0));
    for (i = m - 1; i >= 0; i--) {
      for (var j = n - 1; j >= 0; j--) {
        dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    var ops = [];
    i = 0; var jj = 0;
    while (i < m && jj < n) {
      if (a[i] === b[jj]) { ops.push({ type: "same", text: a[i] }); i++; jj++; }
      else if (dp[i + 1][jj] >= dp[i][jj + 1]) { ops.push({ type: "removed", text: a[i] }); i++; }
      else { ops.push({ type: "added", text: b[jj] }); jj++; }
    }
    while (i < m) { ops.push({ type: "removed", text: a[i] }); i++; }
    while (jj < n) { ops.push({ type: "added", text: b[jj] }); jj++; }
    return ops;
  }

  var LineDiff = { diff: diff };

  if (typeof window !== "undefined") window.LineDiff = LineDiff;
  if (typeof module !== "undefined" && module.exports) module.exports = LineDiff;
})();
