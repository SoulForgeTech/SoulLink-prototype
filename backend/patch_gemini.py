#!/usr/bin/env python3
"""Patch AnythingLLM Gemini provider to support thinking content"""
import sys

FILE = "/app/server/utils/AiProviders/gemini/index.js"

with open(FILE, "r") as f:
    content = f.read()

# 1. Add supportsThinking getter after supportsSystemPrompt
old_supports = """  get supportsSystemPrompt() {
    return !NO_SYSTEM_PROMPT_MODELS.includes(this.model);
  }"""

new_supports = """  get supportsSystemPrompt() {
    return !NO_SYSTEM_PROMPT_MODELS.includes(this.model);
  }

  /**
   * Check if current model supports thinking/reasoning (Gemini 2.5+)
   */
  get supportsThinking() {
    return this.model.includes("2.5") || this.model.includes("3.");
  }"""

content = content.replace(old_supports, new_supports)

# 2. Patch getChatCompletion
old_getChatCompletion = """  async getChatCompletion(messages = null, { temperature = 0.7 }) {
    const result = await LLMPerformanceMonitor.measureAsyncFunction(
      this.openai.chat.completions
        .create({
          model: this.model,
          messages,
          temperature: temperature,
        })
        .catch((e) => {
          console.error(e);
          throw new Error(e.message);
        })
    );

    if (
      !result.output.hasOwnProperty("choices") ||
      result.output.choices.length === 0
    )
      return null;

    return {
      textResponse: result.output.choices[0].message.content,"""

new_getChatCompletion = """  async getChatCompletion(messages = null, { temperature = 0.7 }) {
    const requestParams = {
      model: this.model,
      messages,
      temperature: temperature,
    };

    // Enable thinking for Gemini 2.5+ models
    if (this.supportsThinking) {
      requestParams.extra_body = {
        google: {
          thinking_config: {
            include_thoughts: true,
          },
        },
      };
    }

    const result = await LLMPerformanceMonitor.measureAsyncFunction(
      this.openai.chat.completions
        .create(requestParams)
        .catch((e) => {
          console.error(e);
          throw new Error(e.message);
        })
    );

    if (
      !result.output.hasOwnProperty("choices") ||
      result.output.choices.length === 0
    )
      return null;

    // Extract thinking content if present
    const message = result.output.choices[0].message;
    let textResponse = message.content;
    if (message.reasoning_content && message.reasoning_content.trim().length > 0) {
      textResponse = "<think>" + message.reasoning_content + "</think>" + textResponse;
    }

    return {
      textResponse: textResponse,"""

content = content.replace(old_getChatCompletion, new_getChatCompletion)

# 3. Patch streamGetChatCompletion
old_stream = """  async streamGetChatCompletion(messages = null, { temperature = 0.7 }) {
    const measuredStreamRequest = await LLMPerformanceMonitor.measureStream({
      func: this.openai.chat.completions.create({
        model: this.model,
        stream: true,
        messages,
        temperature: temperature,
        stream_options: {
          include_usage: true,
        },
      }),"""

new_stream = """  async streamGetChatCompletion(messages = null, { temperature = 0.7 }) {
    const streamParams = {
      model: this.model,
      stream: true,
      messages,
      temperature: temperature,
      stream_options: {
        include_usage: true,
      },
    };

    // Enable thinking for Gemini 2.5+ models
    if (this.supportsThinking) {
      streamParams.extra_body = {
        google: {
          thinking_config: {
            include_thoughts: true,
          },
        },
      };
    }

    const measuredStreamRequest = await LLMPerformanceMonitor.measureStream({
      func: this.openai.chat.completions.create(streamParams),"""

content = content.replace(old_stream, new_stream)

with open(FILE, "w") as f:
    f.write(content)

print("SUCCESS: Gemini provider patched with thinking support!")
