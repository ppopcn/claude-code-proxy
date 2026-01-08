# Claude Code Proxy

一个部署在 Cloudflare Workers 上的代理服务，将 Claude API 格式的请求转换为 OpenAI API 格式，让你可以在 Claude Code CLI 中使用各种 OpenAI 兼容的 AI 服务。

## 功能特性

- **API 格式转换**：Claude ↔ OpenAI 格式的双向转换
- **动态配置**：从 Claude 请求中获取 API 密钥和模型配置
- **流式响应**：支持 Server-Sent Events 流式传输
- **Tool Calling**：支持函数调用功能
- **多服务支持**：兼容 OpenAI、NVIDIA、Google Gemini 等 API

## 快速开始

### 1. 本地开发

```bash
# 克隆仓库
git clone https://github.com/ppopcn/claude-code-proxy.git
cd claude-code-proxy

# 安装依赖
npm install -g wrangler

# 启动本地开发服务器
wrangler dev
```

服务将运行在 `http://localhost:8787`

### 2. 部署到 Cloudflare Workers

```bash
# 登录 Cloudflare
wrangler login

# 部署
wrangler deploy
```

### 3. 配置 Claude Code

在 `~/.claude/settings.json` 中配置：

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "http://localhost:8787",
    "ANTHROPIC_API_KEY": "你的API密钥",
    "ANTHROPIC_MODEL": "模型名称"
  }
}
```

## 支持的 AI 服务

### NVIDIA API
```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "你的代理地址",
    "ANTHROPIC_API_KEY": "nvapi-xxx",
    "ANTHROPIC_MODEL": "z-ai/glm4.7"
  }
}
```

### OpenAI API
```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "你的代理地址",
    "ANTHROPIC_API_KEY": "sk-xxx",
    "ANTHROPIC_MODEL": "gpt-4o"
  }
}
```

### Google Gemini
```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "你的代理地址",
    "ANTHROPIC_API_KEY": "你的Gemini密钥",
    "ANTHROPIC_MODEL": "gemini-pro"
  }
}
```

## 工作原理

1. Claude Code 发送 Claude 格式的请求到代理
2. 代理解析请求中的 API 密钥和模型配置
3. 将 Claude 格式转换为 OpenAI 格式
4. 转发请求到目标 AI 服务
5. 将响应转换回 Claude 格式返回

## 项目结构

```
├── src/
│   └── index.ts          # 主要代理逻辑
├── wrangler.toml         # Cloudflare Workers 配置
├── .gitignore           # Git 忽略文件
└── README.md            # 项目文档
```

## 开发

### 本地测试

```bash
# 启动开发服务器
wrangler dev

# 测试请求
curl -X POST "http://localhost:8787/v1/messages" \
  -H "Content-Type: application/json" \
  -H "x-api-key: 你的API密钥" \
  -d '{
    "model": "模型名称",
    "max_tokens": 100,
    "messages": [
      {
        "role": "user",
        "content": "Hello"
      }
    ]
  }'
```

### 查看日志

```bash
wrangler tail
```

## 许可证

MIT License

## 贡献

欢迎提交 Issue 和 Pull Request！