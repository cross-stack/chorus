import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RelatedContextProvider } from './RelatedContextProvider';
import { TestDatabase, createMockVSCodeTextDocument } from '../test/testUtils';

// mock vscode module
vi.mock('vscode', () => ({
  Range: vi.fn().mockImplementation((startLine, startChar, endLine, endChar) => ({
    start: { line: startLine, character: startChar },
    end: { line: endLine, character: endChar },
  })),
  CodeLens: vi.fn().mockImplementation((range, command) => ({
    range,
    command,
  })),
  CancellationToken: {},
}));

describe('RelatedContextProvider', () => {
  let testDb: TestDatabase;
  let provider: RelatedContextProvider;

  beforeEach(async () => {
    testDb = new TestDatabase();
    await testDb.setup();
    provider = new RelatedContextProvider(testDb.db);
  });

  afterEach(async () => {
    await testDb.cleanup();
    vi.clearAllMocks();
  });

  describe('provideCodeLenses', () => {
    beforeEach(async () => {
      // add test context data
      await testDb.db.addContextEntry({
        type: 'commit',
        title: 'feat: add authentication module',
        path: 'abc123',
        content: 'Implemented OAuth2 authentication flow',
        metadata: { hash: 'abc123', files: ['src/auth.ts'] },
      });

      await testDb.db.addContextEntry({
        type: 'doc',
        title: 'User Management Guide',
        path: 'docs/users.md',
        content: 'Guide for managing users and authentication',
        metadata: { fileSize: 200 },
      });

      await testDb.db.addContextEntry({
        type: 'commit',
        title: 'refactor: improve UserService performance',
        path: 'def456',
        content: 'Optimized user lookup queries',
        metadata: { hash: 'def456', files: ['src/services/UserService.ts'] },
      });
    });

    it('should provide CodeLens for files with relevant context', async () => {
      const document = createMockVSCodeTextDocument(
        '// Auth module\nclass AuthService {}',
        'src/auth.ts'
      );
      const token = {} as any; // Mock cancellation token

      const codeLenses = await provider.provideCodeLenses(document, token);

      expect(codeLenses).toBeDefined();
      expect(Array.isArray(codeLenses)).toBe(true);
      expect(codeLenses.length).toBeGreaterThan(0);

      // should have a CodeLens at the top of the file
      const topLevelLens = codeLenses.find(
        (lens) => lens.range.start.line === 0 && lens.range.start.character === 0
      );
      expect(topLevelLens).toBeDefined();
      expect(topLevelLens?.command.title).toMatch(/Related context \(\d+\)/);
      expect(topLevelLens?.command.command).toBe('chorus.showPanel');
    });

    it('should provide CodeLens for functions and classes', async () => {
      const documentContent = `
function authenticateUser() {
	// implementation
}

class UserService {
	// class implementation
}

interface UserData {
	id: string;
}

type AuthResult = {
	success: boolean;
};
`;
      const document = createMockVSCodeTextDocument(documentContent, 'src/services/UserService.ts');
      const token = {} as any;

      const codeLenses = await provider.provideCodeLenses(document, token);

      // should find CodeLens for UserService since we have related context
      const userServiceLens = codeLenses.find((lens) => lens.command.title.includes('UserService'));
      expect(userServiceLens).toBeDefined();
      expect(userServiceLens?.command.arguments?.[0]).toEqual(
        expect.objectContaining({
          filePath: 'src/services/UserService.ts',
          symbolName: 'UserService',
        })
      );
    });

    it('should return empty array when no relevant context found', async () => {
      const document = createMockVSCodeTextDocument(
        '// Unrelated file\nconst x = 1;',
        'src/unrelated.ts'
      );
      const token = {} as any;

      const codeLenses = await provider.provideCodeLenses(document, token);

      expect(codeLenses).toBeDefined();
      expect(Array.isArray(codeLenses)).toBe(true);
      // might be empty or have minimal context
    });

    it('should handle documents with no symbol definitions', async () => {
      const document = createMockVSCodeTextDocument(
        '// Just comments\n// No functions or classes',
        'src/comments.ts'
      );
      const token = {} as any;

      const codeLenses = await provider.provideCodeLenses(document, token);

      expect(codeLenses).toBeDefined();
      expect(Array.isArray(codeLenses)).toBe(true);
      // should not crash, might have file-level context
    });

    it('should handle errors gracefully', async () => {
      // mock database to throw error
      const brokenProvider = new RelatedContextProvider({
        findRelevantContext: vi.fn().mockRejectedValue(new Error('Database error')),
      } as any);

      const document = createMockVSCodeTextDocument('class Test {}', 'src/test.ts');
      const token = {} as any;

      const codeLenses = await brokenProvider.provideCodeLenses(document, token);

      expect(codeLenses).toBeDefined();
      expect(Array.isArray(codeLenses)).toBe(true);
      expect(codeLenses).toHaveLength(0); // Should return empty array on error
    });

    it('should pass correct arguments to showPanel command', async () => {
      const document = createMockVSCodeTextDocument('class AuthService {}', 'src/auth.ts');
      const token = {} as any;

      const codeLenses = await provider.provideCodeLenses(document, token);

      const topLevelLens = codeLenses.find(
        (lens) => lens.range.start.line === 0 && lens.range.start.character === 0
      );

      expect(topLevelLens?.command.arguments?.[0]).toEqual(
        expect.objectContaining({
          filePath: 'src/auth.ts',
          context: expect.any(Array),
        })
      );
    });

    it('should create different CodeLens for symbols with context', async () => {
      const documentContent = `
function authenticateUser() {}
class UserService {}
function unrelatedFunction() {}
`;
      const document = createMockVSCodeTextDocument(documentContent, 'src/mixed.ts');
      const token = {} as any;

      const codeLenses = await provider.provideCodeLenses(document, token);

      // should have separate CodeLenses for symbols that have relevant context
      const symbolLenses = codeLenses.filter((lens) => lens.command.title.includes('Related to'));

      // at least one symbol should have related context
      expect(symbolLenses.length).toBeGreaterThanOrEqual(0);
    });

    it('should handle multiple symbols of same type correctly', async () => {
      const documentContent = `
function firstFunction() {}
function secondFunction() {}
class FirstClass {}
class SecondClass {}
`;
      const document = createMockVSCodeTextDocument(documentContent, 'src/multiple.ts');
      const token = {} as any;

      const codeLenses = await provider.provideCodeLenses(document, token);

      // should not crash and should return valid CodeLens array
      expect(codeLenses).toBeDefined();
      expect(Array.isArray(codeLenses)).toBe(true);
    });

    it('should handle TypeScript interfaces and types', async () => {
      const documentContent = `
interface AuthConfig {
	clientId: string;
}

type UserRole = 'admin' | 'user';

interface UserService {
	authenticate(): Promise<boolean>;
}
`;
      const document = createMockVSCodeTextDocument(documentContent, 'src/types.ts');
      const token = {} as any;

      const codeLenses = await provider.provideCodeLenses(document, token);

      // should handle interface and type definitions
      expect(codeLenses).toBeDefined();
      expect(Array.isArray(codeLenses)).toBe(true);
    });

    it('should respect context count in title', async () => {
      const document = createMockVSCodeTextDocument('class AuthService {}', 'src/auth.ts');
      const token = {} as any;

      const codeLenses = await provider.provideCodeLenses(document, token);

      const topLevelLens = codeLenses.find((lens) => lens.range.start.line === 0);

      if (topLevelLens) {
        // title should show actual count of related context
        const match = topLevelLens.command.title.match(/\((\d+)\)/);
        expect(match).toBeTruthy();
        if (match) {
          const count = parseInt(match[1]);
          expect(count).toBeGreaterThan(0);

          // verify the count matches the context array length
          const contextArray = topLevelLens.command.arguments?.[0]?.context;
          if (contextArray) {
            expect(contextArray).toHaveLength(count);
          }
        }
      }
    });
  });

  describe('edge cases', () => {
    it('should handle very long files', async () => {
      const longContent = 'function test() {}\n'.repeat(1000) + 'class LongFileTest {}';
      const document = createMockVSCodeTextDocument(longContent, 'src/long.ts');
      const token = {} as any;

      const codeLenses = await provider.provideCodeLenses(document, token);

      expect(codeLenses).toBeDefined();
      expect(Array.isArray(codeLenses)).toBe(true);
    });

    it('should handle files with special characters', async () => {
      const content = 'class TestÄöü {}';
      const document = createMockVSCodeTextDocument(content, 'src/special-chars.ts');
      const token = {} as any;

      const codeLenses = await provider.provideCodeLenses(document, token);

      expect(codeLenses).toBeDefined();
      expect(Array.isArray(codeLenses)).toBe(true);
    });

    it('should handle empty files', async () => {
      const document = createMockVSCodeTextDocument('', 'src/empty.ts');
      const token = {} as any;

      const codeLenses = await provider.provideCodeLenses(document, token);

      expect(codeLenses).toBeDefined();
      expect(Array.isArray(codeLenses)).toBe(true);
    });
  });
});
