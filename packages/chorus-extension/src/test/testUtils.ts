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
