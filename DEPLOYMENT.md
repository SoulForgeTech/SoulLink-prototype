# SoulLink 部署指南

本文档详细说明如何将 SoulLink 从本地开发环境部署到云端，支持多用户独立 workspace。

## 架构概览

```
┌─────────────────────────────────────────────────────────────┐
│  前端 (Vercel)                                               │
│  - 静态托管 HTML/CSS/JS                                      │
│  - Google OAuth 登录 UI                                      │
│  - 自动 HTTPS                                                │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ↓
┌─────────────────────────────────────────────────────────────┐
│  后端 (Railway/Render/自有服务器)                            │
│  - Flask API                                                │
│  - JWT 认证                                                  │
│  - 用户 & Workspace 管理                                     │
└──────────────────────┬──────────────────────────────────────┘
                       │
        ┌──────────────┼──────────────┐
        ↓              ↓              ↓
┌─────────────┐ ┌─────────────┐ ┌─────────────┐
│  MongoDB    │ │ AnythingLLM │ │             │
│  Atlas      │ │  (云服务器) │ │             │
│  (免费层)   │ │             │ │             │
└─────────────┘ └─────────────┘ └─────────────┘
```

---

## 第一步：设置 MongoDB Atlas

### 1.1 创建账户和集群

1. 访问 [MongoDB Atlas](https://www.mongodb.com/atlas)
2. 注册/登录账户
3. 创建新项目（如 "SoulLink"）
4. 创建免费集群（M0 Sandbox - 免费）
   - 选择云服务商和区域（建议选离你用户近的）
   - 集群名称：`Cluster0`（或自定义）

### 1.2 配置数据库访问

1. **Database Access** → **Add New Database User**
   - 认证方式：Password
   - 用户名：`soullink_admin`（或自定义）
   - 密码：生成强密码（保存好！）
   - 权限：Atlas admin

2. **Network Access** → **Add IP Address**
   - 开发阶段：添加 `0.0.0.0/0`（允许所有 IP）
   - 生产环境：只添加后端服务器 IP

### 1.3 获取连接字符串

1. 点击 **Connect** → **Connect your application**
2. 复制连接字符串，类似：
   ```
   mongodb+srv://soullink_admin:<password>@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
   ```
3. 将 `<password>` 替换为你的实际密码

---

## 第二步：设置 Google OAuth

### 2.1 创建 Google Cloud 项目

1. 访问 [Google Cloud Console](https://console.cloud.google.com/)
2. 创建新项目（如 "SoulLink"）
3. 选择该项目

### 2.2 配置 OAuth 同意屏幕

1. **APIs & Services** → **OAuth consent screen**
2. 选择 **External**（外部用户）
3. 填写应用信息：
   - 应用名称：SoulLink
   - 用户支持邮箱：你的邮箱
   - 开发者联系信息：你的邮箱
4. 添加范围（Scopes）：
   - `email`
   - `profile`
   - `openid`
5. 添加测试用户（开发阶段）

### 2.3 创建 OAuth 凭据

1. **APIs & Services** → **Credentials**
2. **Create Credentials** → **OAuth client ID**
3. 应用类型：**Web application**
4. 名称：`SoulLink Web Client`
5. 添加授权的 JavaScript 来源：
   ```
   http://localhost:3000
   https://your-app.vercel.app
   ```
6. 添加授权的重定向 URI：
   ```
   http://localhost:3000/callback
   https://your-app.vercel.app/callback
   ```
7. 保存 **Client ID** 和 **Client Secret**

---

## 第三步：部署 AnythingLLM（云服务器）

### 方案 A：使用云服务器（推荐）

#### 3A.1 准备服务器

推荐配置：
- 2 CPU / 4GB RAM（最低）
- 50GB SSD
- Ubuntu 22.04

推荐平台：
- AWS EC2
- 阿里云 ECS
- 腾讯云 CVM
- DigitalOcean Droplet

#### 3A.2 安装 Docker

```bash
# 更新系统
sudo apt update && sudo apt upgrade -y

# 安装 Docker
curl -fsSL https://get.docker.com | sh

# 添加当前用户到 docker 组
sudo usermod -aG docker $USER

# 安装 Docker Compose
sudo apt install docker-compose-plugin -y
```

#### 3A.3 部署 AnythingLLM

```bash
# 创建目录
mkdir -p ~/anythingllm && cd ~/anythingllm

# 创建 docker-compose.yml
cat > docker-compose.yml << 'EOF'
version: '3.8'
services:
  anythingllm:
    image: mintplexlabs/anythingllm
    container_name: anythingllm
    ports:
      - "3001:3001"
    volumes:
      - ./storage:/app/server/storage
      - ./hotdir:/app/hotdir
      - ./collector/output:/app/collector/output
    environment:
      - STORAGE_DIR=/app/server/storage
    restart: unless-stopped
EOF

# 启动服务
docker compose up -d

# 查看日志
docker compose logs -f
```

#### 3A.4 配置 AnythingLLM

1. 访问 `http://your-server-ip:3001`
2. 完成初始设置（选择 LLM 提供商等）
3. 进入 **Settings** → **API Keys**
4. 生成 API Key 并保存

#### 3A.5 配置防火墙（重要！）

```bash
# Ubuntu UFW
sudo ufw allow 3001/tcp

# 或者在云平台安全组中开放 3001 端口
```

### 方案 B：使用 Railway（简单但有限制）

1. 访问 [Railway](https://railway.app/)
2. 从 Docker Hub 部署 `mintplexlabs/anythingllm`
3. 配置环境变量和持久化存储

---

## 第四步：部署后端

### 方案 A：使用 Railway（推荐新手）

#### 4A.1 准备代码

```bash
# 确保代码结构正确
cd backend/

# 创建 railway.json
cat > railway.json << 'EOF'
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": {
    "builder": "DOCKERFILE",
    "dockerfilePath": "Dockerfile"
  },
  "deploy": {
    "startCommand": "gunicorn --bind 0.0.0.0:$PORT --workers 2 --threads 4 app_new:app",
    "healthcheckPath": "/health"
  }
}
EOF
```

#### 4A.2 部署到 Railway

1. 访问 [Railway](https://railway.app/)
2. **New Project** → **Deploy from GitHub repo**
3. 选择你的仓库和 `backend` 目录
4. 添加环境变量：
   ```
   MONGODB_URI=mongodb+srv://...
   MONGODB_DB_NAME=soullink
   GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=xxx
   GOOGLE_REDIRECT_URI=https://your-frontend.vercel.app/callback
   JWT_SECRET=your_random_secret
   ANYTHINGLLM_BASE_URL=http://your-anythingllm-server:3001
   ANYTHINGLLM_API_KEY=your_api_key
   ALLOWED_ORIGINS=https://your-frontend.vercel.app
   ```
5. 等待部署完成，获取后端 URL

### 方案 B：使用 Render

1. 访问 [Render](https://render.com/)
2. **New** → **Web Service**
3. 连接 GitHub 仓库
4. 配置：
   - Root Directory: `backend`
   - Build Command: `pip install -r requirements.txt`
   - Start Command: `gunicorn --bind 0.0.0.0:$PORT app_new:app`
5. 添加环境变量（同上）

### 方案 C：使用自有服务器

```bash
# 克隆代码
cd /opt
git clone your-repo soullink
cd soullink/backend

# 创建虚拟环境
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# 创建 .env 文件
cp .env.example .env
# 编辑 .env 填入实际值

# 使用 systemd 管理服务
sudo cat > /etc/systemd/system/soullink.service << EOF
[Unit]
Description=SoulLink Backend
After=network.target

[Service]
User=www-data
WorkingDirectory=/opt/soullink/backend
Environment=PATH=/opt/soullink/backend/venv/bin
ExecStart=/opt/soullink/backend/venv/bin/gunicorn --bind 0.0.0.0:5000 --workers 2 app_new:app
Restart=always

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl enable soullink
sudo systemctl start soullink

# 配置 Nginx 反向代理
sudo apt install nginx -y
sudo cat > /etc/nginx/sites-available/soullink << EOF
server {
    listen 80;
    server_name api.yourdomain.com;

    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
    }
}
EOF

sudo ln -s /etc/nginx/sites-available/soullink /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# 配置 SSL（使用 Certbot）
sudo apt install certbot python3-certbot-nginx -y
sudo certbot --nginx -d api.yourdomain.com
```

---

## 第五步：部署前端到 Vercel

### 5.1 修改前端配置

编辑 `frontend/index_new.html`，更新配置：

```javascript
const CONFIG = {
    API_BASE_URL: 'https://your-backend-url.railway.app',  // 你的后端 URL
    GOOGLE_CLIENT_ID: 'xxx.apps.googleusercontent.com'     // 你的 Google Client ID
};
```

### 5.2 部署到 Vercel

#### 方法 A：使用 Vercel CLI

```bash
# 安装 Vercel CLI
npm install -g vercel

# 进入前端目录
cd frontend

# 部署
vercel

# 按提示操作，首次会要求登录
```

#### 方法 B：使用 GitHub 集成

1. 将代码推送到 GitHub
2. 访问 [Vercel](https://vercel.com/)
3. **New Project** → 导入 GitHub 仓库
4. 配置：
   - Root Directory: `frontend`
   - Framework Preset: Other
5. 点击 Deploy

### 5.3 配置自定义域名（可选）

1. 在 Vercel 项目设置中添加域名
2. 按提示配置 DNS

---

## 第六步：更新 OAuth 配置

部署完成后，需要更新 Google OAuth 配置：

1. 回到 [Google Cloud Console](https://console.cloud.google.com/)
2. **APIs & Services** → **Credentials**
3. 编辑你的 OAuth Client
4. 添加新的授权来源和重定向 URI：
   ```
   https://your-app.vercel.app
   https://your-app.vercel.app/callback
   ```

---

## 验证部署

### 检查清单

- [ ] MongoDB Atlas 可以连接
- [ ] AnythingLLM 服务正常运行
- [ ] 后端健康检查通过：`curl https://your-backend/health`
- [ ] 前端可以正常访问
- [ ] Google 登录流程正常
- [ ] 聊天功能正常工作
- [ ] 每个用户有独立的 workspace

### 常见问题

#### Q: CORS 错误
A: 检查后端的 `ALLOWED_ORIGINS` 环境变量，确保包含前端域名

#### Q: Google 登录失败
A:
1. 检查 Client ID 是否正确
2. 确认授权来源和重定向 URI 配置正确
3. 确保应用已发布（或测试用户已添加）

#### Q: MongoDB 连接失败
A:
1. 检查连接字符串格式
2. 确认 IP 白名单配置
3. 验证用户名密码

#### Q: AnythingLLM API 错误
A:
1. 检查服务是否运行：`curl http://your-server:3001/api/v1/auth`
2. 确认 API Key 有效
3. 检查防火墙设置

---

## 成本估算（月）

| 服务 | 免费额度 | 超出后 |
|------|---------|--------|
| MongoDB Atlas | 512MB | ~$9/GB |
| Vercel | 100GB 流量 | ~$20/月 |
| Railway | $5 免费额度 | ~$5/月起 |
| 云服务器(AnythingLLM) | - | ~$10-30/月 |

**总计**: 免费层可支持小规模使用，生产环境约 $20-50/月

---

## 下一步

1. 配置监控和日志（如 Sentry）
2. 设置自动备份
3. 实现速率限制
4. 添加更多认证方式
5. 优化性能（缓存、CDN）
