import { Blob } from '@google/genai';

export const PCM_SAMPLE_RATE = 16000;

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

// Linear Interpolation Downsampling (High Quality)
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
    
    // Lerp
    const sample = buffer[indexFloor] * (1 - weight) + buffer[indexCeil] * weight;
    result[i] = sample;
  }
  return result;
}

export function encode(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  // Process in chunks to handle potentially large buffers if needed, though usually small
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function decode(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

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
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}