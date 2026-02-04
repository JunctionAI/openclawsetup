/**
 * Unit Tests for Chat Handler
 * Tests AI chat functionality, context building, and memory management
 */

const path = require('path');
const fs = require('fs').promises;

// Mock modules before importing
jest.mock('@anthropic-ai/sdk', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    messages: {
      create: jest.fn(),
    },
  })),
}));

jest.mock('openai', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: jest.fn(),
      },
    },
  })),
}));

jest.mock('fs', () => ({
  promises: {
    readFile: jest.fn(),
    writeFile: jest.fn(),
    appendFile: jest.fn(),
    access: jest.fn(),
    readdir: jest.fn(),
    mkdir: jest.fn(),
  },
}));

describe('Chat Handler', () => {
  let chatHandler;
  let Anthropic;
  let OpenAI;
  let mockFs;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    Anthropic = require('@anthropic-ai/sdk').default;
    OpenAI = require('openai').default;
    mockFs = require('fs').promises;

    // Set up environment
    process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
    process.env.OPENAI_API_KEY = 'test-openai-key';

    // Import handler
    chatHandler = require('../../api/chat-handler');
  });

  describe('getWorkspaceContext', () => {
    it('should load context files when they exist', async () => {
      mockFs.access.mockResolvedValue(undefined); // Files exist
      mockFs.readFile.mockImplementation((filePath) => {
        if (filePath.includes('USER.md')) {
          return Promise.resolve('# User Profile\nName: Test User');
        }
        if (filePath.includes('SOUL.md')) {
          return Promise.resolve('# Personality\nBe helpful and friendly');
        }
        if (filePath.includes('MEMORY.md')) {
          return Promise.resolve('# Memories\nRemember X about user');
        }
        return Promise.resolve('');
      });
      mockFs.readdir.mockResolvedValue([]);

      const context = await chatHandler.getWorkspaceContext('/test/workspace');

      expect(context.user).toContain('Test User');
      expect(context.soul).toContain('helpful');
      expect(context.memory).toContain('Remember');
    });

    it('should handle missing context files gracefully', async () => {
      mockFs.access.mockRejectedValue(new Error('ENOENT'));
      mockFs.readdir.mockRejectedValue(new Error('ENOENT'));

      const context = await chatHandler.getWorkspaceContext('/test/workspace');

      expect(context.user).toBe('');
      expect(context.soul).toBe('');
      expect(context.memory).toBe('');
    });

    it('should load recent daily memory files', async () => {
      mockFs.access.mockResolvedValue(undefined);
      mockFs.readFile.mockResolvedValue('Memory content');
      mockFs.readdir.mockResolvedValue([
        '2024-01-01.md',
        '2024-01-02.md',
        '2024-01-03.md',
        '2024-01-04.md',
        '2024-01-05.md',
      ]);

      const context = await chatHandler.getWorkspaceContext('/test/workspace');

      // Should only load last 3 days
      expect(context.recentConversations.length).toBeLessThanOrEqual(3);
    });

    it('should filter non-daily files from memory directory', async () => {
      mockFs.access.mockResolvedValue(undefined);
      mockFs.readFile.mockResolvedValue('Content');
      mockFs.readdir.mockResolvedValue([
        '2024-01-01.md',
        'README.md', // Should be ignored
        'notes.txt', // Should be ignored
        '2024-01-02.md',
      ]);

      const context = await chatHandler.getWorkspaceContext('/test/workspace');

      // Should only include dated files
      context.recentConversations.forEach((conv) => {
        expect(conv.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      });
    });
  });

  describe('buildSystemPrompt', () => {
    it('should include user context in prompt', () => {
      const context = {
        user: 'User is a software developer',
        soul: 'Be technical and precise',
        memory: 'User prefers TypeScript',
        recentConversations: [],
      };

      const prompt = chatHandler.buildSystemPrompt(context, 'Pro');

      expect(prompt).toContain('software developer');
      expect(prompt).toContain('technical and precise');
      expect(prompt).toContain('TypeScript');
    });

    it('should include plan limits in prompt', () => {
      const context = {
        user: '',
        soul: '',
        memory: '',
        recentConversations: [],
      };

      const prompt = chatHandler.buildSystemPrompt(context, 'Starter');

      expect(prompt).toContain('Starter');
      expect(prompt).toContain('5000');
    });

    it('should handle empty context', () => {
      const context = {
        user: '',
        soul: '',
        memory: '',
        recentConversations: [],
      };

      const prompt = chatHandler.buildSystemPrompt(context, 'Pro');

      // Should still generate valid prompt
      expect(prompt.length).toBeGreaterThan(0);
      expect(prompt).toContain('assistant');
    });

    it('should include recent conversations', () => {
      const context = {
        user: '',
        soul: '',
        memory: '',
        recentConversations: [
          { date: '2024-01-01', content: 'Previous conversation content' },
        ],
      };

      const prompt = chatHandler.buildSystemPrompt(context, 'Pro');

      expect(prompt).toContain('2024-01-01');
      expect(prompt).toContain('Previous conversation');
    });
  });

  describe('chat', () => {
    it('should use Claude when Anthropic key is available', async () => {
      const mockCreate = jest.fn().mockResolvedValue({
        content: [{ text: 'Hello! How can I help you?' }],
      });

      Anthropic.mockImplementation(() => ({
        messages: { create: mockCreate },
      }));

      // Re-import to get fresh instance
      jest.resetModules();
      process.env.ANTHROPIC_API_KEY = 'test-key';
      const handler = require('../../api/chat-handler');

      mockFs.access.mockRejectedValue(new Error('ENOENT'));
      mockFs.readdir.mockRejectedValue(new Error('ENOENT'));
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.appendFile.mockResolvedValue(undefined);

      const result = await handler.chat('test_workspace', 'Hello', {
        plan: 'Pro',
      });

      expect(result.response).toBe('Hello! How can I help you?');
    });

    it('should fall back to OpenAI when Anthropic is unavailable', async () => {
      const mockCreate = jest.fn().mockResolvedValue({
        choices: [{ message: { content: 'OpenAI response' } }],
      });

      OpenAI.mockImplementation(() => ({
        chat: { completions: { create: mockCreate } },
      }));

      // Re-import with only OpenAI key
      jest.resetModules();
      delete process.env.ANTHROPIC_API_KEY;
      process.env.OPENAI_API_KEY = 'test-openai-key';
      const handler = require('../../api/chat-handler');

      mockFs.access.mockRejectedValue(new Error('ENOENT'));
      mockFs.readdir.mockRejectedValue(new Error('ENOENT'));
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.appendFile.mockResolvedValue(undefined);

      const result = await handler.chat('test_workspace', 'Hello', {
        plan: 'Pro',
      });

      expect(result.response).toBe('OpenAI response');
    });

    it('should throw error when no AI key is configured', async () => {
      jest.resetModules();
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.OPENAI_API_KEY;
      const handler = require('../../api/chat-handler');

      mockFs.access.mockRejectedValue(new Error('ENOENT'));
      mockFs.readdir.mockRejectedValue(new Error('ENOENT'));

      await expect(
        handler.chat('test_workspace', 'Hello', { plan: 'Pro' })
      ).rejects.toThrow('No AI API key configured');
    });

    it('should save conversation to daily memory', async () => {
      const mockCreate = jest.fn().mockResolvedValue({
        content: [{ text: 'Response' }],
      });

      Anthropic.mockImplementation(() => ({
        messages: { create: mockCreate },
      }));

      jest.resetModules();
      process.env.ANTHROPIC_API_KEY = 'test-key';
      const handler = require('../../api/chat-handler');

      mockFs.access.mockRejectedValue(new Error('ENOENT'));
      mockFs.readdir.mockRejectedValue(new Error('ENOENT'));
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.appendFile.mockResolvedValue(undefined);

      await handler.chat('test_workspace', 'Hello', { plan: 'Pro' });

      expect(mockFs.mkdir).toHaveBeenCalled();
      expect(mockFs.appendFile).toHaveBeenCalled();
    });
  });

  describe('getPlanLimits (internal)', () => {
    // Test plan limits indirectly through buildSystemPrompt
    it('should return correct limits for Starter plan', () => {
      const context = {
        user: '',
        soul: '',
        memory: '',
        recentConversations: [],
      };

      const prompt = chatHandler.buildSystemPrompt(context, 'Starter');

      expect(prompt).toContain('5000');
      expect(prompt).toContain('chat');
      expect(prompt).toContain('memory');
    });

    it('should return correct limits for Pro plan', () => {
      const context = {
        user: '',
        soul: '',
        memory: '',
        recentConversations: [],
      };

      const prompt = chatHandler.buildSystemPrompt(context, 'Pro');

      expect(prompt).toContain('20000');
      expect(prompt).toContain('gmail');
      expect(prompt).toContain('browser');
    });

    it('should return correct limits for Team plan', () => {
      const context = {
        user: '',
        soul: '',
        memory: '',
        recentConversations: [],
      };

      const prompt = chatHandler.buildSystemPrompt(context, 'Team');

      expect(prompt).toContain('100000');
      expect(prompt).toContain('all');
    });

    // BUG CATCHER: Unknown plan should default to Starter
    it('should use Starter limits for unknown plan', () => {
      const context = {
        user: '',
        soul: '',
        memory: '',
        recentConversations: [],
      };

      const prompt = chatHandler.buildSystemPrompt(context, 'InvalidPlan');

      expect(prompt).toContain('5000');
    });
  });

  describe('Error Handling', () => {
    it('should handle file read errors gracefully', async () => {
      mockFs.access.mockResolvedValue(undefined);
      mockFs.readFile.mockRejectedValue(new Error('Permission denied'));
      mockFs.readdir.mockRejectedValue(new Error('Permission denied'));

      const context = await chatHandler.getWorkspaceContext('/test/workspace');

      // Should return empty context, not throw
      expect(context.user).toBe('');
    });

    it('should handle AI API errors', async () => {
      const mockCreate = jest.fn().mockRejectedValue(new Error('API error'));

      Anthropic.mockImplementation(() => ({
        messages: { create: mockCreate },
      }));

      jest.resetModules();
      process.env.ANTHROPIC_API_KEY = 'test-key';
      delete process.env.OPENAI_API_KEY;
      const handler = require('../../api/chat-handler');

      mockFs.access.mockRejectedValue(new Error('ENOENT'));
      mockFs.readdir.mockRejectedValue(new Error('ENOENT'));

      await expect(
        handler.chat('test_workspace', 'Hello', { plan: 'Pro' })
      ).rejects.toThrow('API error');
    });

    // BUG CATCHER: Memory save failure shouldn't break chat
    it('should not fail chat if memory save fails', async () => {
      const mockCreate = jest.fn().mockResolvedValue({
        content: [{ text: 'Response' }],
      });

      Anthropic.mockImplementation(() => ({
        messages: { create: mockCreate },
      }));

      jest.resetModules();
      process.env.ANTHROPIC_API_KEY = 'test-key';
      const handler = require('../../api/chat-handler');

      mockFs.access.mockRejectedValue(new Error('ENOENT'));
      mockFs.readdir.mockRejectedValue(new Error('ENOENT'));
      mockFs.mkdir.mockRejectedValue(new Error('Disk full'));
      mockFs.appendFile.mockRejectedValue(new Error('Disk full'));

      // Should still return response
      const result = await handler.chat('test_workspace', 'Hello', {
        plan: 'Pro',
      });
      expect(result.response).toBe('Response');
    });
  });
});
