# SoulLink - AI Soul Companion

> Your personalized AI companion that truly understands you.

SoulLink is an AI companion platform that creates meaningful connections through personalized conversations, personality-driven interactions, and a unique tarot-based personality system.

## Live Demo

| | URL |
|--|-----|
| **Frontend** | https://prototype.soulforgetech.com |
| **API** | https://api.soulforgetech.com |
| **Admin Panel** | https://api.soulforgetech.com/admin |
| **Health Check** | https://api.soulforgetech.com/health |

## Features

**AI Chat**
- Real-time AI conversations with personalized companion
- Multi-model support (GPT-4o & Gemini 2.5 Flash)
- Three-layer AI memory system (permanent / long-term / short-term)
- Smart companion rename via natural chat
- Custom companion avatar upload
- Conversation history management

**Personality System**
- Personality test with tarot card reveal
- AI adapts behavior based on your personality profile
- Unique companion persona for each user
- Companion gender & style selection (8 subtypes)

**User System**
- Google OAuth & email/password authentication
- Email verification with 6-digit code
- Trust Device — stay logged in for 90 days (JWT + Refresh Token)
- Bilingual support (English / Chinese)
- User profile & settings management

**About & Feedback**
- In-app feedback system (suggestion / bug / other)
- Donation support (Zelle / WeChat Pay / Alipay)
- User survey integration
- Version changelog

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Vanilla HTML/CSS/JS, Vercel |
| Backend | Python Flask, Gunicorn |
| AI Engine | AnythingLLM (GPT-4o, Gemini) |
| Database | MongoDB Atlas |
| Auth | JWT + Refresh Token, Google OAuth 2.0 |
| Memory | Gemini 2.5 Flash (extraction), MongoDB (storage) |
| Email | Resend API |
| Hosting | AWS EC2, Vercel, Cloudflare |

## Project Structure

```
prototype/
├── frontend/
│   ├── index.html          # Single-page frontend (HTML/CSS/JS)
│   ├── images/             # Static assets (avatars, backgrounds)
│   └── paytous/            # Payment QR codes & icons
├── backend/
│   ├── app_new.py          # Flask API server
│   ├── auth.py             # JWT, Google OAuth & Refresh Token
│   ├── database.py         # MongoDB operations
│   ├── models.py           # MongoDB data models & indexes
│   ├── memory_engine.py    # Three-layer AI memory system
│   ├── workspace_manager.py # AnythingLLM workspace management
│   ├── personality_engine.py # Personality test & tarot system
│   ├── anythingllm_api.py  # AnythingLLM API client
│   ├── email_service.py    # Email verification (Resend)
│   ├── admin_panel.html    # Admin dashboard UI
│   ├── system_prompt_template.txt      # Female companion prompt
│   └── system_prompt_template_male.txt # Male companion prompt
└── vercel.json             # Vercel deployment config
```

## API Endpoints

### Public
| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| POST | `/api/auth/register` | Email registration |
| POST | `/api/auth/login` | Email login |
| GET | `/api/auth/google/url` | Google OAuth URL |
| POST | `/api/auth/google/callback` | Google OAuth callback |
| POST | `/api/auth/refresh` | Refresh JWT with refresh token |
| POST | `/api/auth/logout` | Logout & revoke refresh token |

### Authenticated (JWT)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/auth/verify` | Verify token |
| GET | `/api/models` | Available AI models |
| GET | `/api/user/profile` | User profile |
| PUT | `/api/user/profile` | Update profile |
| PUT | `/api/user/settings` | Update settings |
| POST | `/api/chat` | Send chat message |
| GET | `/api/conversations` | List conversations |
| POST | `/api/conversations` | Create conversation |
| POST | `/api/feedback` | Submit feedback |
| GET | `/api/personality-test/status` | Test completion status |
| POST | `/api/personality-test/submit` | Submit test answers |

### Admin
| Method | Path | Description |
|--------|------|-------------|
| GET | `/admin` | Admin panel UI |
| GET | `/api/admin/stats` | System statistics |
| POST | `/api/admin/sync-all` | Sync prompts + documents |
| POST | `/api/admin/sync-prompts` | Sync system prompts only |
| POST | `/api/admin/sync-documents` | Sync knowledge base docs |

## Deployment

**Frontend** - Auto-deploys to Vercel on push to `main`

**Backend** - AWS EC2 with Gunicorn
```bash
# SSH into server
ssh -i soullink.pem ubuntu@ec2-52-14-41-63.us-east-2.compute.amazonaws.com

# Restart backend
bash /home/ubuntu/restart.sh
```

## Current Version

**v0.0.5-beta** (2026-02-20)

See the in-app changelog for full release history.

## Team

Built by **SoulForge Tech**

---

*This is a prototype / beta version. Features are actively being developed.*
