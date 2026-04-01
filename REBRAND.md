# Rebrand Script Guide

根目录脚本：

`rebrand.ts`

用途：

- 批量替换项目名称
- 批量替换版本号
- 支持反复执行，不是只能改一次

## 推荐使用方式

第一次：

```bash
bun rebrand.ts --dry-run --name "Your Brand" --version "3.0.0"
bun rebrand.ts --name "Your Brand" --version "3.0.0"
```

第二次以及以后：

```bash
bun rebrand.ts --name "Another Brand" --version "4.0.0"
```

## 注意事项

- 请在项目根目录运行
- 建议执行前先提交一次 Git
- 脚本不会修改自身 `rebrand.ts`
- 脚本不会修改状态文件 `.rebrand-state.json`
- 如果你还要改包名、仓库地址、命令名，建议替换后再人工检查一次
