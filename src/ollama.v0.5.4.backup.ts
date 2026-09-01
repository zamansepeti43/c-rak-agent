import ollama from "ollama";

export const MODEL = process.env.OLLAMA_MODEL ?? "qwen2.5-coder:7b";

export async function askOllama(prompt: string): Promise<string> {
  const response = await ollama.chat({
    model: MODEL,
    messages: [{ role: "user", content: prompt }],
    options: {
      temperature: 0.15,
      num_predict: 1200
    }
  });
  return response.message.content;
}

export async function checkOllama(): Promise<boolean> {
  try {
    await ollama.list();
    return true;
  } catch {
    return false;
  }
}