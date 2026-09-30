# 发布指引（没有 GitHub 账号也能照着做）

这份文档写给「手上有一个做好的 DSH 插件，但还没有 GitHub 账号」的人。
全程大约 15 分钟，只需要浏览器，不需要命令行、不需要 git。

---

## 0. 现在包里已经有什么

```
dsh-adaptive-mode/            仓库根目录
├── README.md                仓库首页：项目介绍（中文）
├── PUBLISH.md               本文件
├── .git/                    已建好的 git 仓库（含一次提交）
├── .github/workflows/       两个 GitHub Action：打 tag 自动发 Release / 发 npm
├── .publish/                打包脚本（不是插件本体）
│   ├── git-objects.mjs      纯 JS 的 git 对象写入器
│   ├── git-init.mjs         建仓 + 首次提交
│   ├── verify-git.mjs       把对象读回来校验一遍
│   └── package-for-upload.mjs  生成下面两个上传件
├── dsh-adaptive-mode/       插件本体（这就是要发布的 npm 包）
│   ├── package.json         包清单：版本、入口、dsh 元数据
│   ├── cordis.patch.yml     bundle 补丁：注册「自适应模式」预设与运行时
│   ├── lib/
│   │   ├── index.js         宿主半边：switch_mode 工具 + /mode 命令
│   │   ├── core.js          纯逻辑：模式匹配、解锁判定、审批结论
│   │   └── client.js        浏览器半边：会话标题旁的可点模式控件
│   ├── test/                20 个单元测试
│   ├── README.md            英文完整说明
│   ├── README.zh.md         中文完整说明
│   └── LICENSE              MIT
└── .publish/dsh-adaptive-mode-1.0.1.tgz   打包好的插件（第 4 步用）
└── .publish/upload-root.zip               要上传的整个仓库（第 3 步用）
```

**这里已经有了一个真正的 git 仓库**（`commit f84c0abc…`）。它不是占位符：
`.publish/verify-git.mjs` 会把每个对象解压回来、校验 SHA-1、并把每个 blob 的字节和磁盘文件逐一比对，
结果是 `problems: 0`。所以你装了 git 之后 `git log`、`git status`、`git push` 都能直接用。

如果之后改了代码想重来一遍：

```
node .publish/git-init.mjs              # 重建仓库与首次提交
node .publish/verify-git.mjs            # 读回来校验
node .publish/package-for-upload.mjs    # 重新生成两个上传件
```

> 这三个脚本只把插件包、仓库级文档、CI 和脚本本身纳入版本控制。
> 它们所在的目录（`D:\deepseek`）里还有别的项目，**不会被**提交进去。

---

## 1. 注册 GitHub 账号

1. 打开 <https://github.com/signup>
2. 填邮箱 → 设密码 → 起用户名（这个用户名会出现在仓库网址里，选定后不好改，想清楚再填）
3. 邮箱收验证码，填进去
4. 通过人机校验

> 邮箱验证可能要等一两分钟，没收到就看垃圾邮件。
> 用户名建议用英文小写加连字符，例如 `yourname`。

---

## 2. 建一个空仓库

1. 右上角 **+** → **New repository**
2. **Repository name** 填 `dsh-adaptive-mode`
3. **Description** 可以填：`自适应模式 for DeepSeek Harness — 解除会话模式锁，AI 可自行切换模式`
4. 选 **Public**（公开）或 **Private**（私有）都行
5. **不要**勾选 `Add a README file`、`.gitignore`、`license` —— 这三样包里已经有了，勾了会多出一次合并麻烦
6. 点 **Create repository**

建好后页面会显示一个空仓库，并给你一段「…or push an existing repository」的提示。**先别管它**，走下一步。

---

## 3. 上传文件（纯网页操作）

### 3.1 准备好上传件

在 `.publish/` 里有两个东西：

| 文件 | 用途 | 大小 |
|---|---|---|
| `upload-root.zip` | **本步骤用**：整个仓库内容（含 `.git`），解压后把里面的东西全部上传 | 约 125 KB |
| `dsh-adaptive-mode-1.0.1.tgz` | 插件本体压缩包，**第 4 步**用 | 约 27 KB |

（如果你拿到的包还没生成这两个文件，在仓库根目录跑一次 `node .publish/package-for-upload.mjs`。）

### 3.2 上传

1. 把 `upload-root.zip` 解压到随便一个临时文件夹
2. 回到刚建好的空仓库页面，点 **uploading an existing file** 链接
   （或直接访问 `https://github.com/<你的用户名>/dsh-adaptive-mode/upload/main`）
3. 把解压出来的**里面的内容**（不是外层文件夹）整个拖进上传框
   —— 包括 `README.md`、`PUBLISH.md`、`dsh-adaptive-mode/` 这个文件夹
4. 页面下方 **Commit changes** 里填一句说明，例如 `第一次提交：自适应模式 v1.0.1`
5. 点 **Commit changes**

稍等几秒，仓库首页就会渲染出 README。

> **关于 `.git` 文件夹**：解压出来的内容里含一个隐藏的 `.git` 目录。
> 网页上传**不会**读取它（浏览器只上传你拖进去的普通文件），所以它既不会捣乱也没用 ——
> 它的用途是你在本地装了 git 之后能直接 `git push`，而不用重新 `git init`。

---

## 4. 想同时发到 npm（可选）

如果你希望别人能用一句 `pnpm add dsh-adaptive-mode` 装上：

1. 注册 <https://www.npmjs.com/signup>（可以选「用 GitHub 账号登录」）
2. 登录后点右上角头像 → **Add New Token** → 选 **Classic Token** → **Automation**，生成后**立刻复制**（页面关掉就再也看不到）
3. 在仓库页面点 **Add file** → **Upload files**，把 `.publish/dsh-adaptive-mode-1.0.1.tgz` 传上去
   —— 或者更省事：本地装好 Node 后，在 `dsh-adaptive-mode/` 目录里执行

   ```
   npm login
   npm publish
   ```

   没有本地环境也没关系，第 5 步的 GitHub Action 可以代你发布。

---

## 5. 让 GitHub 自动发布（不用本地环境）

仓库里已经放好 `.github/workflows/release.yml` 和 `.github/workflows/publish-npm.yml` 的模板。
启用方式：

1. 到 npmjs.com 生成一个 **Automation** token（见上一步）
2. 在你的 GitHub 仓库 → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**
3. Name 填 `NPM_TOKEN`，Secret 填刚才复制的 token
4. 以后只要在 **Releases** 页面点 **Draft a new release**，填一个 `v1.0.1` 这样的 tag 并发布：
   - `release.yml` 会跑测试、打包、把 tgz 挂到 Release 上（这是 DSH 实际安装的东西）
   - `publish-npm.yml` 会把包发到 npm
   - 没设 `NPM_TOKEN` 时第二条会打印一句说明然后跳过，不会一直报红

---

## 6. 之后怎么更新

改完代码后，在 `dsh-adaptive-mode/package.json` 里把 `version` 加一位（例如 `1.0.2`），然后：

**用网页**：进仓库 → 找到改动的文件 → 右上角铅笔图标编辑 → 下方 **Commit changes**。
新增文件用 **Add file** → **Upload files**。

**用本地 git**（装了 git 之后，仓库根目录已初始化好）：

```
git add -A
git commit -m "fix: ..."
git push
```

---

## 7. 提醒

- 目前的 git 提交是我用脚本创建的，作者名是一串占位符。你可以在仓库 **Settings → Emails** 里确认
  「Keep my email addresses private」是开的，然后在本地用
  `git commit --amend --reset-author` 改成你自己的身份；不改也不影响使用。
- `package.json` 里的 `repository` / `homepage` / `bugs` 三个字段现在写的是
  `YOUR-USERNAME`，注册完把 `YOUR-USERNAME` 换成你的 GitHub 用户名即可（三处）。
- 仓库是公开的话，任何人可以下载和再分发 —— MIT 许可允许这样做，这正是开源的意思。
