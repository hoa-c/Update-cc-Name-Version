import { existsSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createInterface } from 'readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const ROOT = process.cwd();
const CLAWD_PATH = resolve(ROOT, 'src', 'components', 'LogoV2', 'Clawd.tsx');
const ANIMATED_PATH = resolve(
  ROOT,
  'src',
  'components',
  'LogoV2',
  'AnimatedClawd.tsx',
);
const BACKUP_DIR = resolve(ROOT, '.clawd-replace-backup');
const BACKUP_CLAWD_PATH = resolve(BACKUP_DIR, 'Clawd.tsx');
const BACKUP_ANIMATED_PATH = resolve(BACKUP_DIR, 'AnimatedClawd.tsx');
const PATCH_MARKER = 'CLAWD_PATCHED_BY_SCRIPT';

type ClawdPose = 'default' | 'look-left' | 'look-right' | 'arms-up';
type SpriteSet = Record<ClawdPose, string[]>;

type CliOptions = {
  preset?: string;
  listPresets: boolean;
  dryRun: boolean;
  reset: boolean;
  help: boolean;
};

type Preset = {
  description: string;
  sprites: SpriteSet;
};

type SelectedTheme = {
  description: string;
  sprites: SpriteSet;
};

type SelectionResult =
  | {
      kind: 'theme';
      value: SelectedTheme;
    }
  | {
      kind: 'reset';
    };

type SourcePair = {
  clawd: string;
  animated: string;
};

const POSE_ORDER: ClawdPose[] = [
  'default',
  'look-left',
  'look-right',
  'arms-up',
];

const PRESETS: Record<string, Preset> = {
  cow: {
    description: '经典 ASCII 牛，按你给的写实风格直接内置。',
    sprites: {
      default: [
        '         ^__^         ',
        '         (oo)\\_______ ',
        '         (__)\\       )\\/\\',
        '             ||----w |   ',
        '             ||     ||   ',
      ],
      'look-left': [
        '         ^__^         ',
        '         (o-)\\_______ ',
        '         (__)\\       )\\/\\',
        '             ||----w |   ',
        '             ||     ||   ',
      ],
      'look-right': [
        '         ^__^         ',
        '         (-o)\\_______ ',
        '         (__)\\       )\\/\\',
        '             ||----w |   ',
        '             ||     ||   ',
      ],
      'arms-up': [
        '        \\^__^/        ',
        '         (oo)\\_______ ',
        '         (__)\\       )\\/\\',
        '             ||----w |   ',
        '             ||     ||   ',
      ],
    },
  },
  dog: {
    description: '经典 ASCII 狗，按你给的写实风格直接内置。',
    sprites: {
      default: [
        '         / \\__         ',
        '        (    @\\____    ',
        '         /         O   ',
        '        /   (_____/    ',
        '       /_____/   U     ',
      ],
      'look-left': [
        '         / \\__         ',
        '        (    <\\____    ',
        '         /         O   ',
        '        /   (_____/    ',
        '       /_____/   U     ',
      ],
      'look-right': [
        '         / \\__         ',
        '        (    >\\____    ',
        '         /         O   ',
        '        /   (_____/    ',
        '       /_____/   U     ',
      ],
      'arms-up': [
        '        \\ /\\__/       ',
        '         (   @\\____    ',
        '          /        O   ',
        '         /  (_____/    ',
        '        /____/   U     ',
      ],
    },
  },
};

function printHelp(): void {
  console.log(`用法:
  bun clawd-replace.ts --preset cow
  bun clawd-replace.ts --list-presets
  bun clawd-replace.ts --reset

参数:
  --preset <name>    使用内置预设
  --list-presets     查看所有预设
  --dry-run          只预览，不真正写文件
  --reset            恢复源码原始版
  --help, -h         查看帮助

说明:
  - 默认仓库源码不改，只有执行脚本时才会 patch
  - 脚本会修改 Clawd.tsx 和 AnimatedClawd.tsx
  - 首次执行会在根目录生成 .clawd-replace-backup 备份
  - --reset 会恢复原始源码，并清理备份目录
`);
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    listPresets: false,
    dryRun: false,
    reset: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    switch (arg) {
      case '--preset':
        options.preset = argv[++index];
        break;
      case '--height':
        throw new Error('--height 已不再支持。');
      case '--list-presets':
        options.listPresets = true;
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--reset':
        options.reset = true;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        throw new Error(`未知参数: ${arg}`);
    }
  }

  return options;
}

function charLength(value: string): number {
  return Array.from(value).length;
}

function repeat(fill: string, count: number): string {
  return fill.repeat(Math.max(0, count));
}

function centerLine(value: string, width: number): string {
  const chars = Array.from(value);
  const trimmed = chars.slice(0, width).join('');
  const padding = width - charLength(trimmed);
  const left = Math.floor(padding / 2);
  const right = padding - left;
  return `${repeat(' ', left)}${trimmed}${repeat(' ', right)}`;
}

function normalizeSpriteSet(sprites: SpriteSet): SpriteSet {
  const width = Math.max(
    ...POSE_ORDER.flatMap(pose => sprites[pose].map(line => charLength(line))),
  );
  const height = Math.max(...POSE_ORDER.map(pose => sprites[pose].length));

  const normalizedEntries = POSE_ORDER.map(pose => {
    const lines = sprites[pose].map(line => centerLine(line, width));
    while (lines.length < height) {
      lines.push(repeat(' ', width));
    }
    return [pose, lines] as const;
  });

  return Object.fromEntries(normalizedEntries) as SpriteSet;
}

function serializeSpriteSet(sprites: SpriteSet): string {
  const lines = POSE_ORDER.map(pose => {
    const serializedLines = sprites[pose]
      .map(line => `    ${JSON.stringify(line)},`)
      .join('\n');

    return `  ${JSON.stringify(pose)}: [\n${serializedLines}\n  ],`;
  }).join('\n');

  return `export const SPRITES: SpriteSet = {\n${lines}\n};`;
}

function buildClawdSource(sprites: SpriteSet): string {
  return `import * as React from 'react';
import { Box, Text } from '../../ink.js';

// ${PATCH_MARKER}
export type ClawdPose = 'default' | 'arms-up' | 'look-left' | 'look-right';
export type SpriteSet = Record<ClawdPose, readonly string[]>;

${serializeSpriteSet(sprites)}

export const CLAWD_HEIGHT = Math.max(
  ...Object.values(SPRITES).map(sprite => sprite.length),
);

type Props = {
  pose?: ClawdPose;
};

export function Clawd({ pose = 'default' }: Props) {
  const sprite = SPRITES[pose] ?? SPRITES.default;

  return (
    <Box flexDirection="column">
      {sprite.map((line, index) => (
        <Text key={\`\${pose}-\${index}\`} color="clawd_body">
          {line}
        </Text>
      ))}
    </Box>
  );
}
`;
}

function buildAnimatedSource(): string {
  return `import * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import { Box } from '../../ink.js';
import { getInitialSettings } from '../../utils/settings/settings.js';
import { CLAWD_HEIGHT, Clawd, type ClawdPose } from './Clawd.js';

// ${PATCH_MARKER}
type Frame = {
  pose: ClawdPose;
  offset: number;
};

function hold(pose: ClawdPose, offset: number, frames: number): Frame[] {
  return Array.from({ length: frames }, () => ({
    pose,
    offset,
  }));
}

const JUMP_WAVE: readonly Frame[] = [
  ...hold('default', 1, 2),
  ...hold('arms-up', 0, 3),
  ...hold('default', 0, 1),
  ...hold('default', 1, 2),
  ...hold('arms-up', 0, 3),
  ...hold('default', 0, 1),
];

const LOOK_AROUND: readonly Frame[] = [
  ...hold('look-right', 0, 5),
  ...hold('look-left', 0, 5),
  ...hold('default', 0, 1),
];

const CLICK_ANIMATIONS: readonly (readonly Frame[])[] = [
  JUMP_WAVE,
  LOOK_AROUND,
];

const IDLE: Frame = {
  pose: 'default',
  offset: 0,
};

const FRAME_MS = 60;
const incrementFrame = (index: number) => index + 1;

export function AnimatedClawd() {
  const { pose, bounceOffset, onClick } = useClawdAnimation();

  return (
    <Box height={CLAWD_HEIGHT} flexDirection="column" onClick={onClick}>
      <Box marginTop={bounceOffset} flexShrink={0}>
        <Clawd pose={pose} />
      </Box>
    </Box>
  );
}

function useClawdAnimation(): {
  pose: ClawdPose;
  bounceOffset: number;
  onClick: () => void;
} {
  const [reducedMotion] = useState(
    () => getInitialSettings().prefersReducedMotion ?? false,
  );
  const [frameIndex, setFrameIndex] = useState(-1);
  const sequenceRef = useRef<readonly Frame[]>(JUMP_WAVE);

  const onClick = () => {
    if (reducedMotion || frameIndex !== -1) {
      return;
    }

    sequenceRef.current =
      CLICK_ANIMATIONS[Math.floor(Math.random() * CLICK_ANIMATIONS.length)]!;
    setFrameIndex(0);
  };

  useEffect(() => {
    if (frameIndex === -1) {
      return;
    }

    if (frameIndex >= sequenceRef.current.length) {
      setFrameIndex(-1);
      return;
    }

    const timer = setTimeout(setFrameIndex, FRAME_MS, incrementFrame);
    return () => clearTimeout(timer);
  }, [frameIndex]);

  const sequence = sequenceRef.current;
  const current =
    frameIndex >= 0 && frameIndex < sequence.length
      ? sequence[frameIndex]!
      : IDLE;

  return {
    pose: current.pose,
    bounceOffset: current.offset,
    onClick,
  };
}
`;
}

async function readSource(path: string): Promise<string> {
  return Bun.file(path).text();
}

async function tryLoadOriginalFromGit(): Promise<SourcePair | null> {
  const clawd = Bun.spawnSync({
    cmd: ['git', 'show', 'HEAD:src/components/LogoV2/Clawd.tsx'],
    cwd: ROOT,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const animated = Bun.spawnSync({
    cmd: ['git', 'show', 'HEAD:src/components/LogoV2/AnimatedClawd.tsx'],
    cwd: ROOT,
    stdout: 'pipe',
    stderr: 'pipe',
  });

  if (clawd.exitCode !== 0 || animated.exitCode !== 0) {
    return null;
  }

  return {
    clawd: new TextDecoder().decode(clawd.stdout),
    animated: new TextDecoder().decode(animated.stdout),
  };
}

async function loadCurrentSources(): Promise<SourcePair> {
  return {
    clawd: await readSource(CLAWD_PATH),
    animated: await readSource(ANIMATED_PATH),
  };
}

async function ensureBackup(): Promise<void> {
  if (existsSync(BACKUP_CLAWD_PATH) && existsSync(BACKUP_ANIMATED_PATH)) {
    return;
  }

  const current = await loadCurrentSources();
  const patched =
    current.clawd.includes(PATCH_MARKER) ||
    current.animated.includes(PATCH_MARKER);

  const originals = patched ? await tryLoadOriginalFromGit() : current;

  if (!originals) {
    throw new Error(
      '当前源码已经是脚本改写状态，但没有找到备份，也无法从 git 恢复原始文件。',
    );
  }

  await mkdir(BACKUP_DIR, { recursive: true });
  await Bun.write(BACKUP_CLAWD_PATH, originals.clawd);
  await Bun.write(BACKUP_ANIMATED_PATH, originals.animated);
}

async function loadOriginalSources(): Promise<SourcePair> {
  if (existsSync(BACKUP_CLAWD_PATH) && existsSync(BACKUP_ANIMATED_PATH)) {
    return {
      clawd: await readSource(BACKUP_CLAWD_PATH),
      animated: await readSource(BACKUP_ANIMATED_PATH),
    };
  }

  const originals = await tryLoadOriginalFromGit();
  if (originals) {
    return originals;
  }

  throw new Error('没有找到备份，也无法从 git 恢复原始源码。');
}

async function cleanupBackup(): Promise<void> {
  if (existsSync(BACKUP_DIR)) {
    await rm(BACKUP_DIR, { recursive: true, force: true });
  }
}

async function writePatchedSources(sprites: SpriteSet): Promise<void> {
  await Bun.write(CLAWD_PATH, buildClawdSource(sprites));
  await Bun.write(ANIMATED_PATH, buildAnimatedSource());
}

async function restoreOriginalSources(): Promise<void> {
  const originals = await loadOriginalSources();
  await Bun.write(CLAWD_PATH, originals.clawd);
  await Bun.write(ANIMATED_PATH, originals.animated);
  await cleanupBackup();
}

function printPresetList(): void {
  console.log('内置预设:');
  for (const [name, preset] of Object.entries(PRESETS)) {
    const height = normalizeSpriteSet(preset.sprites).default.length;
    console.log(`- ${name} (${height} 行): ${preset.description}`);
  }
}

async function promptSelection(options: CliOptions): Promise<SelectionResult> {
  if (options.preset) {
    const preset = PRESETS[options.preset];
    if (!preset) {
      throw new Error(`没有找到预设 ${options.preset}，可以先执行 --list-presets 查看。`);
    }

    return {
      kind: 'theme',
      value: {
        description: `预设 ${options.preset}`,
        sprites: normalizeSpriteSet(preset.sprites),
      },
    };
  }

  const rl = createInterface({ input, output });
  try {
    const mode = (await rl.question('选择模式（preset / reset）: '))
      .trim()
      .toLowerCase();

    if (mode === 'reset') {
      return { kind: 'reset' };
    }

    if (mode === 'preset') {
      printPresetList();
      const presetName = (await rl.question('输入预设名称: ')).trim();
      const preset = PRESETS[presetName];
      if (!preset) {
        throw new Error(`没有找到预设 ${presetName}。`);
      }
      return {
        kind: 'theme',
        value: {
          description: `预设 ${presetName}`,
          sprites: normalizeSpriteSet(preset.sprites),
        },
      };
    }

    throw new Error('只支持 preset、reset 两种模式。');
  } finally {
    rl.close();
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  if (options.listPresets) {
    printPresetList();
    return;
  }

  if (options.reset) {
    if (options.dryRun) {
      console.log('dry-run: 将恢复 Clawd.tsx 和 AnimatedClawd.tsx 为原始源码。');
      return;
    }

    await restoreOriginalSources();
    console.log('已恢复原始源码，并清理 .clawd-replace-backup。');
    return;
  }

  const selection = await promptSelection(options);
  if (selection.kind === 'reset') {
    if (options.dryRun) {
      console.log('dry-run: 将恢复 Clawd.tsx 和 AnimatedClawd.tsx 为原始源码。');
      return;
    }

    await restoreOriginalSources();
    console.log('已恢复原始源码，并清理 .clawd-replace-backup。');
    return;
  }

  const selected = selection.value;
  console.log(`已选择: ${selected.description}`);
  console.log('默认姿态预览:');
  console.log(selected.sprites.default.join('\n'));

  if (options.dryRun) {
    console.log('dry-run 模式，不写入文件。');
    return;
  }

  await ensureBackup();
  await writePatchedSources(selected.sprites);
  console.log('已 patch Clawd.tsx 和 AnimatedClawd.tsx。');
  console.log(`备份目录: ${BACKUP_DIR}`);
}

if (import.meta.main) {
  void main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
