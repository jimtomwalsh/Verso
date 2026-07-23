/*
 * viewer/build.js -- bundle the dev viewer (viewer.html, which references ../src)
 * into a SINGLE self-contained file (verso-viewer.html) a reviewer can open with no
 * repo. Inlines course.css + every ../src/*.js. Run:  node viewer/build.js
 *
 * No deps -- plain node + fs (matches the app's constraints). The dev viewer.html
 * stays the source of truth (tracks live ../src); re-run this after editing it or
 * the bundled sources.
 */
var fs = require("fs");
var path = require("path");
var dir = __dirname;
var root = path.join(dir, "..");

var html = fs.readFileSync(path.join(dir, "viewer.html"), "utf8");

// A </script> or </style> literal inside an inlined asset would prematurely close
// the tag -- neutralise it (valid + reversible for the browser's parser).
function safeJs(s) { return s.replace(/<\/script>/gi, "<\\/script>"); }
function safeCss(s) { return s.replace(/<\/style>/gi, "<\\/style>"); }

// inline the stylesheet
html = html.replace(/<link rel="stylesheet" href="\.\.\/src\/course\.css">/,
  function () { return "<style>\n" + safeCss(fs.readFileSync(path.join(root, "src/course.css"), "utf8")) + "\n</style>"; });

// inline every ../src script (in order)
var inlined = [];
html = html.replace(/<script src="\.\.\/src\/([^"]+)"><\/script>/g, function (m, f) {
  inlined.push(f);
  return "<script>\n" + safeJs(fs.readFileSync(path.join(root, "src", f), "utf8")) + "\n</script>";
});

// mark the build so the dev + dist files are distinguishable
html = html.replace("<title>Verso Viewer — Review</title>",
  "<title>Verso Viewer</title>\n<!-- BUILT " + new Date().toISOString() + " — self-contained; regenerate with viewer/build.js -->");

var out = path.join(dir, "verso-viewer.html");
fs.writeFileSync(out, html);
var leftover = (html.match(/\.\.\/src\//g) || []).length;
console.log("Bundled " + inlined.length + " scripts + course.css -> " + path.basename(out) +
  " (" + Math.round(html.length / 1024) + " KB); remaining ../src refs: " + leftover);
if (leftover) { console.error("WARNING: unresolved ../src references remain"); process.exit(1); }
