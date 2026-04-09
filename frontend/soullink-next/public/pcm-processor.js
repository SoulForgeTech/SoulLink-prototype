/**
 * AudioWorklet Processor — captures PCM 16kHz 16-bit mono for Deepgram.
 *
 * Runs in a separate audio thread (not main thread).
 * Receives audio from microphone, downsamples to 16kHz, converts to Int16,
 * and posts the buffer to the main thread via port.postMessage().
 */
class PCMProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = [];
    // Target: send ~100ms of 16kHz audio at a time = 1600 samples
    this._targetSamples = 1600;
  }

  /**
   * Downsample from browser's native rate (usually 44100/48000) to 16000 Hz.
   * Simple linear interpolation — good enough for speech.
   */
  _downsample(inputBuffer, inputRate, outputRate) {
    if (inputRate === outputRate) return inputBuffer;
    const ratio = inputRate / outputRate;
    const outputLength = Math.floor(inputBuffer.length / ratio);
    const output = new Float32Array(outputLength);
    for (let i = 0; i < outputLength; i++) {
      const srcIndex = i * ratio;
      const low = Math.floor(srcIndex);
      const high = Math.min(low + 1, inputBuffer.length - 1);
      const frac = srcIndex - low;
      output[i] = inputBuffer[low] * (1 - frac) + inputBuffer[high] * frac;
    }
    return output;
  }

  /**
   * Convert Float32 [-1, 1] to Int16 [-32768, 32767].
   */
  _floatToInt16(float32Array) {
    const int16 = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
      const s = Math.max(-1, Math.min(1, float32Array[i]));
      int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return int16;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;

    const channelData = input[0]; // mono
    // Downsample to 16kHz
    const downsampled = this._downsample(channelData, sampleRate, 16000);

    // Accumulate samples
    for (let i = 0; i < downsampled.length; i++) {
      this._buffer.push(downsampled[i]);
    }

    // When we have enough, send a chunk
    if (this._buffer.length >= this._targetSamples) {
      const chunk = new Float32Array(this._buffer.splice(0, this._targetSamples));
      const pcm16 = this._floatToInt16(chunk);
      this.port.postMessage(pcm16.buffer, [pcm16.buffer]);
    }

    return true;
  }
}

registerProcessor('pcm-processor', PCMProcessor);
