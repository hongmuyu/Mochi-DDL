# 欢迎使用你的秒哒应用代码包
秒哒应用链接
    URL:https://www.miaoda.cn/projects/app-bmlmo7hbv9c1

# 麻糬のDDL (DDLife - DDL Simulator)

> 🍡 **专为死线拖延症患者打造的 Y2K 像素风本地离线 DDL 管理与生存模拟器**

---

## 📖 项目简介

**麻糬のDDL** 是一款融合 **Y2K 复古电子像素美学**、**精灵陪伴养成** 与 **硬核任务管理** 的移动端 DDL 治理应用。

告别死板乏味的待办清单，在这里，每一个即将到期的 DDL 都是一场与「麻糬精灵」共同面对的生存保卫战！你可以在专注冲刺时让麻糬能量爆棚，也可以在合理摸鱼时平衡精力，更有每日金句、段位成就、生存日报与数据自主守护。

---

## 🚦 当前能力与运行状态（重要）

> 一句话概括：**核心应用为「纯本地离线」架构，全部功能开箱即用；云同步为「可选的自带云（BYOC）」能力，需用户自备坚果云 WebDAV 账号后生效。**

| 能力 | 是否具备 | 是否已可实际运行 | 说明 |
| :--- | :---: | :---: | :--- |
| **本地离线核心功能**（任务/计时/语录/统计/日报/成就） | ✅ | ✅ 已运行 | 全部数据存于本机 SQLite，无需联网、无需账号 |
| **本地通知提醒** | ✅ | ✅ 已运行 | 24h/6h/1h/自定义/心理截止多节点，纯端侧调度 |
| **生存日报海报 + 相册保存** | ✅ | ✅ 已运行 | 端侧截图，仅在保存时申请相册权限 |
| **本地数据备份/恢复（JSON 单文件）** | ✅ | ✅ 已运行 | 全量导出/导入，含跨设备内容校验和 |
| **云同步（WebDAV / 坚果云 E2EE）** | ✅ 代码完整 | ⚠️ 需自备账号 | 零知识端到端加密，用户填入自己的坚果云 WebDAV 应用密码后即可用；**尚未用真实坚果云账号做过端到端验证** |
| **账号登录 / 注册** | ❌ 未启用 | ❌ 不运行 | 纯本地应用，无账号体系；`(auth)/sign-in` 为占位路由，`ctx.tsx` 会话恒为空 |
| **云数据库（Supabase）** | ❌ 未接入 | ❌ 不运行 | `.env` 中残留 Supabase 凭据，但代码中**无任何 Supabase 调用**，也无 `supabase.ts` 客户端，数据不经过任何云端数据库 |
| **自建服务端 / Edge Functions** | ❌ 无 | ❌ 不运行 | 无后端服务、无服务端函数 |

**结论**：
- 已经能实际运行的 = 全部本地离线功能（任务管理、专注/摸鱼计时、语录、统计、日报海报、成就、本地通知、本地备份）+ 本地 SQLite 存储。
- 云同步功能代码已完整实现，但属于「自带云」模式，只有在用户于「同步中心」页面配置自己的坚果云 WebDAV 账号 + 应用密码后才能真正联网同步；且该链路尚未用真实账号完成端到端验证。
- 登录、云数据库、自建服务端目前均**不存在/未启用**，项目不依赖任何 Miaoda 后端。

---

## ✨ 核心特性

### 🍡 1. 麻糬精灵伴随与状态模拟
- **拟真状态机**：麻糬拥有活力、疲惫、焦虑、暴走等多种即时情绪反应，随任务进展与摸鱼节奏动态变化。
- **互动敲打**：点击主页麻糬精灵触发专属随机吐槽或打气气泡，伴触觉反馈与趣味动效。
- **精灵卡片与成就**：见证麻糬从新手布丁进化为「死线大魔王」，解锁千禧风段位与专属成就。

### ⏰ 2. 硬核 DDL 危机管理
- **倒计时危机感仪表盘**：秒级倒计时跳动、多级色阶警报（安全绿 / 警戒黄 / 暴走粉红 / 濒死霓虹紫）。
- **个性化截止缓冲（Cutoff Setting）**：心理提前量截止折算算法，提前拦截拖延。
- **精细分级与状态归档**：多分类标签、优先级置顶、按倒计时/创建时间多维度排序；进行中/已完成/回收站分页浏览。
- **重复任务强一致**：支持每日/每周/每月重复，月末 31 日锚点自动回弹，完成与生成下一期在同一事务内原子完成，撤销完成智能联动。
- **多级提醒防遗漏**：24h、6h、1h、自定义偏移与心理截止多节点系统通知，集中式调度、冷启动全量校对、同时间去重。

### ⏳ 3. 专注心流与合法摸鱼（Slack Timer）
- **双模态计时器**：正向心流专注、番茄钟冲刺与「合法摸鱼」计时。
- **统一计时引擎**：仅累加运行段、排除暂停段，单次超长挂机按 4 小时安全上限封顶，跨日自动按日切点拆分结算。
- **摸鱼精力结算**：科学记录学习与休闲时长，自动生成今日自律效率比率。

### 💬 4. 每日语录与自定义金句库
- **今日固定一句**：每日启动锁定一条精选治愈或反拖延名言。
- **自定义毒舌/打气库**：支持添加专属语录，支持导出分享与备份。

### 📊 5. 生存日报与数据可视化
- **Y2K 潮流海报生成**：一键生成今日生存战报，支持保存至相册；动态预览随数据实时更新，历史收藏快照独立固化保存。
- **统一统计口径**：按时完成率（压线完成计入未逾期、无数据展示「暂无数据」）、逾期未完成单独展示、平均睡眠仅统计明确录入日、连续天数按连续逻辑日计算。

### 🔒 6. 本地离线、隐私保护与数据自主
- **本地 SQLite 驱动**：全功能离线可用，数据不上传云端。
- **版本化迁移与灾难恢复**：数据库 Schema 版本化迁移，健康模型区分文件库/内存库，损坏可恢复。
- **数据自主备份与迁移**：单文件 JSON 全量导入/导出，含内容校验和与字段白名单防注入。
- **可选云同步**：自带云（坚果云 WebDAV）零知识端到端加密增量双向同步（见上文运行状态说明）。

---

## 🛠️ 技术栈与架构

| 模块 | 选型与说明 |
| :--- | :--- |
| **运行时框架** | [React Native](https://reactnative.dev/) 0.83 + [Expo SDK 55](https://docs.expo.dev/) |
| **语言** | TypeScript 5.9 |
| **路由导航** | [Expo Router](https://docs.expo.dev/router/introduction/)（文件系统式导航 + Stack/Tabs 嵌套，typedRoutes） |
| **界面与样式** | [NativeWind v4](https://www.nativewind.dev/)（Tailwind CSS v3 语义化设计系统）+ [Lucide Icons](https://lucide.dev/) |
| **UI 组件库** | `@rn-primitives/*` + `react-native-reusables` 风格组件（`src/components/ui/`） |
| **本地存储引擎** | [expo-sqlite](https://docs.expo.dev/versions/latest/sdk/sqlite/)（版本化迁移 SQLite + Web 内存回退容错） |
| **轻量配置缓存** | `@react-native-async-storage/async-storage`（语录、首选项、同步配置持久化） |
| **敏感信息存储** | `expo-secure-store`（同步密码/密钥，Web 端自动回退 localStorage） |
| **加密** | `expo-crypto`（云同步端到端加密、备份内容校验和） |
| **设备系统集成** | `expo-haptics`（触感）、`expo-notifications`（本地通知）、`expo-media-library`（相册保存）、`expo-sharing`/`react-native-view-shot`（海报截图分享）、`expo-clipboard`、`expo-device`、`expo-battery` |
| **日期选择** | `react-native-ui-datepicker`（跨端日期/时间选择） |
| **动效** | `react-native-reanimated` + `react-native-gesture-handler` |
| **构建/校验** | `miaoda-expo-devkit`（devkit-lint）、Biome / oxlint、Metro Bundler |

> ⚠️ 说明：`package.json` 中不含 `@supabase/supabase-js`，`src/` 中无任何 Supabase 调用 —— 本项目当前**不使用云数据库**。

---

## 📁 页面与目录结构

```text
src/
├── app/
│   ├── _layout.tsx                     # 全局根布局（手势、弹窗容器、状态栏、隐私协议、数据库健康检测）
│   ├── index.tsx                       # 引导与主入口
│   ├── onboarding.tsx                  # 新手引导
│   ├── (auth)/
│   │   └── sign-in.tsx                 # 占位路由（纯本地应用，直接重定向到首页）
│   └── (app)/
│       ├── _layout.tsx                 # 核心应用导航 Stack
│       ├── (tabs)/
│       │   ├── _layout.tsx             # 底部五标签栏
│       │   ├── home.tsx                # [Tab] 首页仪表盘（麻糬精灵、每日一句、核心DDL）
│       │   ├── ddl.tsx                 # [Tab] 死线管理（分页列表、筛选、新建、状态流转）
│       │   ├── slack.tsx               # [Tab] 专注与摸鱼计时器
│       │   ├── card.tsx                # [Tab] 麻糬身份卡与生存日报导出
│       │   └── settings.tsx            # [Tab] 系统设置中心
│       ├── stats.tsx                   # 统计分析与历史折线图
│       ├── quotes.tsx                  # 自定义语录管理库
│       ├── cutoff-settings.tsx         # 心理提前量与预警规则设置
│       ├── data-backup.tsx             # 本地数据导入/导出与恢复
│       ├── webdav-sync.tsx             # 云同步中心（坚果云 WebDAV，可选）
│       ├── achievements.tsx            # 勋章与成就墙
│       ├── about.tsx                   # 关于产品与版本说明
│       └── privacy-policy.tsx          # 离线隐私保护条款
├── db/
│   ├── database.ts                     # SQLite 初始化、版本化迁移、健康模型
│   └── api.ts                          # 任务/记录/统计/重复任务/分页/备份 的 CRUD 与聚合封装
├── ctx/
│   └── PerformanceContext.tsx          # 设备省电模式与性能优化上下文
├── lib/
│   ├── ddl.ts                          # 倒计时精算、危急级别、色阶判定
│   ├── state.ts                        # 麻糬 HP/SAN/磨损值状态机
│   ├── timerEngine.ts                  # 统一计时引擎（运行/暂停分段、封顶、跨日结算）
│   ├── timerStore.ts                   # 计时持久化与跨日切线拆分
│   ├── repeatRule.ts                   # 重复任务计划周期与月末锚点算法
│   ├── dataEventBus.ts                 # 轻量跨页面数据变更事件总线（防竞态版本戳）
│   ├── cardCache.ts                    # 日报缓存（数据版本失效）与历史快照隔离
│   ├── cardStorage.ts                  # 卡片/快照存储
│   ├── achievements.ts                 # 勋章定义与解锁判定
│   ├── notifications.ts                # 集中式本地通知调度、校对与去重
│   ├── quotesDb.ts                     # 语录专用独立本地数据库
│   ├── personality.ts / taunts.ts      # 精灵性格与吐槽文案
│   ├── sync/                           # 可选云同步模块（BYOC）
│   │   ├── syncEngine.ts               # 增量双向同步引擎（Outbox/Lamport/墓碑）
│   │   ├── webdavClient.ts             # WebDAV / 坚果云适配器
│   │   ├── cryptoEngine.ts             # 端到端加密与恢复密钥
│   │   ├── restoreManager.ts           # 恢复与写保护
│   │   └── deviceManager.ts            # 设备标识管理
│   ├── theme.ts                        # Y2K 配色规范与色彩变量
│   └── utils.ts                        # 样式合并与常用辅助工具
└── components/
    ├── MochiWidget/                    # 麻糬精灵组件
    ├── DatabaseRecoveryModal.tsx       # 数据库损坏恢复弹窗
    ├── AchievementUnlockModal.tsx      # 成就解锁弹窗
    ├── NewbieGuideModal.tsx            # 新手引导弹窗
    └── ui/                             # react-native-reusables 风格基础组件
```

---

## 🚀 快速开始与本地开发

### 1. 安装依赖
```bash
pnpm install
```

### 2. 代码规范与类型检查
```bash
pnpm run lint
```

### 3. 自动化测试套件
```bash
# 核心业务算法与公式测试
npx tsx tasks/test_formulas.ts
# 第一批：可靠性批次（迁移/备份/计时/日切结算）
npx tsx tasks/test_reliability_batch.ts
# 第二批：业务一致性（分页/统计口径/重复任务/通知/缓存）
npx tsx tasks/test_business_consistency.ts
```

### 4. 启动开发服务器
```bash
pnpm start        # 支持 iOS / Android / Web 预览
```

---

## 📦 Android APK 构建指南

### 方案 A：通过 Expo EAS 云端构建（推荐，免配置 Android SDK）
```bash
npm install -g eas-cli
eas login
eas build --platform android --profile preview
```

### 方案 B：本地编译构建（需 Android Studio + JDK 17+）
```bash
pnpm exec expo run:android --variant release
```

---

## 📱 离线与隐私声明
- **无账号注册**：无需手机号、邮箱或社交账号登录，即开即用。
- **纯本地存储**：所有任务、计时、语录、成就均存于本地沙盒 SQLite，离线功能完全一致。
- **权限最小化**：仅在保存海报时申请相册权限，在设定提醒时申请本地通知权限。
- **可选同步**：如启用云同步，数据以零知识端到端加密后存储于用户自己的坚果云空间，应用不接触明文。

---

## 📄 License
MIT License
