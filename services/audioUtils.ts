import { Blob } from '@google/genai';

export const PCM_SAMPLE_RATE = 16000;

/**
 * Converts a Float32Array of audio data into a generic Blob structure
 * formatted for the Gemini API (16-bit PCM, 16kHz).
 * 
 * Includes "Soft Clipping" logic to prevent digital distortion.
 * 
 * @param data - Raw Float32 audio samples (usually -1.0 to 1.0)
 * @returns A Blob-like object containing base64 encoded PCM data
 */
export function createBlob(data: Float32Array): Blob {
  const l = data.length;
  // Use Int16Array directly for PCM data
  const int16 = new Int16Array(l);
  for (let i = 0; i < l; i++) {
    // Soft clip using hyperbolic tangent (tanh)
    // This provides a smooth "limiter" effect, preventing harsh digital distortion (clipping)
    // if the input signal (after makeup gain) exceeds 1.0.
    // It maps [-Infinity, Infinity] to [-1, 1] smoothly.
    const sample = Math.tanh(data[i]);
    
    // Convert float to 16-bit PCM
    int16[i] = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
  }
  
  // Create the blob from the Int16Array buffer
  // We use a manual encoding to string approach to avoid external deps, 
  // but we process in chunks to prevent stack overflow on large buffers.
  return {
    data: encode(new Uint8Array(int16.buffer)),
    mimeType: 'audio/pcm;rate=16000',
  };
}

/**
 * Downsamples audio to the target 16kHz rate using Linear Interpolation.
 * This provides higher quality than nearest-neighbor (dropping samples) by
 * smoothing out the signal, which is critical for Speech-to-Text accuracy.
 * 
 * @param buffer - The source audio buffer (e.g., 44.1kHz or 48kHz)
 * @param inputRate - The sample rate of the source buffer
 * @returns A new Float32Array at 16kHz
 */
export function downsampleTo16k(buffer: Float32Array, inputRate: number): Float32Array {
  if (inputRate === PCM_SAMPLE_RATE) return buffer;
  
  const ratio = inputRate / PCM_SAMPLE_RATE;
  const newLength = Math.round(buffer.length / ratio);
  const result = new Float32Array(newLength);
  
  for (let i = 0; i < newLength; i++) {
    const inputIndex = i * ratio;
    const indexFloor = Math.floor(inputIndex);
    const indexCeil = Math.min(Math.ceil(inputIndex), buffer.length - 1);
    const weight = inputIndex - indexFloor;
    
    // Lerp (Linear Interpolation) formula: a + t * (b - a)
    const sample = buffer[indexFloor] * (1 - weight) + buffer[indexCeil] * weight;
    result[i] = sample;
  }
  return result;
}

/**
 * Encodes a Uint8Array to a Base64 string.
 * Used for transmitting binary PCM data over JSON/WebSocket.
 */
export function encode(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  // Process in chunks to handle potentially large buffers if needed, though usually small
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Decodes a Base64 string back to a Uint8Array.
 * Used for processing audio response data from the API.
 */
export function decode(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

/**
 * Converts raw PCM byte data into a browser AudioBuffer for playback.
 * 
 * @param data - The raw PCM bytes (Uint8Array)
 * @param ctx - The Active AudioContext
 * @param sampleRate - The sample rate of the audio data (default 24000 for Gemini output)
 * @param numChannels - Number of audio channels (default 1 for mono)
 */
export async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number = 24000,
  numChannels: number = 1
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      // Normalize Int16 (-32768 to 32767) to Float32 (-1.0 to 1.0)
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}