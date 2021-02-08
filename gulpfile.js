// ## Globals
const argv = require("minimist")(process.argv.slice(2));
const autoprefixer = require("gulp-autoprefixer");
const browserSync = require("browser-sync").create();
const changed = require("gulp-changed");
const concat = require("gulp-concat");
const flatten = require("gulp-flatten");
const gulp = require("gulp");
const gulpif = require("gulp-if");
const imagemin = require("gulp-imagemin");
const jshint = require("gulp-jshint");
const lazypipe = require("lazypipe");
const less = require("gulp-less");
const merge = require("merge-stream");
const cssNano = require("gulp-cssnano");
const plumber = require("gulp-plumber");
const rev = require("gulp-rev");
const sass = require("gulp-sass");
const sourcemaps = require("gulp-sourcemaps");
const uglify = require("gulp-uglify");

// See https://github.com/austinpray/asset-builder
const manifest = require("asset-builder")("./assets/manifest.json");

// `path` - Paths to base asset directories. With trailing slashes.
// - `path.source` - Path to the source files. Default: `assets/`
// - `path.dist` - Path to the build directory. Default: `dist/`
const path = manifest.paths;

// `config` - Store arbitrary configuration values here.
const config = manifest.config || {};

// `globs` - These ultimately end up in their respective `gulp.src`.
// - `globs.js` - Array of asset-builder JS dependency objects. Example:
//   ```
//   {type: 'js', name: 'main.js', globs: []}
//   ```
// - `globs.css` - Array of asset-builder CSS dependency objects. Example:
//   ```
//   {type: 'css', name: 'main.css', globs: []}
//   ```
// - `globs.fonts` - Array of font path globs.
// - `globs.images` - Array of image path globs.
// - `globs.bower` - Array of all the main Bower files.
const globs = manifest.globs;

// `project` - paths to first-party assets.
// - `project.js` - Array of first-party JS assets.
// - `project.css` - Array of first-party CSS assets.
const project = manifest.getProjectGlobs();

// CLI options
const enabled = {
  // Enable static asset revisioning when `--production`
  rev: argv.production,
  // Disable source maps when `--production`
  maps: !argv.production,
  // Fail styles task on error when `--production`
  failStyleTask: argv.production,
  // Fail due to JSHint warnings only when `--production`
  failJSHint: argv.production,
  // Strip debug statments from javascript when `--production`
  stripJSDebug: argv.production,
};

// Path to the compiled assets manifest in the dist directory
const revManifest = path.dist + "assets.json";

// Error checking; produce an error rather than crashing.
const onError = function (err) {
  console.log(err.toString());
  this.emit("end");
};

// ## Reusable Pipelines
// See https://github.com/OverZealous/lazypipe

// ### Write to rev manifest
// If there are any revved files then write them to the rev manifest.
// See https://github.com/sindresorhus/gulp-rev
const writeToManifest = (directory, done) =>
  lazypipe()
    .pipe(gulp.dest, path.dist + directory)
    .pipe(browserSync.stream, { match: "**/*.{js,css}" })
    .pipe(rev.manifest, revManifest, {
      base: path.dist,
      merge: true,
    })
    .pipe(gulp.dest, path.dist)()
    .on("end", done);

// ### CSS processing pipeline
// Example
// ```
// gulp.src(cssFiles)
//   .pipe(cssTasks('main.css')
//   .pipe(gulp.dest(path.dist + 'styles'))
// ```
const cssTasks = (filename) =>
  lazypipe()
    .pipe(() => gulpif(!enabled.failStyleTask, plumber()))
    .pipe(() => gulpif(enabled.maps, sourcemaps.init()))
    .pipe(() => gulpif("*.less", less()))
    .pipe(() =>
      gulpif(
        "*.scss",
        sass({
          outputStyle: "nested", // libsass doesn't support expanded yet
          precision: 10,
          includePaths: ["."],
          errLogToConsole: !enabled.failStyleTask,
        })
      )
    )
    .pipe(concat, filename)
    .pipe(autoprefixer)
    .pipe(cssNano, {
      safe: true,
    })
    .pipe(() => gulpif(enabled.rev, rev()))
    .pipe(() =>
      gulpif(
        enabled.maps,
        sourcemaps.write(".", {
          sourceRoot: "assets/styles/",
        })
      )
    )();

const processStyles = (done) => {
  const merged = merge();
  manifest.forEachDependency("css", (dep) => {
    const cssTasksInstance = cssTasks(dep.name);
    if (!enabled.failStyleTask) {
      cssTasksInstance.on("error", function (err) {
        console.error(err.message);
        this.emit("end");
      });
    }
    merged.add(
      gulp
        .src(dep.globs, { base: "styles" })
        .pipe(plumber({ errorHandler: onError }))
        .pipe(cssTasksInstance)
    );
  });
  return merged.pipe(writeToManifest("styles", done));
};

// ### JS processing pipeline
// Example
// ```
// gulp.src(jsFiles)
//   .pipe(jsTasks('main.js')
//   .pipe(gulp.dest(path.dist + 'scripts'))
// ```
const jsTasks = (filename) =>
  lazypipe()
    .pipe(() => gulpif(enabled.maps, sourcemaps.init()))
    .pipe(concat, filename)
    .pipe(uglify, {
      compress: {
        drop_debugger: enabled.stripJSDebug,
      },
    })
    .pipe(() => gulpif(enabled.rev, rev()))
    .pipe(() =>
      gulpif(
        enabled.maps,
        sourcemaps.write(".", {
          sourceRoot: "assets/scripts/",
        })
      )
    )();

const processScripts = (done) => {
  const merged = merge();
  manifest.forEachDependency("js", (dep) => {
    if (dep.globs.length) {
      merged.add(
        gulp
          .src(dep.globs, { base: "scripts" })
          .pipe(plumber({ errorHandler: onError }))
          .pipe(jsTasks(dep.name))
      );
    }
  });
  return merged.pipe(writeToManifest("scripts", done));
};

// ## Gulp tasks
// Run `gulp -T` for a task summary

// ### Wiredep
// `gulp wiredep` - Automatically inject Less and Sass Bower dependencies. See
// https://github.com/taptapship/wiredep
gulp.task("wiredep", () => {
  const wiredep = require("wiredep").stream;
  return gulp
    .src(project.css)
    .pipe(wiredep())
    .pipe(changed(path.source + "styles"))
    .pipe(gulp.dest(path.source + "styles"));
});

// ### JSHint
// `gulp jshint` - Lints configuration JSON and project JS.
gulp.task("jshint", () =>
  gulp
    .src(["bower.json", "gulpfile.js"].concat(project.js))
    .pipe(jshint())
    .pipe(jshint.reporter("jshint-stylish"))
    .pipe(gulpif(enabled.failJSHint, jshint.reporter("fail")))
);

// ### Styles
// `gulp styles` - Compiles, combines, and optimizes Bower CSS and project CSS.
// By default this task will only log a warning if a precompiler error is
// raised. If the `--production` flag is set: this task will fail outright.
gulp.task("styles", gulp.series("wiredep", processStyles));

// ### Scripts
// `gulp scripts` - Runs JSHint then compiles, combines, and optimizes Bower JS
// and project JS.
gulp.task("scripts", gulp.series("jshint", processScripts));

// ### Fonts
// `gulp fonts` - Grabs all the fonts and outputs them in a flattened directory
// structure. See: https://github.com/armed/gulp-flatten
gulp.task("fonts", () =>
  gulp
    .src(globs.fonts)
    .pipe(flatten())
    .pipe(gulp.dest(path.dist + "fonts"))
    .pipe(browserSync.stream())
);

// ### Images
// `gulp images` - Run lossless compression on all the images.
gulp.task("images", () =>
  gulp
    .src(globs.images)
    .pipe(
      imagemin([
        imagemin.mozjpeg({ progressive: true }),
        imagemin.gifsicle({ interlaced: true }),
        imagemin.svgo({
          plugins: [
            { removeUnknownsAndDefaults: false },
            { cleanupIDs: false },
          ],
        }),
      ])
    )
    .pipe(gulp.dest(path.dist + "images"))
    .pipe(browserSync.stream())
);

// ### Clean
// `gulp clean` - Deletes the build folder entirely.
gulp.task("clean", require("del").bind(null, [path.dist]));

// ### Watch
// `gulp watch` - Use BrowserSync to proxy your dev server and synchronize code
// changes across devices. Specify the hostname of your dev server at
// `manifest.config.devUrl`. When a modification is made to an asset, run the
// build step for that asset and inject the changes into the page.
// See: http://www.browsersync.io
gulp.task("watch", () => {
  browserSync.init({
    files: [
      "{lib,templates}/**/*.php",
      "*.php",
      "{lib,templates}/**/*.twig",
      "*.twig",
    ],
    proxy: config.devUrl,
    snippetOptions: {
      whitelist: ["/wp-admin/admin-ajax.php"],
      blacklist: ["/wp-admin/**"],
    },
  });
  gulp.watch([path.source + "styles/**/*"], gulp.series("styles"));
  gulp.watch([path.source + "scripts/**/*"], gulp.series("jshint", "scripts"));
  gulp.watch([path.source + "fonts/**/*"], gulp.series("fonts"));
  gulp.watch([path.source + "images/**/*"], gulp.series("images"));
  gulp.watch(["bower.json", "assets/manifest.json"], gulp.series("build"));
});

// ### Build
// `gulp build` - Run all the build tasks but don't clean up beforehand.
// Generally you should be running `gulp` instead of `gulp build`.
gulp.task(
  "build",
  gulp.series("styles", "scripts", gulp.parallel("fonts", "images"))
);

// ### Gulp
// `gulp` - Run a complete build. To compile for production run `gulp --production`.
gulp.task("default", gulp.series("clean", "build"));
