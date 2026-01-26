import os
import requests
import logging
import mimetypes
import time
from typing import Dict, Any, Optional
import json

class AnythingLLMAPI:
    def __init__(self, base_url: str, api_key: str, workspace_slug: str):
        logging.info("Starting AnythingLLM API Client")
        self.base_url = base_url
        self.api_key = api_key
        self.workspace_slug = workspace_slug
        self.headers = {
            'Authorization': f'Bearer {self.api_key}',
            'accept': 'application/json'
        }
        self.verify_auth()

    def verify_auth(self) -> Dict[str, Any]:
        """Verify authentication using the API key."""
        url = f"{self.base_url}/api/v1/auth"
        logging.info("Verifying authentication with AnythingLLM...")
        response = self._get_request(url)
        if response.get('status_code') == 200:
            logging.info("Authentication verified successfully.")
        else:
            logging.error("Authentication failed.")
        return response


    def list_available_documents(self) -> Dict[str, Any]:
        """List all documents available for adding to workspace."""
        url = f"{self.base_url}/api/v1/system/local-files"
        
        try:
            response = self._get_request(url)
            if response.get('status_code') == 200:
                return response
            else:
                logging.error(f"Failed to list documents: {response}")
                return response
        except Exception as e:
            logging.error(f"Error listing documents: {e}")
            return {'error': str(e)}

    def get_workspace_documents(self) -> Dict[str, Any]:
        """Get documents currently in the workspace."""
        url = f"{self.base_url}/api/v1/workspace/{self.workspace_slug}/documents"
        
        try:
            response = self._get_request(url)
            return response
        except Exception as e:
            logging.error(f"Error getting workspace documents: {e}")
            return {'error': str(e)}

    def _get_request(self, url: str, headers: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        """Internal method to handle GET requests."""
        try:
            combined_headers = {**self.headers, **(headers or {})}
            response = requests.get(url, headers=combined_headers, timeout=30)
            response.raise_for_status()
            logging.debug(f"GET request to {url} successful.")
            
            try:
                return {"status_code": response.status_code, "data": response.json()}
            except ValueError:
                # Handle non-JSON responses
                return {"status_code": response.status_code, "data": {"text": response.text}}
                
        except requests.Timeout:
            error_msg = f"GET request to {url} timed out"
            logging.error(error_msg)
            return {'status_code': 408, 'error': error_msg}
        except requests.ConnectionError:
            error_msg = f"Connection error for GET request to {url}"
            logging.error(error_msg)
            return {'status_code': 503, 'error': error_msg}
        except requests.RequestException as e:
            error_msg = f"GET request to {url} failed: {e}"
            logging.error(error_msg)
            return {'status_code': getattr(e.response, 'status_code', 500), 'error': error_msg}

    def _post_request(self, url: str, payload: Optional[Dict[str, Any]] = None, files: Optional[Dict[str, Any]] = None, headers: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        """Internal method to handle POST requests."""
        try:
            combined_headers = {**self.headers, **(headers or {})}
            
            if files:
                # Remove content-type header for file uploads to let requests handle it
                if 'content-type' in combined_headers:
                    del combined_headers['content-type']
                response = requests.post(url, headers=combined_headers, files=files, timeout=300)
            else:
                response = requests.post(url, headers=combined_headers, json=payload, timeout=300)
            
            response.raise_for_status()
            logging.debug(f"POST request to {url} successful.")
            
            try:
                return {"status_code": response.status_code, "data": response.json()}
            except ValueError:
                # Handle non-JSON responses
                return {"status_code": response.status_code, "data": {"text": response.text}}
                
        except requests.Timeout:
            error_msg = f"POST request to {url} timed out"
            logging.error(error_msg)
            return {'status_code': 408, 'error': error_msg}
        except requests.ConnectionError:
            error_msg = f"Connection error for POST request to {url}"
            logging.error(error_msg)
            return {'status_code': 503, 'error': error_msg}
        except requests.RequestException as e:
            error_msg = f"POST request to {url} failed: {e}"
            logging.error(error_msg)
            status_code = getattr(e.response, 'status_code', 500) if hasattr(e, 'response') and e.response else 500
            return {'status_code': status_code, 'error': error_msg}
        except ValueError as e:
            error_msg = f"Failed to parse JSON response from {url}: {e}"
            logging.error(error_msg)
            return {'status_code': 500, 'error': error_msg}
    
    # Key methods to replace in anythingllm_api.py
    
    def upload_document(self, file_path: str) -> Dict[str, Any]:
        """
        Upload a document and add it to the workspace for processing.
        FIXED: Improved timing and status checking.
        """
        file_name = os.path.basename(file_path)
        content_type, _ = mimetypes.guess_type(file_path)
        if not content_type:
            content_type = "application/octet-stream"

        logging.info(f"Uploading document '{file_name}' to AnythingLLM...")
        
        try:
            # Step 1: Upload document to AnythingLLM storage
            with open(file_path, 'rb') as file:
                files = {'file': (file_name, file, content_type)}
                upload_response = self._post_request(
                    f"{self.base_url}/api/v1/document/upload", 
                    files=files
                )
                
            if upload_response.get('status_code') != 200:
                logging.error(f"Document upload failed: {upload_response}")
                return upload_response
                
            upload_data = upload_response.get('data', {})
            
            # FIXED: Check for success flag in upload data
            if not upload_data.get('success', False):
                logging.error(f"Upload API returned success=false: {upload_data}")
                return {
                    'status_code': 500,
                    'data': {'success': False, 'error': 'Upload API returned success=false'},
                    'raw_response': upload_data
                }
            
            documents = upload_data.get('documents', [])
            if not documents:
                logging.error("No document data returned from upload")
                return {'status_code': 500, 'error': 'No document data returned'}
            
            document = documents[0]
            document_title = document.get('title', file_name)
            
            logging.info(f"✅ Document '{file_name}' uploaded to storage")
            logging.debug(f"Document info: {document}")
            
            # Step 2: Add document to workspace using SIMPLE FILENAME
            workspace_response = self.add_document_to_workspace(document_title)
            
            if workspace_response.get('success'):
                logging.info(f"✅ Document '{file_name}' added to workspace '{self.workspace_slug}'")
                
                # FIXED: Wait longer for processing and check status
                logging.info("⏳ Waiting for vector processing to start...")
                time.sleep(5)  # Increased from 2 seconds
                
                # Check workspace status (optional verification)
                status_check = self.check_workspace_status()
                vector_info = ""
                if status_check:
                    vector_count = self.get_vector_count_safely(status_check.get('data', {}))
                    vector_info = f" (Vectors: {vector_count})"
                
                return {
                    'status_code': 200,
                    'data': {
                        'success': True,
                        'upload_info': upload_data,
                        'workspace_info': workspace_response,
                        'document_name': document_title,
                        'vector_status': vector_info
                    }
                }
            else:
                logging.error(f"Failed to add document to workspace: {workspace_response}")
                return {
                    'status_code': 500,
                    'data': {
                        'success': False,
                        'error': 'Document uploaded but failed to add to workspace',
                        'upload_info': upload_data,
                        'workspace_error': workspace_response
                    }
                }
                
        except FileNotFoundError:
            error_msg = f"File not found: {file_path}"
            logging.error(error_msg)
            return {'status_code': 404, 'error': error_msg}
        except Exception as e:
            error_msg = f"Unexpected error during upload: {e}"
            logging.error(error_msg)
            return {'status_code': 500, 'error': error_msg}

    def send_message(self, message: str, mode: str = "chat", session_id: Optional[str] = None) -> Dict[str, Any]:
        """
        Send a message to the workspace.
        FIXED: Improved source extraction and response formatting.
        """
        url = f"{self.base_url}/api/v1/workspace/{self.workspace_slug}/chat"
        payload = {
            "message": message,
            "mode": mode,
            "sessionId": session_id if session_id else "default-session"
        }


        # 添加这些日志
        # logging.info(f"=== REQUEST DEBUG ===")
        # logging.info(f"URL: {url}")
        # logging.info(f"Payload: {payload}")
        # logging.info(f"Headers: {self.headers}")

        logging.info(f"Sending message to AnythingLLM workspace '{self.workspace_slug}': {message[:100]}{'...' if len(message) > 100 else ''}")
        response = self._post_request(url, payload=payload)
        
        # 添加这些日志
        # logging.info(f"=== RESPONSE DEBUG ===")
        # logging.info(f"Status Code: {response.get('status_code')}")
        # logging.info(f"Raw Response Keys: {list(response.get('data', {}).keys())}")
        # logging.info(f"textResponse: {response.get('data', {}).get('textResponse')}")
        # logging.info(f"Full Response: {json.dumps(response, indent=2, ensure_ascii=False)}")


        if response.get('status_code') == 200:
            logging.info(f"Message sent successfully")
            data = response.get('data', {})
            text_response = data.get('textResponse', '')
            
            # FIXED: Improved source extraction with multiple fallback methods
            sources = []
            
            # Method 1: Check 'sources' field
            if 'sources' in data and data['sources']:
                sources = data['sources']
                logging.info(f"✅ Found {len(sources)} sources via 'sources' field")
            
            # Method 2: Check 'source' field (alternative format)
            elif 'source' in data and data['source']:
                sources = data['source'] if isinstance(data['source'], list) else [data['source']]
                logging.info(f"✅ Found {len(sources)} sources via 'source' field")
            
            # Method 3: Look deeper in response structure
            elif isinstance(data, dict):
                # Sometimes sources are nested deeper
                for key in ['chatMessage', 'response', 'result']:
                    if key in data and isinstance(data[key], dict):
                        nested_sources = data[key].get('sources', [])
                        if nested_sources:
                            sources = nested_sources
                            logging.info(f"✅ Found {len(sources)} sources via nested '{key}.sources'")
                            break
            
            if not sources:
                logging.warning(f"⚠️ No sources found in response")
                logging.debug(f"Response structure: {list(data.keys())}")
            
            # Ensure sources are properly formatted as strings
            formatted_sources = []
            for source in sources:
                if isinstance(source, dict):
                    # Extract text content from source object
                    text_content = (
                        source.get('text', '') or 
                        source.get('content', '') or 
                        source.get('page_content', '') or
                        str(source)
                    )
                    formatted_sources.append(text_content)
                else:
                    formatted_sources.append(str(source))
            
            formatted_response = {
                'text_response': text_response,
                'full_response': {
                    'status_code': response.get('status_code'),
                    'data': {
                        'textResponse': text_response,
                        'sources': formatted_sources,
                        'source': formatted_sources,  # Keep both for compatibility
                        'raw_sources': sources,  # Keep original format for debugging
                        **data  # Include all original data
                    }
                }
            }
            
            logging.info(f"✅ Response formatted with {len(formatted_sources)} sources")
            logging.debug(f"Formatted response keys: {list(formatted_response['full_response']['data'].keys())}")
            
            return formatted_response
        else:
            error_msg = f"Failed to send message: HTTP {response.get('status_code')}"
            logging.error(error_msg)
            return {
                'text_response': f"Error: {error_msg}",
                'full_response': response
            }

    def check_workspace_status(self) -> Dict[str, Any]:
        """Check workspace status for debugging purposes."""
        url = f"{self.base_url}/api/v1/workspace/{self.workspace_slug}"
        try:
            response = self._get_request(url)
            return response
        except Exception as e:
            logging.error(f"Error checking workspace status: {e}")
            return {'error': str(e)}

    def get_vector_count_safely(self, ws_data):
        """Safely extract vector count from workspace data (from debug script)."""
        try:
            if isinstance(ws_data, dict):
                if 'workspace' in ws_data and isinstance(ws_data['workspace'], dict):
                    return ws_data['workspace'].get('vectorCount', 0)
                elif 'vectorCount' in ws_data:
                    return ws_data.get('vectorCount', 0)
                elif 'documents' in ws_data:
                    return len(ws_data['documents'])
            elif isinstance(ws_data, list):
                if len(ws_data) > 0 and isinstance(ws_data[0], dict):
                    first_item = ws_data[0]
                    if 'vectorCount' in first_item:
                        return first_item['vectorCount']
                    elif 'documents' in first_item:
                        return len(first_item['documents'])
                return len(ws_data) if ws_data else 0
            return 0
        except:
            return 0

    def add_document_to_workspace(self, document_name: str) -> Dict[str, Any]:
        """
        Add an uploaded document to the workspace for vector processing.
        FIXED: Use simple filename format as discovered in debugging.
        """
        url = f"{self.base_url}/api/v1/workspace/{self.workspace_slug}/update-embeddings"
        
        # CRITICAL FIX: Use simple filename, not full path
        # Based on debug results: working format is just "filename.txt"
        simple_name = document_name
        if '/' in document_name:
            # Extract just the filename if full path was passed
            simple_name = document_name.split('/')[-1]
            if simple_name.endswith('.json'):
                # Remove .json extension to get original filename
                simple_name = simple_name.replace('.json', '')
                # Remove UUID part if present
                if '-' in simple_name:
                    parts = simple_name.split('-')
                    if len(parts) > 1 and len(parts[-1]) == 36:  # UUID length
                        simple_name = '-'.join(parts[:-1])
        
        payload = {
            "adds": [simple_name],  # Use simple filename format
            "deletes": []
        }
        
        logging.info(f"Adding document '{simple_name}' to workspace '{self.workspace_slug}'...")
        
        try:
            response = self._post_request(url, payload=payload)
            
            if response.get('status_code') == 200:
                data = response.get('data', {})
                logging.info(f"✅ Document addition request successful")
                return {'success': True, 'data': data}
            else:
                logging.error(f"Failed to add document to workspace: {response}")
                return {'success': False, 'error': response}
                
        except Exception as e:
            logging.error(f"Error adding document to workspace: {e}")
            return {'success': False, 'error': str(e)}