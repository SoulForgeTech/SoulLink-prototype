#!/usr/bin/env python3
"""
测试自定义角色性格持久化逻辑
验证：
1. _build_system_prompt 在有/无 custom_persona 时的行为
2. update_system_prompt 自动检测 custom_persona
3. update_workspace_model（切换模型）保留 custom_persona
4. 伴侣风格变化时不覆盖 custom_persona
5. sync_all_system_prompts 跳过有 custom_persona 的用户
"""
import os
import sys
import io
import json
from unittest.mock import patch, MagicMock
from bson import ObjectId

# Fix Windows encoding
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

sys.path.insert(0, os.path.dirname(__file__))
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), '.env'))


# ==================== 辅助工具 ====================

PASS = 0
FAIL = 0

def check(name, condition, detail=""):
    global PASS, FAIL
    if condition:
        PASS += 1
        print(f"  ✅ {name}")
    else:
        FAIL += 1
        print(f"  ❌ {name}" + (f" — {detail}" if detail else ""))


# ==================== Test 1: _build_system_prompt ====================
print("\n" + "="*60)
print("Test 1: _build_system_prompt 模板选择和占位符替换")
print("="*60)

from workspace_manager import WorkspaceManager
wm = WorkspaceManager()

# 1a: 默认模式（无 custom persona）→ 用 girlfriend 模板
prompt_default = wm._build_system_prompt(
    user_name="TestUser",
    language="en",
    persona=None,  # 无自定义 → 用 DEFAULT_PERSONA
    companion_name="Abigail",
    companion_gender="female",
    use_custom_template=False,
)
check("默认模式用 girlfriend 模板", "girlfriend" in prompt_default)
check("默认模式包含默认 persona", "温柔但有主见" in prompt_default or "Gentle but opinionated" in prompt_default)
check("默认模式替换 user_name", "TestUser" in prompt_default)
check("默认模式替换 companion_name", "Abigail" in prompt_default)
check("默认模式不含未替换的占位符", "{{user_name}}" not in prompt_default and "{{companion_name}}" not in prompt_default)

# 1b: 自定义角色模式 → 用 custom 模板
REM_PERSONA = "你是蕾姆（Rem），来自Re:Zero的蓝发女仆。性格温柔忠诚，对主人绝对信任。说话时偶尔会用敬语。"
prompt_custom = wm._build_system_prompt(
    user_name="TestUser",
    language="zh-CN",
    persona=REM_PERSONA,
    companion_name="蕾姆",
    companion_gender="female",
    use_custom_template=True,
)
check("自定义模式用 custom 模板", "role-playing a character" in prompt_custom or "自定义角色" in prompt_custom)
check("自定义模式不含 girlfriend", "girlfriend" not in prompt_custom and "女朋友" not in prompt_custom)
check("自定义模式包含自定义 persona", "蕾姆" in prompt_custom and "蓝发女仆" in prompt_custom)
check("自定义模式替换 companion_name", "蕾姆" in prompt_custom)

# 1c: 男性默认模板
prompt_male = wm._build_system_prompt(
    user_name="TestUser",
    language="en",
    persona=None,
    companion_name="Gavin",
    companion_gender="male",
    use_custom_template=False,
)
check("男性模式用男性 persona", "不轻易妥协" in prompt_male or "principled" in prompt_male)

# 1d: companion_name 为 None 时用 DEFAULT_COMPANION_NAME
prompt_no_name = wm._build_system_prompt(
    user_name="TestUser",
    language="en",
    persona=None,
    companion_name=None,
    companion_gender="female",
    use_custom_template=False,
)
check("无 companion_name 时用 DEFAULT", wm.DEFAULT_COMPANION_NAME in prompt_no_name)
check("DEFAULT_COMPANION_NAME 不是 Abigail", wm.DEFAULT_COMPANION_NAME != "Abigail",
      f"实际值={wm.DEFAULT_COMPANION_NAME}")

# 1e: memory 注入
prompt_memory = wm._build_system_prompt(
    user_name="TestUser",
    persona=None,
    memory="用户养了一只猫叫 Mochi",
    use_custom_template=False,
)
check("memory 被注入", "Mochi" in prompt_memory)

# 1f: current_model 注入
prompt_model = wm._build_system_prompt(
    user_name="TestUser",
    persona=None,
    current_model="Grok",
    use_custom_template=False,
)
check("current_model 被注入", "Grok" in prompt_model)


# ==================== Test 2: update_system_prompt 自动检测 custom_persona ====================
print("\n" + "="*60)
print("Test 2: update_system_prompt 自动检测 custom_persona")
print("="*60)

# Mock 数据库和 API
fake_user_id = ObjectId()
fake_workspace = {"slug": "test-workspace-123", "_id": ObjectId()}

# 2a: 用户有 custom_persona → 应该使用 custom 模板
fake_user_with_custom = {
    "_id": fake_user_id,
    "name": "TestUser",
    "settings": {
        "language": "zh-CN",
        "companion_name": "普通名字",
        "companion_gender": "female",
        "model": "gemini",
        "custom_persona": REM_PERSONA,
        "custom_persona_name": "蕾姆",
    },
    "personality_test": {
        "completed": True,
        "personality_profile": "这是性格测试生成的 persona，不应该被使用"
    },
    "memory": {},
}

captured_prompts = []

def mock_requests_post(url, headers=None, json=None):
    """捕获发送到 AnythingLLM 的 system prompt"""
    if json and "openAiPrompt" in json:
        captured_prompts.append(json["openAiPrompt"])
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.text = '{"workspace": {}}'
    return mock_resp

with patch.object(wm, 'anythingllm_base_url', 'http://mock:3001'), \
     patch.object(wm, 'anythingllm_api_key', 'mock-key'), \
     patch('workspace_manager.db') as mock_db, \
     patch('requests.post', side_effect=mock_requests_post):
    mock_db.get_workspace_by_user.return_value = fake_workspace
    mock_db.db = {"users": MagicMock()}
    mock_db.db["users"].find_one.return_value = fake_user_with_custom

    captured_prompts.clear()
    result = wm.update_system_prompt(fake_user_id, "TestUser")

check("update_system_prompt 成功", result.get("success") == True, str(result))
if captured_prompts:
    prompt = captured_prompts[0]
    check("使用 custom 模板（无 girlfriend）", "girlfriend" not in prompt and "女朋友" not in prompt)
    check("包含自定义 persona（蕾姆）", "蕾姆" in prompt and "蓝发女仆" in prompt)
    check("companion_name 用自定义角色名", "蕾姆" in prompt)
    check("性格测试 persona 未被使用", "不应该被使用" not in prompt)
else:
    check("捕获到 system prompt", False, "未捕获到任何 prompt")

# 2b: 用户无 custom_persona → 回退到性格测试结果
fake_user_no_custom = {
    "_id": fake_user_id,
    "name": "TestUser",
    "settings": {
        "language": "en",
        "companion_name": "Abigail",
        "companion_gender": "female",
        "model": "gemini",
    },
    "personality_test": {
        "completed": True,
        "personality_profile": "TEST_PERSONA_FROM_PERSONALITY_TEST"
    },
    "memory": {},
}

with patch.object(wm, 'anythingllm_base_url', 'http://mock:3001'), \
     patch.object(wm, 'anythingllm_api_key', 'mock-key'), \
     patch('workspace_manager.db') as mock_db, \
     patch('requests.post', side_effect=mock_requests_post):
    mock_db.get_workspace_by_user.return_value = fake_workspace
    mock_db.db = {"users": MagicMock()}
    mock_db.db["users"].find_one.return_value = fake_user_no_custom

    captured_prompts.clear()
    result = wm.update_system_prompt(fake_user_id, "TestUser")

check("无 custom 时也成功", result.get("success") == True, str(result))
if captured_prompts:
    prompt = captured_prompts[0]
    check("无 custom 时用 girlfriend 模板", "girlfriend" in prompt or "女朋友" in prompt)
    check("使用性格测试 persona", "TEST_PERSONA_FROM_PERSONALITY_TEST" in prompt)
else:
    check("捕获到 system prompt", False)


# ==================== Test 3: update_workspace_model 保留 custom_persona ====================
print("\n" + "="*60)
print("Test 3: update_workspace_model 切换模型保留 custom_persona")
print("="*60)

with patch.object(wm, 'anythingllm_base_url', 'http://mock:3001'), \
     patch.object(wm, 'anythingllm_api_key', 'mock-key'), \
     patch('workspace_manager.db') as mock_db, \
     patch('requests.post', side_effect=mock_requests_post):
    mock_db.get_workspace_by_user.return_value = fake_workspace
    mock_db.get_user_by_id.return_value = fake_user_with_custom
    mock_db.db = {"users": MagicMock()}

    # 切换到 GPT-4o
    captured_prompts.clear()
    result = wm.update_workspace_model(fake_user_id, "gpt4o")

check("切换模型成功", result.get("success") == True, str(result))
if captured_prompts:
    prompt = captured_prompts[0]
    check("切换模型后保留自定义 persona", "蕾姆" in prompt and "蓝发女仆" in prompt)
    check("切换模型后用 custom 模板", "girlfriend" not in prompt and "女朋友" not in prompt)
    check("切换模型后包含新模型名", "GPT-4o" in prompt)
else:
    check("捕获到 system prompt", False)

# 3b: 切换到 Grok（有 Immersion Rules）
with patch.object(wm, 'anythingllm_base_url', 'http://mock:3001'), \
     patch.object(wm, 'anythingllm_api_key', 'mock-key'), \
     patch('workspace_manager.db') as mock_db, \
     patch('requests.post', side_effect=mock_requests_post):
    mock_db.get_workspace_by_user.return_value = fake_workspace
    mock_db.get_user_by_id.return_value = fake_user_with_custom
    mock_db.db = {"users": MagicMock()}

    captured_prompts.clear()
    result = wm.update_workspace_model(fake_user_id, "grok")

check("切换 Grok 成功", result.get("success") == True, str(result))
if captured_prompts:
    prompt = captured_prompts[0]
    check("Grok 保留自定义 persona", "蕾姆" in prompt and "蓝发女仆" in prompt)
    check("Grok 包含 Immersion Rules", "Immersion Rules" in prompt)
    check("Grok 角色锚定用自定义角色名", "蕾姆" in prompt and "脱离蕾姆" in prompt,
          f"prompt 中是否有 '脱离蕾姆': {'脱离蕾姆' in prompt}")
    check("Grok 不用 Abigail 兜底", "Abigail" not in prompt.split("Immersion Rules")[1] if "Immersion Rules" in prompt else True)
else:
    check("捕获到 system prompt", False)

# 3c: 无 custom_persona 的用户切换模型 → 用性格测试结果
with patch.object(wm, 'anythingllm_base_url', 'http://mock:3001'), \
     patch.object(wm, 'anythingllm_api_key', 'mock-key'), \
     patch('workspace_manager.db') as mock_db, \
     patch('requests.post', side_effect=mock_requests_post):
    mock_db.get_workspace_by_user.return_value = fake_workspace
    mock_db.get_user_by_id.return_value = fake_user_no_custom
    mock_db.db = {"users": MagicMock()}

    captured_prompts.clear()
    result = wm.update_workspace_model(fake_user_id, "gpt4o")

check("无 custom 切换模型成功", result.get("success") == True, str(result))
if captured_prompts:
    prompt = captured_prompts[0]
    check("无 custom 切换模型用性格测试 persona", "TEST_PERSONA_FROM_PERSONALITY_TEST" in prompt)
    check("无 custom 切换模型用 girlfriend 模板", "girlfriend" in prompt or "女朋友" in prompt)
else:
    check("捕获到 system prompt", False)


# ==================== Test 4: 伴侣风格变化逻辑 ====================
print("\n" + "="*60)
print("Test 4: 伴侣风格变化时 custom_persona 不被覆盖（模拟 app_new.py 逻辑）")
print("="*60)

# 模拟 app_new.py 中 update_settings 的逻辑
def simulate_style_change(user, data):
    """模拟 app_new.py 中伴侣风格变化的逻辑"""
    from personality_engine import generate_personality_profile, COMPANION_SUBTYPES

    subtype = data.get("companion_subtype") or user.get("settings", {}).get("companion_subtype", "female_gentle")
    gender = data.get("companion_gender") or user.get("settings", {}).get("companion_gender", "female")
    language = user.get("settings", {}).get("language", "en")

    persona_regenerated = False
    name_auto_changed = False

    custom_persona = user.get("settings", {}).get("custom_persona")
    if custom_persona:
        pass  # 跳过
    else:
        pt = user.get("personality_test", {})
        if pt.get("completed"):
            persona_regenerated = True

        all_defaults = [s["default_name"] for s in COMPANION_SUBTYPES.values()]
        current_name = user.get("settings", {}).get("companion_name", "")
        if current_name in all_defaults or not current_name:
            name_auto_changed = True

    return {"persona_regenerated": persona_regenerated, "name_auto_changed": name_auto_changed}

# 4a: 有 custom_persona 的用户改风格 → 不重新生成 persona
result_custom = simulate_style_change(fake_user_with_custom, {"companion_subtype": "female_cool"})
check("有 custom_persona 不重新生成 persona", result_custom["persona_regenerated"] == False)
check("有 custom_persona 不自动改名", result_custom["name_auto_changed"] == False)

# 4b: 无 custom_persona 的用户改风格 → 重新生成
result_normal = simulate_style_change(fake_user_no_custom, {"companion_subtype": "female_cool"})
check("无 custom_persona 重新生成 persona", result_normal["persona_regenerated"] == True)
check("无 custom_persona 自动改名（如果是默认名）", result_normal["name_auto_changed"] == True)

# 4c: 无 custom_persona 但自定义了名字 → 不自动改名
fake_user_custom_name = {**fake_user_no_custom}
fake_user_custom_name["settings"] = {**fake_user_no_custom["settings"], "companion_name": "小甜甜"}
result_custom_name = simulate_style_change(fake_user_custom_name, {"companion_subtype": "female_cool"})
check("自定义名字不被自动覆盖", result_custom_name["name_auto_changed"] == False)


# ==================== Test 5: sync_all_system_prompts ====================
print("\n" + "="*60)
print("Test 5: sync_all_system_prompts 跳过有 custom_persona 的用户")
print("="*60)

# 创建两种用户
user_with_custom = {
    "_id": ObjectId(),
    "name": "RemFan",
    "settings": {
        "language": "zh-CN",
        "companion_subtype": "female_gentle",
        "custom_persona": REM_PERSONA,
        "custom_persona_name": "蕾姆",
    },
    "personality_test": {"completed": True, "dimensions": {"d1": 1}, "tarot_cards": [{"name": "T"}]},
}

user_without_custom = {
    "_id": ObjectId(),
    "name": "NormalUser",
    "settings": {
        "language": "en",
        "companion_subtype": "female_gentle",
    },
    "personality_test": {"completed": True, "dimensions": {"d1": 1}, "tarot_cards": [{"name": "T"}]},
}

sync_update_calls = []
original_update = wm.update_system_prompt

def mock_update_system_prompt(user_id, user_name, **kwargs):
    sync_update_calls.append({"user_name": user_name, "persona_arg": kwargs.get("persona")})
    return {"success": True}

with patch.object(wm, 'update_system_prompt', side_effect=mock_update_system_prompt), \
     patch('workspace_manager.db') as mock_db, \
     patch('personality_engine.generate_personality_profile', return_value="REGENERATED_PERSONA"):
    mock_db.db = {"users": MagicMock()}
    mock_db.db["users"].find.return_value = [user_with_custom, user_without_custom]
    mock_db.db["users"].update_one = MagicMock()

    sync_update_calls.clear()
    result = wm.sync_all_system_prompts()

check("sync 成功", result.get("success") == True, str(result))

# 检查 RemFan（有 custom）是否传了 persona 参数
rem_call = [c for c in sync_update_calls if c["user_name"] == "RemFan"]
normal_call = [c for c in sync_update_calls if c["user_name"] == "NormalUser"]

check("RemFan 被 sync 了", len(rem_call) == 1)
check("RemFan 未传 persona 参数（交给内部自动检测）", rem_call[0]["persona_arg"] is None if rem_call else False,
      f"实际 persona_arg={rem_call[0]['persona_arg'][:50] if rem_call and rem_call[0]['persona_arg'] else 'None'}")
check("NormalUser 被 sync 了", len(normal_call) == 1)
check("NormalUser 传了重新生成的 persona", normal_call[0]["persona_arg"] == "REGENERATED_PERSONA" if normal_call else False)


# ==================== Test 6: character_parser ====================
print("\n" + "="*60)
print("Test 6: character_parser 基础检查")
print("="*60)

from character_parser import extract_persona_with_ai, search_character

# 6a: 空输入
result_empty = extract_persona_with_ai("")
check("空输入返回失败", result_empty["success"] == False)

# 6b: 过短输入
result_short = extract_persona_with_ai("hi")
check("过短输入返回失败", result_short["success"] == False)

# 6c: search_character 空输入
result_search_empty = search_character("")
check("搜索空输入返回失败", result_search_empty["success"] == False)

# 6d: search_character 过长输入
result_search_long = search_character("x" * 201)
check("搜索过长输入返回失败", result_search_long["success"] == False)


# ==================== Test 7: DEFAULT_COMPANION_NAMES 一致性 ====================
print("\n" + "="*60)
print("Test 7: 数据一致性检查")
print("="*60)

from personality_engine import COMPANION_SUBTYPES

# 7a: workspace_manager 和 personality_engine 的子类型名字一致
for subtype_key, name in wm.DEFAULT_COMPANION_NAMES.items():
    pe_name = COMPANION_SUBTYPES.get(subtype_key, {}).get("default_name")
    check(f"子类型 {subtype_key} 名字一致", name == pe_name,
          f"WM={name}, PE={pe_name}")

# 7b: DEFAULT_COMPANION_NAME 不硬编码为某个角色名
check("DEFAULT_COMPANION_NAME 是通用名称", wm.DEFAULT_COMPANION_NAME not in
      [v for v in wm.DEFAULT_COMPANION_NAMES.values()],
      f"实际值={wm.DEFAULT_COMPANION_NAME}")


# ==================== 结果汇总 ====================
print("\n" + "="*60)
total = PASS + FAIL
print(f"测试结果: {PASS}/{total} passed, {FAIL} failed")
print("="*60)

if FAIL > 0:
    sys.exit(1)
else:
    print("🎉 All tests passed!")
    sys.exit(0)
