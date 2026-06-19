/*
 * API-based build (the browserify CLI in bin/cmd.js crashes on Node >= 20+
 * with "path argument must be of type string"). Mirrors the npm "build"
 * script: browserify + brfs + glslify-require, then minify with uglify-js.
 * If minification fails (e.g. uglify-js choking on ES6), the unminified
 * bundle is written instead so the app still works.
 */

const fs = require('fs');
const path = require('path');
const browserify = require('browserify');
const UglifyJS = require('uglify-js');

const root = path.join(__dirname, '..');
const entry = path.join(root, 'app/core/entry/entry.js');
const outFile = path.join(root, 'dist/bundle.js');
const tmpFile = outFile + '.tmp';

const b = browserify(entry);
b.transform('brfs');
b.plugin('glslify-require');

const out = fs.createWriteStream(tmpFile);
b.bundle()
    .on('error', function (err) {
        console.error('browserify error:', err);
        process.exit(1);
    })
    .pipe(out);

out.on('finish', function () {
    const code = fs.readFileSync(tmpFile, 'utf8');
    const result = UglifyJS.minify(code, { mangle: true });
    if (result.error) {
        console.warn('uglify-js failed, writing UNMINIFIED bundle:', result.error.message);
        fs.writeFileSync(outFile, code);
    } else {
        fs.writeFileSync(outFile, result.code);
        console.log('minified OK');
    }
    fs.unlinkSync(tmpFile);
    console.log('bundle bytes:', fs.statSync(outFile).size);
});
