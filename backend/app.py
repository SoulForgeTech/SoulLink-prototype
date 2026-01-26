# backend/app.py
import json
import logging
from flask import Flask, request, jsonify
from flask_cors import CORS # 关键：导入 CORS
from anythingllm_api import AnythingLLMAPI

# --- 配置部分 ---
app = Flask(__name__)
# 允许所有来源访问，或者指定你的 surge 域名 (为了 MVP 方便，先设为 *)
CORS(app, resources={r"/*": {"origins": "*"}}) 

logging.basicConfig(level=logging.INFO)

# 读取配置
try:
    with open('my_config.json', 'r', encoding='utf-8') as f:
        config = json.load(f)
        llm_config = config['anythingllm']
        
    soul_link = AnythingLLMAPI(
        base_url=llm_config['base_url'],
        api_key=llm_config['api_key_file_path'], # 请确保这里逻辑正确，如果是路径需要读取内容
        workspace_slug=llm_config['workspace_slug']
    )
    # 简单的修正：如果 key 是文件路径，读取它
    if "txt" in llm_config['api_key_file_path'] or "/" in llm_config['api_key_file_path']:
        try:
            with open(llm_config['api_key_file_path'], 'r') as kf:
                soul_link.api_key = kf.read().strip()
                soul_link.headers['Authorization'] = f'Bearer {soul_link.api_key}'
        except:
            pass # 也许用户填的就是 key
            
except Exception as e:
    print(f"配置加载警告: {e}")

@app.route('/')
def home():
    return "SoulLink Backend is Running!"

@app.route('/api/chat', methods=['POST'])
def chat():
    user_input = request.json.get('message')
    if not user_input:
        return jsonify({'error': 'No input'}), 400
    
    # 这里调用 AnythingLLM 的逻辑 (简化版)
    # 注意：由于原 anythingllm_api.py 没有 chat 方法，我们这里模拟或需要你自己补全
    # 为了 MVP 演示，我们假设直接发请求
    url = f"{soul_link.base_url}/api/v1/workspace/{soul_link.workspace_slug}/chat"
    payload = {
        "message": user_input,
        "mode": "chat"
    }
    
    try:
        # 使用你 api 类里的 _post_request (假设它是公共的，如果不是请改为 public)
        # 这里为了稳健，直接用 requests
        import requests
        headers = soul_link.headers
        response = requests.post(url, json=payload, headers=headers)
        
        if response.status_code == 200:
            data = response.json()
            return jsonify({
                'success': True, 
                'reply': data.get('textResponse', "（她微笑着看着你，似乎在思考...）")
            })
        else:
            return jsonify({'success': False, 'error': response.text})
            
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

if __name__ == '__main__':
    # host='0.0.0.0' 让局域网设备也能访问
    app.run(debug=True, port=5000, host='0.0.0.0')