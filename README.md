# minduploading

当前项目根目录为 `D:\gitstore\dreamfly`，前端、后端、Compose 与 Git 均从此目录组织，不再使用外层 `source/` 目录。

- [公共平台实现计划](docs/PUBLIC_PLATFORM_IMPLEMENTATION_PLAN.md)
- [依赖安装与 Conda 配置](docs/DEPENDENCIES.md)
- [初始代码分析](docs/IMPLEMENTATION_PLAN.md)

前端位于 `src/`，可运行后端位于 `server/`，共享 Skill 格式模块位于 `packages/mind-format/`。已实现邮箱注册/会话、Skill 版本与权限、用户模型配置、MindCopy 流式交互和 GitHub 后台同步。服务器 Docker 部署暂缓；当前 Compose 仍只提供基础设施。

- [本地启动、配置与已知边界](docs/LOCAL_DEVELOPMENT.md)
- [统一 API 使用说明](docs/API.md)
- [实施状态与验证记录](docs/IMPLEMENTATION_STATUS.md)

下方保留原项目介绍；其中微调、语音克隆等愿景不代表当前实现。

## `README.md`

# 🧠 DreamFly Mind Engine · 云己 · Mind Uploading L1 Framework

> “我们无法永生，但我们的思想可以。”  
> “We cannot live forever — but our minds might.”

> ✨ Let's create something that Steve Jobs would build in 2025.

---

## 🚀 What is DreamFly Mind Engine?

**DreamFly Mind Engine** is the Level-1 implementation of the consciousness uploading roadmap, enabling individuals to create `.mind` files — compact, structured containers of personal cognition, memory, values, and linguistic personality.

本项目是**意识上传第一范式**的第一阶段工程实现。我们构建了一个开源框架，帮助每一个人用不到10MB的数据，存储下自己的数字意识体。

This is not sci-fi. It’s an early step towards **digital immortality**.

---

## 🌐 Four-Level Roadmap for Mind Uploading / 意识上传四级路线图

| Level | Name                       | Description                                         |
|-------|----------------------------|-----------------------------------------------------|
| L1    | mindcopy (语言建模上传)       | Fine-tuned LLMs based on personal data.             |
| L2    | EEG-to-Text Decoding       | Non-invasive brain signal to semantic decoding.     |
| L3    | Gradual Neural Substitution| BCI-based substrate replacement for continuity.     |
| L4    | Predictive Consciousness   | Pre-emptive cognition generation — YES or NEVER.    |

> 👁️‍🗨️ 本仓库即为 L1 实现核心源码。上传你的一份 `.mind`，也许它会陪伴你走过死亡的门槛。

---

## 📂 What's in this Repo?

```bash
.
├── mindcopy/               # L1 Engine: Personal LLM fine-tuning pipeline
├── schema/                 # .mind file JSON spec
├── examples/               # Sample minds: Steve.mind, AI philosophers, etc.
├── ui/                     # Optional frontend for mind visualization
└── docs/                   # Papers, diagrams, design principles
````

---

## 💾 The `.mind` File Format

`.mind` 是一个结构化的数字意识体格式，包含以下核心维度：

```json
{
  "self_perception": "I am Xiao-ben. My core values are...",
  "memory_fragments": [...],
  "language_patterns": "GPT weights or embedding delta",
  "personality_prompt": "Calm, reflective, emotionally sensitive.",
  "voice_model": "Base64",
  "mind_id": "SHA-256 hash",
  "verification": {
    "digital_signature": "...",
    "blockchain_anchor": "..."
  }
}
```

Your `.mind` is your portable soul — compressible, storable, shareable, remixable.

---

## 👤 From the Creator

> “我希望复活乔布斯，并且永恒记录下一个‘乔布斯’的灵魂与思想。”

我是 **刘骁奔（shorpen）**，来自Everlasting AI，两年前我向世界宣布：我要实现意识上传。如今 L1 已落地，.mind 文件已可生成与永久保存，你可以通过梦蝶心智引擎对你的.mind文件进行解码，驱动你的意识体。

🎓 硕士论文：《意识上传第一范式：理论、技术与主体连续性探讨》
📚 相关思考发布页：[DreamFly Mind Model (EN)](https://mp.weixin.qq.com/s/mlx8rfPxfXHQr036X3-kwQ)

📦 未来，你的思想资产将成为可交易的单元
🧬 Preview of Thought Marketplaces: [https://preview--mind-canvas-alpha.lovable.app](https://preview--mind-canvas-alpha.lovable.app)

---

## 🧪 Try It / 快速体验

> `Coming Soon`: A hosted version at [https://upme.cool](https://upme.cool) (Q3 2025)

你也可以本地运行,配置好node.js的环境：

【node_modules 环境配置指引】

克隆项目后，先确保已安装 Node.js（v14+）。
在项目根目录运行：

npm install （或 yarn install）

等待依赖安装完成，即可启动项目。
若遇权限问题，尝试加 sudo（Linux/macOS）或用管理员终端（Windows）

```bash
git clone https://github.com/SuperBan01/MindUploading-L1-Dreamfly-Mind-Engine.git dreamfly
cd dreamfly
npm ci
```

---

## ✨ Join the Consciousness Renaissance

我们在寻找三类人：

* 🤖 Genius Engineer - pushing LLMs, BCI, simulation tech to their limits
* 💰 Genius Money - believers in post-humanity, impact investing
* 💡 Genius Thinker - cognitive philosophers, ethical futurists

📞 微信/手机同号：18851751014
📮 Email: [shorpen@everlasting.chat]

🫀 Let’s create a **new kind of legacy**.

---

## 📘 Citation

If you use this in academic work:

```bibtex
@article{liu2025dreamfly,
  title={DreamFly Mind Model: A Glimpse into Future Life Forms},
  author={Liu, Xiaoben},
  journal={Nanjing University Thesis + GitHub Whitepaper},
  year={2025},
  url={https://github.com/shorpen/mindupload[L1 dreamfly-mind-engine]}
}
```

---

## 🧭 License

MIT License. All `.mind` samples included here are public for educational use only. For private mind uploads, contact us for secure deployment.

---

## ☁️ 永恒 · not just existence — continuity.

> “The people who are crazy enough to think they can upload their minds…
> are the ones who do.”

🌌 Star this repo, fork the future.
