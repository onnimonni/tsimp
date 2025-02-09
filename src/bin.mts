#!/usr/bin/env node

// vim: set filetype=typescript

import { foregroundChild } from 'foreground-child'
import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import Module from 'node:module'
import { resolve as pathResolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const [sMajor, sMinor] = process.versions.node.split('.')
/* c8 ignore start */
if (!sMajor || !sMinor) {
  throw new Error(
    'could not determine node version: ' + process.versions.node,
  )
}

const useImport = typeof Module.register === 'function'
const importScript = String(
  new URL('./hooks/import.mjs', import.meta.url),
)
const loaderScript = String(
  new URL('./hooks/legacy-loader.mjs', import.meta.url),
)
/* c8 ignore start */
const addArg =
  useImport ? `--import=${importScript}` : `--loader=${loaderScript}`
/* c8 ignore stop */

const usage = () =>
  console.log(`Usage: tsimp [<flag> | <node args>]

Flags:

--start   Start the persistent daemon and preload the TypeScript
          program object for typecheck compilation.
--stop    Kill the persistent daemon process.
--restart Stop and then start again.
--clear   Kill daemon and clear all cached data and logs.
--ping    Issue a PING request to daemon and print result. Will start
          the daemon if not already running.
--help    You're looking at it.
--log     Display the service log (ie, \`cat .tsimp/daemon/log\`)

--compile <fileName>
          Compile the specified TypeScript fileName, printing code
          to stdout and diagnostics to stderr.

--check <fileName>
          Same as --compile, but do not output the code.

--resolve <module> [<parent>]
          Resolve the specified module name (ie, find the .ts file for
          a .js import specifier). Will print either a full file://
          url to the found module, or echo the specifier back.

Flags have no effect unless they are the first argument.

If none of the above flags are specified, then tsimp runs node using
'--loader=tsimp/loader' or  '--import=tsimp/import', as appropriate for
the current node version.

All other args are just normal node arguments.

Note: \`tsimp\` without any arguments is a node repl that can import
TypeScript modules, not a "TypeScript repl".`)

const startDaemon = async () => {
  const { DaemonClient } = await import('./client.js')
  await new DaemonClient().preload()
  console.log('tsimp: daemon running')
}

const pingDaemon = async () => {
  const { DaemonClient } = await import('./client.js')
  console.log(await new DaemonClient().ping())
}

const stopDaemon = async () => {
  const { DaemonClient } = await import('./client.js')
  await new DaemonClient().kill()
  console.log('tsimp: daemon stopped')
}

const clearCache = async () => {
  await stopDaemon()
  const { rimraf } = await import('rimraf')
  await rimraf('.tsimp')
  console.log('tsimp: cache cleared')
}

const log = async () => {
  console.log(
    (
      await readFile('.tsimp/daemon/log', 'utf8').catch(
        e =>
          'log could not be read: ' +
          (e as NodeJS.ErrnoException).code,
      )
    ).trimEnd(),
  )
}

const compile = async (src: string) => {
  const { DaemonClient } = await import('./client.js')
  const start = performance.now()
  const { fileName, diagnostics } = await new DaemonClient().compile(
    src,
  )
  const duration =
    Math.floor((performance.now() - start) * 1000) / 1000
  if (fileName) {
    console.log(readFileSync(fileName, 'utf8'))
  }
  for (const d of diagnostics) console.error(d)
  console.error(`compiled in ${duration} ms`)
}

const cwdURL = String(pathToFileURL(pathResolve('x')))
const resolve = async (url: string, parentURL: string = cwdURL) => {
  if (!parentURL.startsWith('file://')) {
    parentURL = String(pathToFileURL(pathResolve(parentURL)))
  }
  const p = parentURL === cwdURL ? 'cwd' : parentURL
  const f =
    url.startsWith('./') || url.startsWith('../') ? ` from ${p}` : ''
  console.error(`import('${url}')${f}`)
  const { DaemonClient } = await import('./client.js')
  console.log(await new DaemonClient().resolve(url, parentURL))
}

switch (process.argv[2]) {
  case '-h':
  case '--help':
    usage()
    process.exit(0)
  case '--clear':
    await clearCache()
    process.exit(0)
  case '--restart':
    await stopDaemon()
    await startDaemon()
    process.exit(0)
  case '--start':
    await startDaemon()
    process.exit(0)
  case '--stop':
    await stopDaemon()
    process.exit(0)
  case '--ping':
    await pingDaemon()
    process.exit(0)
  case '--log':
    await log()
    process.exit(0)
  case '--compile':
    if (!process.argv[3]) {
      console.error('fileName is required')
      process.exit(1)
    }
    await compile(process.argv[3])
    process.exit(0)
  case '--resolve':
    if (!process.argv[3]) {
      console.error('module specifier is required')
      process.exit(1)
    }
    await resolve(process.argv[3], process.argv[4])
    process.exit(0)
}

const args = [addArg, ...process.execArgv, ...process.argv.slice(2)]
foregroundChild(process.execPath, args)
