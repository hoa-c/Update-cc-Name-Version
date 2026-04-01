import { readdir, readFile, writeFile } from 'fs/promises'
import { createInterface } from 'readline/promises'
import { stdin as input, stdout as output } from 'process'
import { relative, resolve } from 'path'

const DEFAULT_OLD_NAME = 'Claude Code'
const DEFAULT_OLD_VERSION = '2.1.888'
const SELF_FILE_NAME = 'rebrand.ts'
const STATE_FILE_NAME = '.rebrand-state.json'
const CLI_ENTRYPOINT = resolve('src', 'entrypoints', 'cli.tsx')

const textDecoder = new TextDecoder('utf-8', { fatal: true })

type CliOptions = {
  newName?: string
  newVersion?: string
  oldName?: string
  oldVersion?: string
  dryRun: boolean
  help: boolean
}

type ResolvedOptions = {
  newName: string
  newVersion: string
  oldName: string
  oldVersion: string
  dryRun: boolean
}

type Replacement = {
  from: string
  to: string
}

type FileChange = {
  path: string
  replacements: number
}

type RebrandState = {
  currentName: string
  currentVersion: string
  updatedAt: string
}

const SKIPPED_DIRECTORIES = new Set([
  '.git',
  'node_modules',
  'dist',
  'coverage',
  '.idea',
  '.vscode',
])

const SKIPPED_FILES = new Set([SELF_FILE_NAME, STATE_FILE_NAME])

function printHelp(): void {
  console.log(`Usage:
  bun rebrand.ts
  bun rebrand.ts --name "New Project" --version "3.0.0"

Options:
  --name <value>         New project name
  --version <value>      New version
  --old-name <value>     Current project name override
  --old-version <value>  Current version override
  --dry-run              Preview only, do not write files
  --help, -h             Show help

Notes:
  - The script stores the last applied name/version in ${STATE_FILE_NAME}
  - This lets you run the script repeatedly without being locked to
    "${DEFAULT_OLD_NAME}" and "${DEFAULT_OLD_VERSION}"
`)
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    dryRun: false,
    help: false,
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    switch (arg) {
      case '--name':
        options.newName = argv[++i]
        break
      case '--version':
        options.newVersion = argv[++i]
        break
      case '--old-name':
        options.oldName = argv[++i]
        break
      case '--old-version':
        options.oldVersion = argv[++i]
        break
      case '--dry-run':
        options.dryRun = true
        break
      case '--help':
      case '-h':
        options.help = true
        break
      default:
        throw new Error(`Unknown argument: ${arg}`)
    }
  }

  return options
}

async function promptIfNeeded(options: CliOptions): Promise<CliOptions> {
  if (options.newName && options.newVersion) {
    return options
  }

  const rl = createInterface({ input, output })
  try {
    const newName =
      options.newName?.trim() ||
      (await rl.question('Enter new project name: ')).trim()
    const newVersion =
      options.newVersion?.trim() ||
      (await rl.question('Enter new version: ')).trim()

    return {
      ...options,
      newName,
      newVersion,
    }
  } finally {
    rl.close()
  }
}

function validateNewValues(options: CliOptions): asserts options is CliOptions & {
  newName: string
  newVersion: string
} {
  if (options.help) {
    printHelp()
    process.exit(0)
  }

  if (!options.newName?.trim()) {
    throw new Error('New project name cannot be empty.')
  }

  if (!options.newVersion?.trim()) {
    throw new Error('New version cannot be empty.')
  }
}

async function loadState(cwd: string): Promise<RebrandState | null> {
  const statePath = resolve(cwd, STATE_FILE_NAME)
  const file = Bun.file(statePath)
  if (!(await file.exists())) {
    return null
  }

  try {
    const parsed = JSON.parse(await file.text()) as Partial<RebrandState>
    if (
      typeof parsed.currentName === 'string' &&
      typeof parsed.currentVersion === 'string'
    ) {
      return {
        currentName: parsed.currentName,
        currentVersion: parsed.currentVersion,
        updatedAt:
          typeof parsed.updatedAt === 'string'
            ? parsed.updatedAt
            : new Date().toISOString(),
      }
    }
  } catch {
    // Ignore invalid state and fall back to detection/defaults.
  }

  return null
}

async function detectCurrentVersion(cwd: string): Promise<string | null> {
  const entryPath = resolve(cwd, CLI_ENTRYPOINT)
  const file = Bun.file(entryPath)
  if (!(await file.exists())) {
    return null
  }

  try {
    const content = await file.text()
    const match = content.match(/VERSION:\s*"([^"]+)"/)
    return match?.[1] ?? null
  } catch {
    return null
  }
}

async function resolveCurrentValues(
  cwd: string,
  options: CliOptions & { newName: string; newVersion: string },
): Promise<ResolvedOptions> {
  const state = await loadState(cwd)
  const detectedVersion = await detectCurrentVersion(cwd)

  return {
    newName: options.newName,
    newVersion: options.newVersion,
    oldName: options.oldName?.trim() || state?.currentName || DEFAULT_OLD_NAME,
    oldVersion:
      options.oldVersion?.trim() ||
      state?.currentVersion ||
      detectedVersion ||
      DEFAULT_OLD_VERSION,
    dryRun: options.dryRun,
  }
}

function countOccurrences(content: string, search: string): number {
  if (search.length === 0) {
    return 0
  }

  let count = 0
  let index = 0

  while (true) {
    const found = content.indexOf(search, index)
    if (found === -1) {
      return count
    }
    count++
    index = found + search.length
  }
}

function buildReplacements(options: ResolvedOptions): Replacement[] {
  const replacements: Replacement[] = []

  if (options.oldName !== options.newName) {
    replacements.push({
      from: options.oldName,
      to: options.newName,
    })
  }

  if (options.oldVersion !== options.newVersion) {
    replacements.push(
      {
        from: `v${options.oldVersion}`,
        to: `v${options.newVersion}`,
      },
      {
        from: options.oldVersion,
        to: options.newVersion,
      },
    )
  }

  return replacements.sort((a, b) => b.from.length - a.from.length)
}

async function getCandidateFiles(cwd: string): Promise<string[]> {
  try {
    const result = Bun.spawnSync({
      cmd: ['git', 'ls-files', '-co', '--exclude-standard', '-z'],
      cwd,
      stdout: 'pipe',
      stderr: 'pipe',
    })

    if (result.exitCode === 0) {
      return new TextDecoder()
        .decode(result.stdout)
        .split('\0')
        .filter(Boolean)
        .map(file => resolve(cwd, file))
    }
  } catch {
    // Fall through to directory walk.
  }

  return walkDirectory(cwd)
}

async function walkDirectory(root: string): Promise<string[]> {
  const files: string[] = []
  const queue = [root]

  while (queue.length > 0) {
    const current = queue.pop()!
    const entries = await readdir(current, { withFileTypes: true })

    for (const entry of entries) {
      const absolutePath = resolve(current, entry.name)
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name)) {
          queue.push(absolutePath)
        }
        continue
      }

      if (entry.isFile()) {
        files.push(absolutePath)
      }
    }
  }

  return files
}

async function isTextFile(filePath: string): Promise<boolean> {
  const bytes = await Bun.file(filePath).bytes()

  for (const byte of bytes) {
    if (byte === 0) {
      return false
    }
  }

  try {
    textDecoder.decode(bytes)
    return true
  } catch {
    return false
  }
}

async function processFile(
  cwd: string,
  filePath: string,
  replacements: Replacement[],
  dryRun: boolean,
): Promise<FileChange | null> {
  if (SKIPPED_FILES.has(relative(cwd, filePath))) {
    return null
  }

  if (!(await isTextFile(filePath))) {
    return null
  }

  const file = Bun.file(filePath)
  const originalContent = await file.text()
  let updatedContent = originalContent
  let replacementCount = 0

  for (const replacement of replacements) {
    const matches = countOccurrences(updatedContent, replacement.from)
    if (matches === 0) {
      continue
    }
    updatedContent = updatedContent.split(replacement.from).join(replacement.to)
    replacementCount += matches
  }

  if (replacementCount === 0 || updatedContent === originalContent) {
    return null
  }

  if (!dryRun) {
    await Bun.write(filePath, updatedContent)
  }

  return {
    path: filePath,
    replacements: replacementCount,
  }
}

async function saveState(cwd: string, options: ResolvedOptions): Promise<void> {
  const statePath = resolve(cwd, STATE_FILE_NAME)
  const state: RebrandState = {
    currentName: options.newName,
    currentVersion: options.newVersion,
    updatedAt: new Date().toISOString(),
  }
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
}

async function main(): Promise<void> {
  const cwd = process.cwd()
  const parsed = parseArgs(process.argv.slice(2))
  const prompted = await promptIfNeeded(parsed)
  validateNewValues(prompted)

  const options = await resolveCurrentValues(cwd, prompted)
  const replacements = buildReplacements(options)

  if (replacements.length === 0) {
    console.log('Current and new values are identical. Nothing to replace.')
    return
  }

  console.log(`Current name: ${options.oldName}`)
  console.log(`Current version: ${options.oldVersion}`)
  console.log(`New name: ${options.newName}`)
  console.log(`New version: ${options.newVersion}`)

  const files = await getCandidateFiles(cwd)
  let changedFiles = 0
  let totalReplacements = 0

  for (const filePath of files) {
    const result = await processFile(
      cwd,
      filePath,
      replacements,
      options.dryRun,
    )
    if (!result) {
      continue
    }

    changedFiles++
    totalReplacements += result.replacements
    console.log(
      `${options.dryRun ? '[dry-run] ' : ''}${relative(cwd, result.path)} (${result.replacements})`,
    )
  }

  if (changedFiles === 0) {
    console.log('No matching content was found.')
    console.log(
      'If you changed the project manually before, rerun with --old-name and/or --old-version.',
    )
    return
  }

  if (!options.dryRun) {
    await saveState(cwd, options)
  }

  console.log(
    `${options.dryRun ? 'Preview complete' : 'Replacement complete'}: ${changedFiles} files, ${totalReplacements} replacements.`,
  )
}

void main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
