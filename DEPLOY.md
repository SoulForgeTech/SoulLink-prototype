# SoulLink 部署指南

## 架构概览

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Frontend      │────▶│    Backend      │────▶│  AnythingLLM    │
│  (Vercel)       │     │  (Railway)      │     │   (自托管)       │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                               │
                               ▼
                        ┌─────────────────┐
                        │  MongoDB Atlas  │
                        │   (云数据库)     │
                        └─────────────────┘
```

---

## 第一步：部署后端到 Railway

### 1.1 准备工作

确保 `backend` 文件夹包含以下文件：
- `app_new.py` - Flask 应用
- `requirements.txt` - Python 依赖
- `Procfile` - 启动命令

### 1.2 部署步骤

1. 访问 [Railway](https://railway.app/) 并用 GitHub 登录

2. 点击 "New Project" → "Deploy from GitHub repo"

3. 选择你的仓库，设置根目录为 `backend`

4. 添加环境变量（Settings → Variables）：

```
MONGODB_URI=mongodb+srv://...你的MongoDB Atlas连接字符串...
MONGODB_DB_NAME=soullink
JWT_SECRET=（用 python -c "import secrets; print(secrets.token_hex(32))" 生成）
GOOGLE_CLIENT_ID=你的Google Client ID
GOOGLE_CLIENT_SECRET=你的Google Client Secret
GOOGLE_REDIRECT_URI=https://你的前端域名/callback
ANYTHINGLLM_BASE_URL=http://你的AnythingLLM服务器地址:3001
ANYTHINGLLM_API_KEY=你的AnythingLLM API Key
ALLOWED_ORIGINS=https://你的前端域名
```

5. Railway 会自动部署，完成后会给你一个 URL，如：`https://soullink-backend.up.railway.app`

### 1.3 备选方案：Render

如果选择 [Render](https://render.com/)：

1. 创建新的 "Web Service"
2. 连接 GitHub 仓库
3. 设置：
   - Root Directory: `backend`
   - Build Command: `pip install -r requirements.txt`
   - Start Command: `gunicorn app_new:app --bind 0.0.0.0:$PORT`
4. 添加同样的环境变量

---

## 第二步：部署前端到 Vercel

### 2.1 修改前端配置

部署前，需要修改 `frontend/index_new.html` 中的 API 地址：

```javascript
const CONFIG = {
    // 改成你的后端地址
    API_BASE_URL: 'https://soullink-backend.up.railway.app',
    GOOGLE_CLIENT_ID: '你的Google Client ID'
};
```

### 2.2 部署步骤

1. 访问 [Vercel](https://vercel.com/) 并用 GitHub 登录

2. 点击 "Add New..." → "Project"

3. 导入你的 GitHub 仓库

4. 配置项目：
   - Framework Preset: Other
   - Root Directory: `frontend`
   - Build Command: （留空）
   - Output Directory: `.`

5. 点击 "Deploy"

6. 部署完成后，你会得到一个 URL，如：`https://soullink.vercel.app`

### 2.3 自定义域名（可选）

在 Vercel 项目设置中：
1. Settings → Domains
2. 添加你的自定义域名
3. 按照提示配置 DNS 记录

---

## 第三步：配置 Google OAuth

### 3.1 更新 Google Cloud Console

1. 访问 [Google Cloud Console](https://console.cloud.google.com/apis/credentials)

2. 编辑你的 OAuth 2.0 客户端 ID

3. 添加授权的 JavaScript 来源：
   - `https://你的前端域名`
   - `https://soullink.vercel.app`（如果用 Vercel）

4. 添加授权的重定向 URI：
   - `https://你的前端域名/callback`
   - `https://soullink.vercel.app/callback`

---

## 第四步：部署 AnythingLLM

AnythingLLM 需要自托管，有几个选项：

### 选项 A：VPS 服务器（推荐）

在 DigitalOcean/Vultr/AWS EC2 上：

```bash
# 安装 Docker
curl -fsSL https://get.docker.com | sh

# 运行 AnythingLLM
docker run -d \
  --name anythingllm \
  -p 3001:3001 \
  -v /path/to/storage:/app/server/storage \
  mintplexlabs/anythingllm
```

### 选项 B：Railway 部署 AnythingLLM

Railway 也支持 Docker 镜像部署，但需要付费计划。

---

## 环境变量清单

### 后端 (Railway/Render)

| 变量名 | 说明 | 示例 |
|--------|------|------|
| MONGODB_URI | MongoDB 连接字符串 | mongodb+srv://user:pass@cluster.mongodb.net/ |
| MONGODB_DB_NAME | 数据库名 | soullink |
| JWT_SECRET | JWT 签名密钥 | （64字符随机字符串） |
| GOOGLE_CLIENT_ID | Google OAuth Client ID | xxx.apps.googleusercontent.com |
| GOOGLE_CLIENT_SECRET | Google OAuth Secret | GOCSPX-xxx |
| GOOGLE_REDIRECT_URI | OAuth 回调地址 | https://frontend.vercel.app/callback |
| ANYTHINGLLM_BASE_URL | AnythingLLM 地址 | http://your-server:3001 |
| ANYTHINGLLM_API_KEY | AnythingLLM API Key | xxx |
| ALLOWED_ORIGINS | CORS 允许的域名 | https://frontend.vercel.app |

---

## 部署后检查

1. ✅ 访问前端网站能正常加载
2. ✅ Google 登录功能正常
3. ✅ 邮箱注册/登录功能正常
4. ✅ 发送消息能收到 AI 回复
5. ✅ 对话历史能正常保存和加载

---

## 常见问题

### CORS 错误
确保后端的 `ALLOWED_ORIGINS` 包含前端域名。

### Google 登录失败
检查 Google Cloud Console 中的授权来源和重定向 URI 是否正确配置。

### 连接 AnythingLLM 失败
确保 AnythingLLM 服务器可以从 Railway/Render 访问（可能需要配置防火墙）。

### MongoDB 连接失败
确保 MongoDB Atlas 的 Network Access 中添加了 `0.0.0.0/0`（允许所有 IP）或 Railway 的 IP。
