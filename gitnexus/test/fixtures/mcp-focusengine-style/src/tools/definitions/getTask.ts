export async function getTaskHandler() {
  return {
    content: [{ type: 'text' as const, text: '{}' }],
  };
}

export const getTaskTool = {
  schema: z.object({
    id: z.string(),
  }),
  handler: getTaskHandler,
};

