# Clawd 替换说明

脚本文件：

`/clawd-replace.ts`

它会在你执行时修改：

- `/src/components/LogoV2/Clawd.tsx`
- `/src/components/LogoV2/AnimatedClawd.tsx`

当前内置预设只有两个：

- `cow`
- `dog`

## 查看预设

```bash
bun clawd-replace.ts --list-presets
```

## 预览

只预览，不真正修改：

```bash
bun clawd-replace.ts --dry-run --preset cow
```

如果想看狗：

```bash
bun clawd-replace.ts --dry-run --preset dog
```

## 设置

正式应用牛：

```bash
bun clawd-replace.ts --preset cow
```

正式应用狗：

```bash
bun clawd-replace.ts --preset dog
```

## 恢复

恢复原始源码：

```bash
bun clawd-replace.ts --reset
```
