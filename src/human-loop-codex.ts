import type { CodexInteractionRequest } from './code-agent.js';
import type { BeginHumanLoopPromptOpts } from './bot.js';

export function buildCodexHumanLoopPrompt(
  request: CodexInteractionRequest,
): Omit<BeginHumanLoopPromptOpts, 'taskId' | 'chatId'> {
  return {
    title: 'User Input Required',
    detail: 'codex',
    hint: 'Use the buttons when available. Reply with text when prompted.',
    questions: request.questions.map(question => ({
      id: question.id,
      header: question.header || 'Question',
      prompt: question.question,
      options: question.options?.map(option => ({
        label: option.label,
        description: option.description,
        value: option.label,
      })) || null,
      allowFreeform: question.isOther || !question.options?.length,
      secret: question.isSecret,
      allowEmpty: true,
    })),
    resolveWith: answers => ({
      answers: Object.fromEntries(
        Object.entries(answers).map(([id, values]) => [id, { answers: values }]),
      ),
    }),
  };
}
