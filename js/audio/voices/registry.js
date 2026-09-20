import { DroneVoice } from './drone.js';
import { NoiseVoice } from './noise.js';
import { GrainVoice } from './grain.js';
import { DriveVoice } from './drive.js';

// 音源種別は配列駆動。種別を足すのに UI 側の分岐は書き足さない。
export const VOICE_TYPES = [DroneVoice, NoiseVoice, GrainVoice, DriveVoice];

export function voiceClass(type) {
  return VOICE_TYPES.find((V) => V.type === type) || VOICE_TYPES[0];
}

export function createVoice(engine, data) {
  const V = voiceClass(data.type);
  return new V(engine, data);
}
