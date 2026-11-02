# 🍡 麻糬のDDL

[![React Native](https://img.shields.io/badge/React_Native-19.2-61DAFB?logo=react)](https://reactnative.dev/)
[![Expo](https://img.shields.io/badge/Expo-55-000020?logo=expo)](https://expo.dev/)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Offline](https://img.shields.io/badge/100%25-Offline-1f7a1f)](README.md)

> 一款 **Y2K 像素风 · 离线优先 · 数据自主** 的 DDL 管理与生存模拟器。
> 告别死板的待办清单 —— 每一个 DDL，都是你和麻糬精灵共同面对的生存保卫战 🔫

---

## ✨ 功能特性

### 🍡 麻糬精灵 —— 你的 DDL 生存伙伴
- **拟真状态机**：HP、SAN、磨损值实时波动，活力满满、疲惫摆烂、焦虑暴走、濒死霓虹 🌃
- **互动反馈**：戳一戳触发随机吐槽或打气气泡，附带触觉震动
- **养成与成就**：从「新手布丁」一路进化到「死线大魔王」，解锁数十段专属段位

### ⏰ DDL 危机管理
- **秒级倒计时仪表盘**：实时跳动 + 四级色阶警报（🟢 安全 / 🟡 警戒 / 🌸 暴走 / 💜 濒死霓虹）
- **心理提前量（Cutoff Setting）**：内置截止缓冲折算算法，帮你提前拦截拖延
- **精细分级归档**：多分类标签 · 优先级置顶 · 倒计时 / 创建时间多维度排序
- **重复任务**：每日 / 每周 / 每月循环，月末锚点自动回弹，完成与生成下一期原子提交
- **多级提醒防遗漏**：24h · 6h · 1h · 自定义偏移 · 心理截止节点，冷启动自动校对

### ⏳ 专注心流 · 合法摸鱼
- **双模态计时器**：正向专注、番茄钟冲刺，以及合（理）法（化）摸鱼计时
- **4 小时封顶保护**：超长挂机自动安全上限，防刷分也防自习清零 🔒
- **统一计时引擎**：仅累加运行段、排除暂停段，跨日按日切点自动拆分结算
- **摸鱼精力结算**：今日自律效率比率，一眼看清你的真实产出

### 💬 语录与金句
- **每日固定一句**：启动即锁定，治愈或毒舌，陪你一整天
- **自定义语录库**：添加专属片段，支持导出备份

### 📊 生存日报
- **Y2K 潮流海报**：一键生成今日战报，复古排版，点按保存相册
- **全景数据走势**：专注时长分布 · DDL 准时完结率 · 历史效率曲线

### ☁️ 多机安全同步（WebDAV · 端到端加密）
- **自带云（BYOC）**：填入自己的坚果云 WebDAV 地址、账号与应用密码即可启用，不依赖官方后端
- **零知识加密**：数据在本机完成 AES-GCM-256 加密后上传，远端只保存密文
- **增量双向同步**：Outbox 变更日志 + 逻辑时钟 + 软删除墓碑，多端离线编辑后可安全合并
- **多机恢复**：支持同步密码 / 恢复密钥双通道解锁，历史快照可回溯

### 🔒 隐私与离线
- **纯本地 SQLite**：所有数据留在设备，离线 100% 可用
- **无账号无后端**：不收集、不上传、不追踪
- **JSON 全量备份**：单文件导入导出，换机无感还原
- **可选云同步**：仅在主动配置 WebDAV 后启用，数据以密文存于用户自有云空间

---

## 🛠 技术栈

| 模块 | 选型 |
| :--- | :--- |
| 运行时 | [React Native](https://reactnative.dev/) 19 · [Expo](https://expo.dev/) 55 |
| 路由 | [Expo Router](https://docs.expo.dev/router/introduction/)（文件系统式嵌套 Stack/Tabs） |
| 样式 | [NativeWind v4](https://www.nativewind.dev/)（Tailwind CSS v3 + 语义化主题） |
| 存储 | [expo-sqlite](https://docs.expo.dev/versions/latest/sdk/sqlite/)（本地 SQLite · Web 内存回退） |
| 同步 | WebDAV / 坚果云适配器 · 自建增量双向同步引擎 |
| 加密 | [expo-crypto](https://docs.expo.dev/versions/latest/sdk/crypto/) · AES-GCM-256 · PBKDF2 |
| 集成 | expo-notifications · expo-haptics · expo-media-library · expo-secure-store |
| 图标 | Lucide React Native |

---

## 🚀 快速开始

```bash
# 1. 克隆并安装
git clone https://github.com/hongmuyu/Mochi-DDL.git
cd Mochi-DDL
pnpm install

# 2. 启动开发服务器（Android / iOS / Web 均可预览）
pnpm start

# 3. 代码检查
pnpm run lint
```

---

## 📦 Android APK 构建

```bash
# 方案 A：EAS 云端构建（推荐，免配 Android SDK）
npm i -g eas-cli
eas login
eas build --platform android --profile preview

# 方案 B：本地编译（需 Android Studio + JDK 17+）
pnpm exec expo run:android --variant release
```

下载最新 APK → 前往 [GitHub Releases](https://github.com/hongmuyu/Mochi-DDL/releases)

---

## 📱 隐私声明

- 🚫 **无账号注册**：即开即用，不收集任何身份信息
- 🖥️ **本地优先存储**：所有任务、计时、语录默认留在设备沙盒内
- 🎨 **权限最小化**：仅在主动保存海报到相册、设置到期提醒时申请对应权限
- ☁️ **可选云同步**：仅在用户主动配置自有 WebDAV 后启用，数据端到端加密后存入用户自己的云空间

---

## 📄 License

[MIT](LICENSE)
