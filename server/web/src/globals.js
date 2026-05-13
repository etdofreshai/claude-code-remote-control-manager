// The Harness design components were authored as plain script files that
// attach symbols to window.* (`window.Icons`, `window.Sidebar`, `window.useTweaks`,
// etc.). Vite processes the JSX syntax at build time, but the runtime contract
// still expects React/ReactDOM on globalThis. This module runs before any
// component module and installs those globals.
import React from 'react';
import * as ReactDOMClient from 'react-dom/client';

globalThis.React = React;
globalThis.ReactDOM = ReactDOMClient;
