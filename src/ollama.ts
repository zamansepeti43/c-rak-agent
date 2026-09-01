import ollama from "ollama";

export const MODEL =
  process.env.OLLAMA_MODEL ?? "qwen2.5-coder:7b";

export async function askOllama(
  prompt: string
): Promise<string> {
  const response = await ollama.chat({
    model: MODEL,
    messages: [
      {
        role: "user",
        content: prompt
      }
    ],
    options: {
      temperature: 0.1,
      num_predict: 350
    }
  });

  return response.message.content;
}

export async function askOllamaFast(
  prompt: string
): Promise<string> {
  const response = await ollama.chat({
    model: MODEL,
    messages: [
      {
        role: "user",
        content: prompt
      }
    ],
    options: {
      temperature: 0.1,
      num_predict: 80,
      num_ctx: 2048
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



export async function askOllamaVideo(
  prompt: string
): Promise<string> {
  const response = await ollama.chat({
    model: MODEL,
    messages: [
      {
        role: "user",
        content: prompt
      }
    ],
    options: {
      temperature: 0.2,
      num_predict: 1800,
      num_ctx: 8192
    }
  });

  return response.message.content;
}
