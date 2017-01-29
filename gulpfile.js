'use strict';
const fs = require('fs');
const path = require('path');

const _ = require('lodash');
const $ = require('gulp-load-plugins')();
const browserify = require('browserify');
const buffer = require('vinyl-buffer');
const del = require('del');
const electronServer = require('electron-connect').server;
const gulp = require('gulp');
const mainBowerFiles = require('main-bower-files');
const merge = require('merge2');
const packager = require('electron-packager');
const source = require('vinyl-source-stream');

const packageJson = require('./package.json');

const distDir = 'dist';
const releaseDir = 'release';
const serveDir = '.serve';
const srcDir = 'src';

// Compile scripts for distribution
gulp.task('compile:scripts', () => {
  return gulp
    .src('src/**/*.{js,jsx}')
    .pipe($.babel({
      presets: ['es2015', 'react', 'stage-0']
    }))
    .pipe($.uglify())
    .pipe(gulp.dest(serveDir))
    ;
});

// Incremental compile ES6, JSX files with sourcemaps
gulp.task('compile:scripts:watch', (done) => {
  gulp
  .src('src/**/*.{js,jsx}')
  .pipe($.watch('src/**/*.{js,jsx}', { verbose: true }))
  .pipe($.plumber())
  .pipe($.sourcemaps.init())
  .pipe($.babel({
    presets: ['es2015', 'react', 'stage-0']
  }))
  .pipe($.sourcemaps.write('.'))
  .pipe(gulp.dest(serveDir))
  ;
  done();
});

// Compile *.scss files with sourcemaps
gulp.task('compile:styles', () => {
  return gulp
    .src([`${srcDir}/styles/**/*.scss`])
    .pipe($.sourcemaps.init())
    .pipe($.sass())
    .pipe($.sourcemaps.write('.'))
    .pipe(gulp.dest(`${serveDir}/styles`))
    ;
});

// Inject *.css(compiled and depedent) files into *.html
gulp.task('inject:css', ['compile:styles'], () => {
  return gulp
    .src(`${srcDir}/**/*.html`)
    .pipe($.inject(gulp.src(mainBowerFiles().concat([`${serveDir}/styles/**/*.css`])), {
      relative: true,
      ignorePath: ['../../.serve', '..'],
      addPrefix: '..',
    }))
    .pipe(gulp.dest(serveDir))
    ;
});

// Make HTML and concats CSS files
gulp.task('html', ['inject:css'], () => {
  const assets = $.useref.assets({ searchPath: ['bower_components', `${serveDir}/styles`] });
  return gulp
    .src(`${serveDir}/renderer/**/*.html`)
    .pipe(assets)
    .pipe($.if('*.css', $.minifyCss()))
    .pipe(assets.restore())
    .pipe($.useref())
    .pipe(gulp.dest(`${distDir}/renderer`))
    ;
});

// Copy assets
gulp.task('misc', () => {
  return gulp
    .src(`${srcDir}/assets/**/*`)
    .pipe(gulp.dest(`${serveDir}/assets`))
    .pipe(gulp.dest(`${distDir}/assets`))
    ;
});

// Copy fonts file. You don't need to copy *.ttf nor *.svg nor *.otf.
gulp.task('copy:fonts', () => {
  return gulp
    .src('bower_components/**/fonts/*.woff')
    .pipe($.flatten())
    .pipe(gulp.dest(`${distDir}/fonts`))
    ;
});

// Minify dependent modules.
gulp.task('bundle:dependencies', () => {
  const defaultModules = [
    'assert', 'buffer', 'console', 'constants', 'crypto', 'domain', 'events',
    'http', 'https', 'os', 'path', 'punycode', 'querystring', 'stream', 'string_decoder',
    'timers', 'tty', 'url', 'util', 'vm', 'zlib'
  ];
  const electronModules = [
    'app', 'auto-updater', 'browser-window', 'content-tracing', 'dialog', 'global-shortcut',
    'ipc', 'menu', 'menu-item', 'power-monitor', 'protocol', 'tray', 'remote', 'web-frame',
    'clipboard', 'crash-reporter', 'native-image', 'screen', 'shell'
  ];

  // Because Electron's node integration, bundle files don't need to include browser-specific shim.
  const excludeModules = defaultModules.concat(electronModules);

  // create a list of dependencies' main files
  const dependencies = _.map(packageJson.dependencies, (version, name) => { return name; });
  const modules = dependencies.map((dep) => {
    const packageJson = require(`${dep}/package.json`);
    let main;
    if (!packageJson.main) {
      main = ['index.js'];
    } else if (Array.isArray(packageJson.main)) {
      main = packageJson.main;
    } else {
      main = [packageJson.main];
    }
    return { name: dep, main: main.map((it) => { return path.basename(it); }) };
  });
  // add babel/polyfill module
  modules.push({ name: 'babel', main: ['polyfill.js'] });

  // create bundle file and minify for each main files
  const streams = [];
  modules.forEach((it) => {
    it.main.forEach((entry) => {
      const b = browserify(`node_modules/${it.name}/${entry}`, {
        detectGlobal: false,
        standalone: entry,
      });
      excludeModules.forEach((moduleName) => { b.exclude(moduleName); });
      streams.push(b
        .bundle()
        .pipe(source(entry))
        .pipe(buffer())
        .pipe($.uglify())
        .pipe(gulp.dest(`${distDir}/node_modules/${it.name}`))
      );
    });
    streams.push(
      // copy modules' package.json
      gulp
      .src(`node_modules/${it.name}/package.json`)
      .pipe(gulp.dest(`${distDir}/node_modules/${it.name}`))
    );
  });

  return merge(streams);
});

// Write a package.json for distribution
gulp.task('packageJson', ['bundle:dependencies'], (done) => {
  const json = _.cloneDeep(packageJson);
  json.main = 'app.js';
  fs.writeFile(`${distDir}/package.json`, JSON.stringify(json), done);
});

// Package for each platforms
gulp.task('package', ['darwin'/*, win32, linux*/].map((platform) => {
  const taskName = `package:${platform}`;
  gulp.task(taskName, ['build'], (done) => {
    packager({
      dir: distDir,
      out: `release/${platform}`,
      name: 'ElectronStudy',
      arch: 'x64',
      platform: platform,
      version: '0.28.1',
    }, done);
  });
  return taskName;
}));

// Delete generated directories.
gulp.task('clean', (done) => {
  del([serveDir, distDir, releaseDir], done);
});

gulp.task('serve', ['inject:css', 'compile:scripts:watch', 'compile:styles', 'misc'], () => {
  const electron = electronServer.create();
  electron.start();
  gulp.watch(['bower.json', `${srcDir}/renderer/index.html`], ['inject:css']);
  // BrowserProcess(MainProcess)が読み込むリソースが変更されたら, Electron自体を再起動
  gulp.watch([
    `${serveDir}/app.js`,
    `${serveDir}/browser/**/*.js`
  ], electron.restart);
  // RendererProcessが読み込むリソースが変更されたら, RendererProcessにreloadさせる
  gulp.watch([
    `${serveDir}/styles/**/*.css`,
    `${serveDir}/renderer/**/*.html`,
    `${serveDir}/renderer/**/*.js`
  ], electron.reload);
});

gulp.task('build', ['html', 'compile:scripts', 'packageJson', 'copy:fonts', 'misc']);

gulp.task('serve:dist', ['build'], () => {
  electronServer.create({ path: distDir }).start();
});

gulp.task('default', ['build']);
