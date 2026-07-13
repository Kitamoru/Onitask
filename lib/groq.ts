// Groq client (Hot Path: F-04, LTM)
// Wrapper for Groq API calls — whisper-large-v3-turbo + llama-3.3-70b-versatile

export class GroqClient {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async transcribe(audioBlob: Blob): Promise<{ text: string }> {
    // TODO: Implement Whisper transcription
    throw new Error('Not implemented');
  }

  async chat(messages: Array<{ role: string; content: string }>): Promise<string> {
    // TODO: Implement llama chat completion
    throw new Error('Not implemented');
  }
}