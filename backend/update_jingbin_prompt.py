#!/usr/bin/env python3
"""One-off script to update jingbin-qians-workspace system prompt with new template."""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

from database import db
from workspace_manager import WorkspaceManager
import requests

wm = WorkspaceManager()

user = db.db["users"].find_one({"email": "s229178291@gmail.com"})
if not user:
    print("User not found")
    sys.exit(1)

uname = user["name"]
lang = user.get("settings", {}).get("language", "en")
persona = user.get("personality_test", {}).get("personality_profile")
cname = user.get("settings", {}).get("companion_name")
cgender = user.get("settings", {}).get("companion_gender", "female")

print(f"User: {uname}, lang: {lang}, companion: {cname}, gender: {cgender}")

prompt = wm._build_system_prompt(uname, lang, persona, companion_name=cname, companion_gender=cgender)

url = "http://localhost:3001/api/v1/workspace/jingbin-qians-workspace/update"
headers = {
    "Authorization": f"Bearer {os.getenv('ANYTHINGLLM_API_KEY', 'SD3WWRR-2KJ4Y3B-PXTAV71-1QX44EH')}",
    "Content-Type": "application/json"
}
resp = requests.post(url, headers=headers, json={"openAiPrompt": prompt})
print(f"Update status: {resp.status_code}")
print(f"Prompt first 400 chars:\n{prompt[:400]}")
