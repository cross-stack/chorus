import { LocalDB, ContextEntry, BallotEntry } from '../storage/LocalDB';
import * as path from 'path';
import * as fs from 'fs/promises';
import { tmpdir } from 'os';

export class TestDatabase {
	private static counter = 0;
	public db: LocalDB;
	private tempPath: string;

	constructor() {
		this.tempPath = path.join(tmpdir(), 'chorus-test-' + Date.now() + '-' + TestDatabase.counter++);
		this.db = new LocalDB(this.tempPath);
	}

	async setup(): Promise<void> {
		await this.db.initialize();
	}

	async cleanup(): Promise<void> {
		this.db.dispose();
		try {
			await fs.rm(this.tempPath, { recursive: true, force: true });
		} catch (error) {
			// ignore cleanup errors
		}
	}
}

export const mockContextEntry: Omit<ContextEntry, 'id' | 'indexed_at'> = {
	type: 'commit',
	title: 'feat: add user authentication',
	path: 'abc123def',
	content: 'feat: add user authentication\n\nImplemented OAuth2 flow for secure user login',
	metadata: {
		hash: 'abc123def',
		author: 'John Doe',
		date: '2023-01-01',
		files: ['src/auth.ts', 'src/types.ts']
	}
};

export const mockDocumentEntry: Omit<ContextEntry, 'id' | 'indexed_at'> = {
	type: 'doc',
	title: 'API Documentation',
	path: 'docs/api.md',
	content: '# API Documentation\n\nThis document describes the REST API endpoints.',
	metadata: {
		fileSize: 100,
		extension: '.md'
	}
};

export const mockBallot: Omit<BallotEntry, 'id' | 'created_at'> = {
	pr_reference: '#123',
	decision: 'approve',
	confidence: 4,
	rationale: 'Well-tested implementation with good error handling',
	author_metadata: JSON.stringify({
		name: 'Test User',
		timestamp: '2023-01-01T00:00:00.000Z'
	}),
	revealed: false
};

export function createMockVSCodeExtensionContext(): any {
	return {
		globalStorageUri: {
			fsPath: path.join(tmpdir(), 'chorus-test-context')
		},
		subscriptions: [],
		extensionUri: {
			fsPath: '/mock/extension/path'
		}
	};
}

export function createMockVSCodeTextDocument(content: string, fileName: string = 'test.ts'): any {
	return {
		getText: () => content,
		fileName: fileName,
		uri: {
			fsPath: fileName
		},
		positionAt: (offset: number) => ({ line: 0, character: offset }),
		lineAt: (line: number) => ({ text: content.split('\n')[line] || '' })
	};
}

export function createMockVSCodeWorkspace(folders: string[]): any {
	return {
		workspaceFolders: folders.map(folder => ({
			uri: {
				fsPath: folder
			},
			name: path.basename(folder)
		})),
		asRelativePath: (filePath: string) => path.relative(folders[0] || '', filePath),
		findFiles: async (_pattern: any) => {
			// mock implementation that returns empty array
			return [];
		}
	};
}

/**
 * Mock git spawn for testing GitConfigService and GitService
 * Returns a mock child process with configurable stdout/stderr/exit behavior
 *
 * @example
 * ```typescript
 * const mockProcess = mockGitSpawn('John Doe\n', '', 0);
 * vi.mocked(spawn).mockReturnValue(mockProcess);
 * ```
 */
export function mockGitSpawn(stdout: string, stderr: string = '', exitCode: number = 0): any {
	const { EventEmitter } = require('events');
	const mockProcess = new EventEmitter();

	// add stdout and stderr as event emitters
	mockProcess.stdout = new EventEmitter();
	mockProcess.stderr = new EventEmitter();

	// emit data and close events asynchronously
	setTimeout(() => {
		if (stdout) {
			mockProcess.stdout.emit('data', stdout);
		}
		if (stderr) {
			mockProcess.stderr.emit('data', stderr);
		}
		mockProcess.emit('close', exitCode);
	}, 0);

	return mockProcess;
}

/**
 * Mock git spawn with error (for testing spawn failures)
 * Returns a mock process that emits an error event
 *
 * @example
 * ```typescript
 * const mockProcess = mockGitSpawnError('ENOENT', 'git not found');
 * vi.mocked(spawn).mockReturnValue(mockProcess);
 * ```
 */
export function mockGitSpawnError(code: string = 'ENOENT', message: string = 'Command not found'): any {
	const { EventEmitter } = require('events');
	const mockProcess = new EventEmitter();

	mockProcess.stdout = new EventEmitter();
	mockProcess.stderr = new EventEmitter();

	// emit error asynchronously
	setTimeout(() => {
		const error: any = new Error(message);
		error.code = code;
		mockProcess.emit('error', error);
	}, 0);

	return mockProcess;
}

/**
 * Test fixture for git user info
 */
export const TEST_GIT_USER = {
	name: 'Test User',
	email: 'test@example.com'
};

/**
 * Test fixture for alternative git user (for multi-user scenarios)
 */
export const TEST_GIT_USER_ALT = {
	name: 'Jane Reviewer',
	email: 'jane.reviewer@example.com'
};
