/**
 * launcher.js — Wrapper que limpia ELECTRON_RUN_AS_NODE antes de lanzar Electron.
 * Necesario cuando se lanza desde Claude Code / VSCode (que inyectan esa var).
 */
const { spawn } = require('child_process')
const electronExe = require('electron')   // devuelve la ruta al .exe

const env = Object.assign({}, process.env)
delete env.ELECTRON_RUN_AS_NODE

const args = ['.'].concat(process.argv.slice(2))
const child = spawn(electronExe, args, { env, stdio: 'inherit', windowsHide: false })

child.on('close', (code) => process.exit(code ?? 0))
