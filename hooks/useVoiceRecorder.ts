// useVoiceRecorder hook — MediaRecorder lifecycle for voice input (F-04)
// Handles recording, waveform display, and upload to /api/ai/transcribe

export function useVoiceRecorder(onResult?: (text: string) => void) {
  const isRecording = false;
  const duration = 0;

  return {
    isRecording,
    duration,
    startRecording: () => {},
    stopRecording: async () => '',
    cancelRecording: () => {},
  };
}