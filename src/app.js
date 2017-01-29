require('babel-polyfill');

import { app, BrowserWindow, crashReporter } from 'electron';

let mainWindow = null;
if (process.env.NODE_ENV === 'develop') {
  crashReporter.start();
}

app.on('window-all-closed', () => {
  app.quit();
});

app.on('ready', () => {
  mainWindow = new BrowserWindow({ width: 580, height: 365 });
  mainWindow.loadURL(`file://${__dirname}/renderer/index.html`);
});
