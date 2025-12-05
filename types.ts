export enum StreamStatus {
  DISCONNECTED = 'DISCONNECTED',
  CONNECTING = 'CONNECTING',
  CONNECTED = 'CONNECTED',
  ERROR = 'ERROR',
}

export interface TranscriptSegment {
  id: string;
  sender: 'user' | 'model';
  text: string;
  timestamp: Date;
  isPartial: boolean;
}

export interface OrganizedNote {
  title: string;
  summary: string;
  topics: string[];
  actionItems: string[];
  decisions: string[];
  sentiment: 'positive' | 'neutral' | 'negative';
  timestamp: string;
}

export interface AudioVisualizerData {
  values: number[];
}

export interface StatPoint {
  topic: string;
  count: number;
}

export interface AudioConfig {
  latencyMode: 'interactive' | 'balanced' | 'playback';
  noiseGateThreshold: number; // 0.0 to 0.05
}